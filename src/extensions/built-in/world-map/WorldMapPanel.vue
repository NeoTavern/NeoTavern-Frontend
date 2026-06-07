<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { Button, Checkbox } from '../../../components/UI';
import { getMapFromMetadata } from './map-utils';
import type { WorldMapShuffleMode } from './smart-shuffle';
import type {
  WorldMapAreaStyleDefinition,
  WorldMapConnection,
  WorldMapConnectionStyleDefinition,
  WorldMapDocument,
  WorldMapExtensionAPI,
  WorldMapNode,
  WorldMapNodeKind,
} from './types';
import { WORLD_MAP_UPDATED_EVENT } from './types';

const props = defineProps<{
  api: WorldMapExtensionAPI;
  runMapUpdate: (instructions?: string, includeLorebookEntries?: boolean) => Promise<void>;
  smartShuffleMap: (mode: WorldMapShuffleMode) => Promise<void>;
  removeMap: () => Promise<void>;
}>();

const map = ref<WorldMapDocument | null>(null);
const activeViewId = ref<string | null>(null);
const hoveredNodeId = ref<string | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const viewport = reactive({ width: 1, height: 1 });
const camera = reactive({ x: 0, y: 0, scale: 1 });
const isUpdating = ref(false);
const isCopying = ref(false);
const isShuffling = ref(false);
const isDragging = ref(false);
const dragStart = ref<{ x: number; y: number; camera: { x: number; y: number; scale: number } } | null>(null);
const animationFrame = ref<number | null>(null);
const transitionNodeId = ref<string | null>(null);
const transitionIconOpacity = ref(1);
const transitionHaloOpacity = ref(1);
const transitionSceneOpacity = ref(1);
const isTransitioning = ref(false);
const updateInstructions = ref('');
const includeLorebookEntries = ref(true);

interface CameraSnapshot {
  x: number;
  y: number;
  scale: number;
}

interface TransitionHistoryEntry {
  fromViewId: string;
  toViewId: string;
  anchorNodeId: string;
  spawnPoint: { x: number; y: number };
  fromCamera: CameraSnapshot;
}

interface LabelLayoutItem {
  node: WorldMapNode;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: 'middle' | 'start' | 'end';
  dominantBaseline: 'central' | 'text-after-edge' | 'text-before-edge';
  forced: boolean;
}

const transitionHistory = ref<TransitionHistoryEntry[]>([]);
let unsubscribeMapUpdated: (() => void) | null = null;

const zoomLimits = {
  min: 0.08,
  max: 80,
};

const rootNode = computed(() => {
  if (!map.value) return null;
  return map.value.rootNodeId ? map.value.nodes[map.value.rootNodeId] : (Object.values(map.value.nodes)[0] ?? null);
});

const activeView = computed(() => {
  if (!map.value) return null;
  if (activeViewId.value && map.value.nodes[activeViewId.value]) return map.value.nodes[activeViewId.value];
  return rootNode.value;
});

const activeChildren = computed(() => {
  if (!map.value || !activeView.value) return [];
  return Object.values(map.value.nodes)
    .filter((node) => node.parentId === activeView.value?.id)
    .sort((a, b) => {
      if (a.floorIndex !== undefined || b.floorIndex !== undefined) return (a.floorIndex ?? 0) - (b.floorIndex ?? 0);
      return a.name.localeCompare(b.name);
    });
});

const visibleConnections = computed(() => {
  if (!map.value) return [];
  const ids = new Set(activeChildren.value.map((node) => node.id));
  return map.value.connections.filter((connection) => ids.has(connection.fromNodeId) && ids.has(connection.toNodeId));
});

const activeAreas = computed(() => activeView.value?.areas ?? []);

const activeVisualPack = computed(() => {
  if (!map.value?.activeVisualPackId) return null;
  return map.value.visualPacks?.[map.value.activeVisualPackId] ?? null;
});

const floorSiblings = computed(() => {
  if (!map.value || activeView.value?.kind !== 'floor' || !activeView.value.parentId) return [];
  return Object.values(map.value.nodes)
    .filter((node) => node.parentId === activeView.value?.parentId && node.kind === 'floor')
    .sort((a, b) => (a.floorIndex ?? 0) - (b.floorIndex ?? 0));
});

const breadcrumb = computed(() => {
  if (!map.value || !activeView.value) return [];
  const items: WorldMapNode[] = [];
  let cursor: WorldMapNode | undefined = activeView.value;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    items.unshift(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId ? map.value.nodes[cursor.parentId] : undefined;
  }
  return items;
});

const defsHtml = computed(() =>
  Object.values(activeVisualPack.value?.icons ?? {})
    .map((icon) => icon.svgSymbol)
    .filter(Boolean)
    .join(''),
);

const hasMap = computed(() => Boolean(map.value && Object.keys(map.value.nodes).length));

const cameraTransform = computed(
  () =>
    `matrix(${camera.scale.toFixed(4)} 0 0 ${camera.scale.toFixed(4)} ${camera.x.toFixed(2)} ${camera.y.toFixed(2)})`,
);

const svgViewBox = computed(() => `0 0 ${Math.max(1, viewport.width)} ${Math.max(1, viewport.height)}`);

const visibleNodeLabels = computed<LabelLayoutItem[]>(() => {
  const accepted: LabelLayoutItem[] = [];
  const candidates = activeChildren.value
    .map((node) => ({
      node,
      priority: getLabelPriority(node),
      forced: node.id === hoveredNodeId.value,
    }))
    .sort((a, b) => {
      if (a.forced !== b.forced) return a.forced ? -1 : 1;
      return b.priority - a.priority;
    });

  for (const candidate of candidates) {
    if (!candidate.forced && !shouldShowLabelAtZoom(candidate.node)) continue;
    const label = placeNodeLabel(candidate.node, accepted, candidate.forced);
    if (label) accepted.push(label);
  }
  return accepted.sort((a, b) => activeChildren.value.indexOf(a.node) - activeChildren.value.indexOf(b.node));
});

function refreshMap(): void {
  map.value = getMapFromMetadata(props.api.chat.metadata.get());
  if (!activeViewId.value || (map.value && !map.value.nodes[activeViewId.value])) {
    activeViewId.value = rootNode.value?.id ?? null;
  }
  if (!map.value) {
    activeViewId.value = null;
    hoveredNodeId.value = null;
    transitionHistory.value = [];
  }
  resetTransitionOpacity();
  nextTick(() => fitActiveView(false));
}

function getViewSize(node: WorldMapNode | null): { width: number; height: number } {
  if (!node) return { width: 1200, height: 800 };
  if (node.view) return { width: node.view.width, height: node.view.height };
  const bounds = activeChildren.value.map((child) => child.bounds).filter(Boolean);
  const width = Math.max(1200, ...bounds.map((bound) => (bound?.x ?? 0) + (bound?.width ?? 0) + 120));
  const height = Math.max(800, ...bounds.map((bound) => (bound?.y ?? 0) + (bound?.height ?? 0) + 120));
  return { width, height };
}

function getMapBounds(): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  const size = getViewSize(activeView.value);
  const childBounds = activeChildren.value.map((child) => getNodeBounds(child));
  const minX = Math.min(0, ...childBounds.map((bounds) => bounds.x));
  const minY = Math.min(0, ...childBounds.map((bounds) => bounds.y));
  const maxX = Math.max(size.width, ...childBounds.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(size.height, ...childBounds.map((bounds) => bounds.y + bounds.height));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function getCameraFitBounds(): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  const contentBounds = activeChildren.value.map((node) => {
    const center = nodeCenter(node);
    const radius = nodeRadius(node) * 1.8;
    return {
      minX: center.x - radius,
      minY: center.y - radius,
      maxX: center.x + radius,
      maxY: center.y + radius,
    };
  });

  for (const area of activeAreas.value) {
    if (area.points.length === 0) continue;
    const xs = area.points.map((point) => point.x);
    const ys = area.points.map((point) => point.y);
    contentBounds.push({
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    });
  }

  for (const connection of visibleConnections.value) {
    const points = connectionPoints(connection);
    if (points.length === 0) continue;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    contentBounds.push({
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    });
  }

  if (contentBounds.length === 0) {
    const size = getViewSize(activeView.value);
    return {
      minX: 0,
      minY: 0,
      maxX: size.width,
      maxY: size.height,
      width: Math.max(1, size.width),
      height: Math.max(1, size.height),
    };
  }

  const minX = Math.min(...contentBounds.map((bounds) => bounds.minX));
  const minY = Math.min(...contentBounds.map((bounds) => bounds.minY));
  const maxX = Math.max(...contentBounds.map((bounds) => bounds.maxX));
  const maxY = Math.max(...contentBounds.map((bounds) => bounds.maxY));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function updateViewport(): void {
  const rect = svgRef.value?.getBoundingClientRect();
  viewport.width = Math.max(1, rect?.width ?? 1);
  viewport.height = Math.max(1, rect?.height ?? 1);
}

function getFitCamera(): CameraSnapshot {
  updateViewport();
  const bounds = getCameraFitBounds();
  const padding = 54;
  const scaleX = (viewport.width - padding * 2) / bounds.width;
  const scaleY = (viewport.height - padding * 2) / bounds.height;
  const scale = clamp(Math.min(scaleX, scaleY), zoomLimits.min, zoomLimits.max);
  return {
    scale,
    x: viewport.width / 2 - (bounds.minX + bounds.width / 2) * scale,
    y: viewport.height / 2 - (bounds.minY + bounds.height / 2) * scale,
  };
}

function cameraForContentBounds(scale: number): CameraSnapshot {
  updateViewport();
  const bounds = getCameraFitBounds();
  return {
    scale,
    x: viewport.width / 2 - (bounds.minX + bounds.width / 2) * scale,
    y: viewport.height / 2 - (bounds.minY + bounds.height / 2) * scale,
  };
}

function getEnterMaxScale(): number {
  const count = activeChildren.value.length;
  if (count <= 1) return 0.95;
  if (count <= 3) return 1.15;
  if (count <= 6) return 1.45;
  return zoomLimits.max;
}

function getEnterFitCamera(): CameraSnapshot {
  const fit = getFitCamera();
  const maxScale = getEnterMaxScale();
  return fit.scale <= maxScale ? fit : cameraForContentBounds(maxScale);
}

function setCamera(nextCamera: CameraSnapshot): void {
  camera.x = nextCamera.x;
  camera.y = nextCamera.y;
  camera.scale = nextCamera.scale;
}

function getCameraSnapshot(): CameraSnapshot {
  return { x: camera.x, y: camera.y, scale: camera.scale };
}

function getEasing(name: 'easeIn' | 'easeOut' | 'easeInOut' = 'easeOut'): (value: number) => number {
  if (name === 'easeIn') return (value) => value * value * value;
  if (name === 'easeInOut') {
    return (value) => (value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2);
  }
  return (value) => 1 - Math.pow(1 - value, 3);
}

function cancelCameraAnimation(): void {
  if (animationFrame.value !== null) {
    cancelAnimationFrame(animationFrame.value);
    animationFrame.value = null;
  }
}

function animateCameraTo(
  target: CameraSnapshot,
  duration = 360,
  easing: 'easeIn' | 'easeOut' | 'easeInOut' = 'easeOut',
  onUpdate?: () => void,
): Promise<void> {
  cancelCameraAnimation();
  const start = getCameraSnapshot();
  const startedAt = performance.now();
  const ease = getEasing(easing);

  return new Promise((resolve) => {
    const tick = (now: number) => {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = ease(progress);
      camera.x = start.x + (target.x - start.x) * eased;
      camera.y = start.y + (target.y - start.y) * eased;
      camera.scale = start.scale + (target.scale - start.scale) * eased;
      onUpdate?.();

      if (progress < 1) {
        animationFrame.value = requestAnimationFrame(tick);
      } else {
        animationFrame.value = null;
        resolve();
      }
    };
    animationFrame.value = requestAnimationFrame(tick);
  });
}

function fitActiveView(animate = false): void {
  const target = getFitCamera();
  if (animate) {
    animateCameraTo(target, 360, 'easeOut');
    return;
  }
  setCamera(target);
}

function getNodeBounds(node: WorldMapNode): Required<WorldMapNode>['bounds'] {
  return node.bounds ?? { x: 100, y: 100, width: 120, height: 88 };
}

function nodeCenter(node: WorldMapNode): { x: number; y: number } {
  const bounds = getNodeBounds(node);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function nodeRadius(node: WorldMapNode): number {
  const bounds = getNodeBounds(node);
  const preferred = Math.min(bounds.width, bounds.height) * 0.22;
  const maxByKind: Record<WorldMapNodeKind, number> = {
    world: 34,
    region: 32,
    settlement: 30,
    district: 28,
    building: 28,
    landmark: 26,
    floor: 24,
    poi: 22,
    room: 20,
  };
  return clamp(preferred, 16, maxByKind[node.kind] ?? 24);
}

function nodeScreenPoint(node: WorldMapNode): { x: number; y: number } {
  const center = nodeCenter(node);
  return {
    x: center.x * camera.scale + camera.x,
    y: center.y * camera.scale + camera.y,
  };
}

function estimateLabelWidth(label: string): number {
  return clamp(label.length * 7.2 + 18, 44, 240);
}

function getLabelPriority(node: WorldMapNode): number {
  const bounds = getNodeBounds(node);
  const center = nodeScreenPoint(node);
  const viewportCenterX = viewport.width / 2;
  const viewportCenterY = viewport.height / 2;
  const distanceToCenter = Math.hypot(center.x - viewportCenterX, center.y - viewportCenterY);
  const centerBonus = Math.max(0, 90 - distanceToCenter / 10);
  const areaBonus = Math.min(70, Math.sqrt(bounds.width * bounds.height) / 5);
  const kindPriority: Record<WorldMapNodeKind, number> = {
    world: 150,
    region: 135,
    settlement: 125,
    district: 115,
    building: 105,
    landmark: 90,
    floor: 80,
    poi: 70,
    room: 55,
  };
  return kindPriority[node.kind] + areaBonus + centerBonus + (hasChildren(node) ? 20 : 0);
}

function shouldShowLabelAtZoom(node: WorldMapNode): boolean {
  if (node.id === transitionNodeId.value) return true;
  if (node.kind === 'world' || node.kind === 'region' || node.kind === 'settlement' || node.kind === 'district') {
    return camera.scale >= 0.1;
  }
  if (node.kind === 'building' || node.kind === 'landmark') return camera.scale >= 0.18;
  if (node.kind === 'floor' || node.kind === 'poi') return camera.scale >= 0.32;
  return camera.scale >= 0.65;
}

function labelIntersects(
  a: Pick<LabelLayoutItem, 'x' | 'y' | 'width' | 'height'>,
  b: Pick<LabelLayoutItem, 'x' | 'y' | 'width' | 'height'>,
): boolean {
  const padding = 4;
  return !(
    a.x + a.width + padding < b.x ||
    b.x + b.width + padding < a.x ||
    a.y + a.height + padding < b.y ||
    b.y + b.height + padding < a.y
  );
}

function getLabelRect(node: WorldMapNode, anchor: 'top' | 'bottom' | 'right' | 'left' | 'inside'): LabelLayoutItem {
  const bounds = getNodeBounds(node);
  const center = nodeScreenPoint(node);
  const screenBounds = {
    x: bounds.x * camera.scale + camera.x,
    y: bounds.y * camera.scale + camera.y,
    width: bounds.width * camera.scale,
    height: bounds.height * camera.scale,
  };
  const width = estimateLabelWidth(node.name);
  const height = 24;
  const offset = Math.max(18, nodeRadius(node) * camera.scale + 10);

  if (anchor === 'top') {
    return {
      node,
      x: center.x - width / 2,
      y: center.y - offset - height,
      width,
      height,
      anchor: 'middle',
      dominantBaseline: 'central',
      forced: false,
    };
  }
  if (anchor === 'right') {
    return {
      node,
      x: screenBounds.x + screenBounds.width + 10,
      y: center.y - height / 2,
      width,
      height,
      anchor: 'start',
      dominantBaseline: 'central',
      forced: false,
    };
  }
  if (anchor === 'left') {
    return {
      node,
      x: screenBounds.x - width - 10,
      y: center.y - height / 2,
      width,
      height,
      anchor: 'end',
      dominantBaseline: 'central',
      forced: false,
    };
  }
  if (anchor === 'inside') {
    return {
      node,
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
      anchor: 'middle',
      dominantBaseline: 'central',
      forced: false,
    };
  }
  return {
    node,
    x: center.x - width / 2,
    y: center.y + offset,
    width,
    height,
    anchor: 'middle',
    dominantBaseline: 'central',
    forced: false,
  };
}

function isLabelInViewport(label: LabelLayoutItem): boolean {
  return (
    label.x >= 6 &&
    label.y >= 6 &&
    label.x + label.width <= viewport.width - 6 &&
    label.y + label.height <= viewport.height - 6
  );
}

function placeNodeLabel(node: WorldMapNode, accepted: LabelLayoutItem[], forced: boolean): LabelLayoutItem | null {
  const bounds = getNodeBounds(node);
  const anchors: Array<'top' | 'bottom' | 'right' | 'left' | 'inside'> = ['top', 'bottom', 'right', 'left'];
  if (bounds.width * camera.scale > estimateLabelWidth(node.name) + 18 && bounds.height * camera.scale > 36) {
    anchors.push('inside');
  }

  for (const anchor of anchors) {
    const label = { ...getLabelRect(node, anchor), forced };
    if (!forced && !isLabelInViewport(label)) continue;
    if (!forced && accepted.some((item) => labelIntersects(label, item))) continue;
    return label;
  }

  if (!forced) return null;
  const fallback = { ...getLabelRect(node, 'bottom'), forced };
  fallback.x = clamp(fallback.x, 6, Math.max(6, viewport.width - fallback.width - 6));
  fallback.y = clamp(fallback.y, 6, Math.max(6, viewport.height - fallback.height - 6));
  return fallback;
}

function labelTextX(label: LabelLayoutItem): number {
  if (label.anchor === 'start') return label.x + 9;
  if (label.anchor === 'end') return label.x + label.width - 9;
  return label.x + label.width / 2;
}

function labelTextY(label: LabelLayoutItem): number {
  return label.y + label.height / 2;
}

function cameraForNode(node: WorldMapNode, scale = camera.scale): CameraSnapshot {
  updateViewport();
  const center = nodeCenter(node);
  return {
    scale,
    x: viewport.width / 2 - center.x * scale,
    y: viewport.height / 2 - center.y * scale,
  };
}

function getNodeCoverage(node: WorldMapNode): number {
  return (nodeRadius(node) * 2 * camera.scale) / Math.max(1, Math.min(viewport.width, viewport.height));
}

function getNodeCoverScale(node: WorldMapNode, coverage = 1.52): number {
  updateViewport();
  return Math.max(
    camera.scale,
    (Math.min(viewport.width, viewport.height) * coverage) / Math.max(1, nodeRadius(node) * 2),
  );
}

function getTinyMapScale(): number {
  const fit = getFitCamera();
  return clamp(fit.scale * 0.035, 0.002, zoomLimits.max);
}

function cameraForMapAtScreenPoint(screenPoint: { x: number; y: number }, scale: number): CameraSnapshot {
  const bounds = getCameraFitBounds();
  return {
    scale,
    x: screenPoint.x - (bounds.minX + bounds.width / 2) * scale,
    y: screenPoint.y - (bounds.minY + bounds.height / 2) * scale,
  };
}

function cameraForNodeAtScreenPoint(
  node: WorldMapNode,
  screenPoint: { x: number; y: number },
  scale: number,
): CameraSnapshot {
  const center = nodeCenter(node);
  return {
    scale,
    x: screenPoint.x - center.x * scale,
    y: screenPoint.y - center.y * scale,
  };
}

function updateEnterOpacity(node: WorldMapNode): void {
  const coverage = getNodeCoverage(node);
  transitionHaloOpacity.value = clamp(1 - coverage / 0.5, 0, 1);
  transitionIconOpacity.value = coverage <= 0.5 ? 1 : clamp(1 - (coverage - 0.5) / 1, 0, 1);
  transitionSceneOpacity.value = coverage <= 0.35 ? 1 : clamp(1 - (coverage - 0.35) / 0.55, 0, 1);
}

function resetTransitionOpacity(): void {
  transitionNodeId.value = null;
  transitionIconOpacity.value = 1;
  transitionHaloOpacity.value = 1;
  transitionSceneOpacity.value = 1;
}

function hasChildren(node: WorldMapNode): boolean {
  if (!map.value) return false;
  return Object.values(map.value.nodes).some((child) => child.parentId === node.id);
}

async function enterNode(node: WorldMapNode): Promise<void> {
  if (!hasChildren(node) || activeViewId.value === node.id) return;
  if (!activeViewId.value || isTransitioning.value) return;
  isTransitioning.value = true;
  cancelCameraAnimation();
  const fromViewId = activeViewId.value;
  const fromCamera = getCameraSnapshot();
  const spawnPoint = nodeScreenPoint(node);
  transitionNodeId.value = node.id;
  updateEnterOpacity(node);

  await animateCameraTo(cameraForNode(node, getNodeCoverScale(node, 1.5)), 760, 'easeIn', () =>
    updateEnterOpacity(node),
  );

  transitionHistory.value.push({
    fromViewId,
    toViewId: node.id,
    anchorNodeId: node.id,
    spawnPoint,
    fromCamera,
  });

  activeViewId.value = node.id;
  hoveredNodeId.value = null;
  await nextTick();
  resetTransitionOpacity();
  setCamera(cameraForMapAtScreenPoint(spawnPoint, getTinyMapScale()));
  await nextTick();
  await animateCameraTo(getEnterFitCamera(), 1120, 'easeInOut');
  isTransitioning.value = false;
}

function handleNodeDoubleClick(node: WorldMapNode): void {
  enterNode(node);
}

function findExitHistoryEntry(targetViewId: string): TransitionHistoryEntry | null {
  const index = transitionHistory.value.findLastIndex(
    (entry) => entry.fromViewId === targetViewId && entry.toViewId === activeViewId.value,
  );
  if (index === -1) return null;
  const [entry] = transitionHistory.value.splice(index, 1);
  return entry;
}

async function goUp(): Promise<void> {
  if (!map.value || !activeView.value?.parentId) return;
  if (isTransitioning.value) return;
  isTransitioning.value = true;
  const previous = activeView.value;
  const targetViewId = activeView.value.parentId;
  const history = findExitHistoryEntry(targetViewId);
  const spawnPoint = history?.spawnPoint ?? { x: viewport.width / 2, y: viewport.height / 2 };

  await animateCameraTo(cameraForMapAtScreenPoint(spawnPoint, getTinyMapScale()), 520, 'easeIn');

  activeViewId.value = targetViewId;
  hoveredNodeId.value = null;
  await nextTick();
  const anchor = map.value.nodes[history?.anchorNodeId ?? previous.id] ?? previous;
  setCamera(cameraForNodeAtScreenPoint(anchor, spawnPoint, getNodeCoverScale(anchor, 1.55)));
  transitionNodeId.value = anchor.id;
  transitionIconOpacity.value = 0;
  transitionHaloOpacity.value = 0;
  transitionSceneOpacity.value = 0;
  const targetCamera = history?.fromCamera ?? getFitCamera();
  await animateCameraTo(targetCamera, 620, 'easeOut', () => {
    const coverage = getNodeCoverage(anchor);
    transitionHaloOpacity.value = clamp(1 - coverage / 0.5, 0, 1);
    transitionIconOpacity.value = coverage <= 0.5 ? 1 : clamp(1 - (coverage - 0.5) / 1, 0, 1);
    transitionSceneOpacity.value = coverage <= 0.35 ? 1 : clamp(1 - (coverage - 0.35) / 0.55, 0, 1);
  });
  resetTransitionOpacity();
  isTransitioning.value = false;
}

function goFloor(direction: -1 | 1): void {
  if (!activeView.value || floorSiblings.value.length === 0) return;
  const index = floorSiblings.value.findIndex((node) => node.id === activeView.value?.id);
  const nextFloor = floorSiblings.value[index + direction];
  if (!nextFloor) return;
  activeViewId.value = nextFloor.id;
  hoveredNodeId.value = null;
  nextTick(() => fitActiveView(true));
}

async function updateMap(): Promise<void> {
  isUpdating.value = true;
  try {
    await props.runMapUpdate(updateInstructions.value.trim() || undefined, includeLorebookEntries.value);
    refreshMap();
  } finally {
    isUpdating.value = false;
  }
}

async function handleRemoveMap(): Promise<void> {
  await props.removeMap();
  map.value = null;
  activeViewId.value = null;
  hoveredNodeId.value = null;
  transitionHistory.value = [];
  resetTransitionOpacity();
}

async function handleSmartShuffle(mode: WorldMapShuffleMode): Promise<void> {
  if (!hasMap.value || isShuffling.value) return;
  isShuffling.value = true;
  try {
    await props.smartShuffleMap(mode);
    refreshMap();
    nextTick(() => fitActiveView(true));
  } finally {
    isShuffling.value = false;
  }
}

function copyTextFallback(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

async function copyMap(): Promise<void> {
  if (!map.value || isCopying.value) return;
  isCopying.value = true;
  try {
    const text = JSON.stringify(map.value, null, 2);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else if (!copyTextFallback(text)) {
      throw new Error('Clipboard API is unavailable.');
    }
    props.api.ui.showToast('World map JSON copied.', 'success');
  } catch (error) {
    props.api.ui.showToast('Failed to copy world map JSON.', 'error');
    console.error('World map copy failed:', error);
  } finally {
    isCopying.value = false;
  }
}

function connectionPoints(connection: WorldMapConnection): Array<{ x: number; y: number }> {
  if (!map.value) return [];
  const from = map.value.nodes[connection.fromNodeId];
  const to = map.value.nodes[connection.toNodeId];
  if (!from || !to) return [];
  return [nodeCenter(from), ...(connection.points ?? []), nodeCenter(to)];
}

function connectionPath(connection: WorldMapConnection): string {
  const points = connectionPoints(connection);
  if (connection.smoothPath && points.length > 2) {
    const commands = [`M ${points[0].x} ${points[0].y}`];
    for (let index = 1; index < points.length - 2; index += 1) {
      const midpoint = {
        x: (points[index].x + points[index + 1].x) / 2,
        y: (points[index].y + points[index + 1].y) / 2,
      };
      commands.push(`Q ${points[index].x} ${points[index].y} ${midpoint.x} ${midpoint.y}`);
    }
    const control = points[points.length - 2];
    const end = points[points.length - 1];
    commands.push(`Q ${control.x} ${control.y} ${end.x} ${end.y}`);
    return commands.join(' ');
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function nodeIconHref(node: WorldMapNode): string | null {
  const iconId = node.visual?.iconId;
  if (iconId && activeVisualPack.value?.icons?.[iconId]?.svgSymbol) return `#${iconId}`;
  return null;
}

function nodeColor(node: WorldMapNode): string {
  const iconId = node.visual?.iconId;
  const iconColor = iconId ? activeVisualPack.value?.icons?.[iconId]?.color : undefined;
  if (iconColor) return iconColor;
  const colors: Record<WorldMapNodeKind, string> = {
    world: '#4b7f52',
    region: '#8a6f3d',
    settlement: '#3b7ca8',
    district: '#7d5fa8',
    building: '#8b6670',
    floor: '#667b8b',
    room: '#8b7d66',
    landmark: '#4f8b83',
    poi: '#8b6f4f',
  };
  return colors[node.kind] ?? '#6d7785';
}

function nodeAreaStyle(node: WorldMapNode): WorldMapAreaStyleDefinition {
  const styleId = node.visual?.areaStyleId ?? node.visual?.footprintStyleId;
  const packStyle = styleId ? activeVisualPack.value?.areaStyles?.[styleId] : undefined;
  return {
    id: 'fallback',
    label: 'Fallback',
    fill: packStyle?.fill ?? `${nodeColor(node)}24`,
    stroke: packStyle?.stroke ?? nodeColor(node),
    opacity: packStyle?.opacity ?? 1,
  };
}

function polygonPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function mapAreaStyle(area: NonNullable<WorldMapNode['areas']>[number]): WorldMapAreaStyleDefinition {
  const styleId = area.visual?.areaStyleId;
  const packStyle = styleId ? activeVisualPack.value?.areaStyles?.[styleId] : undefined;
  const fallbackByKind: Record<string, { fill: string; stroke: string; opacity: number }> = {
    terrain: { fill: '#526342', stroke: '#7f9a62', opacity: 0.34 },
    water: { fill: '#244d67', stroke: '#5aa7c9', opacity: 0.46 },
    woods: { fill: '#244a31', stroke: '#5a9b69', opacity: 0.44 },
    garden: { fill: '#31583a', stroke: '#74b77b', opacity: 0.42 },
    courtyard: { fill: '#5b5960', stroke: '#9ca0a8', opacity: 0.32 },
    field: { fill: '#3d5a35', stroke: '#89b16f', opacity: 0.36 },
    cliff: { fill: '#5a5147', stroke: '#b1a08c', opacity: 0.4 },
    interior: { fill: '#4a4650', stroke: '#8c8597', opacity: 0.32 },
    other: { fill: '#49505a', stroke: '#87909d', opacity: 0.3 },
  };
  const fallback = fallbackByKind[area.kind ?? 'other'] ?? fallbackByKind.other;
  return {
    id: styleId ?? area.kind ?? 'other',
    label: area.label ?? area.kind ?? 'Area',
    fill: area.visual?.fill ?? packStyle?.fill ?? fallback.fill,
    stroke: area.visual?.stroke ?? packStyle?.stroke ?? fallback.stroke,
    opacity: area.visual?.opacity ?? packStyle?.opacity ?? fallback.opacity,
  };
}

function connectionStyle(connection: WorldMapConnection): WorldMapConnectionStyleDefinition {
  const styleId = connection.visual?.styleId;
  const packStyle = styleId ? activeVisualPack.value?.connectionStyles?.[styleId] : undefined;
  return {
    id: 'fallback',
    label: 'Fallback',
    stroke: packStyle?.stroke ?? (connection.kind === 'road' ? '#77664b' : '#607482'),
    width: packStyle?.width ?? (connection.kind === 'road' ? 8 : 4),
    dash: packStyle?.dash,
    linecap: packStyle?.linecap ?? 'round',
  };
}

function iconPath(kind: WorldMapNodeKind): string {
  const paths: Record<WorldMapNodeKind, string> = {
    world:
      'M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Zm-3 2.8c-.8 1.1-1.3 2.7-1.4 4.2H4.8A8.1 8.1 0 0 1 9 4.8Zm-4.2 6.2h2.8c.1 1.7.6 3.4 1.4 4.7a8.1 8.1 0 0 1-4.2-4.7Zm7.2 7.8c-1-.8-1.8-2.6-2-4.8h4c-.2 2.2-1 4-2 4.8Zm2.2-6.8H9.8a17 17 0 0 1 0-4h4.4a17 17 0 0 1 0 4Zm.8 6.8c.8-1.3 1.3-3 1.4-4.8h2.8a8.1 8.1 0 0 1-4.2 4.8Zm1.4-6.8c-.1-1.5-.6-3.1-1.4-4.2A8.1 8.1 0 0 1 19.2 9h-2.8ZM12 4.2c1 .8 1.8 2.4 2 4.8h-4c.2-2.4 1-4 2-4.8Z',
    region: 'M4 5 12 2l8 3v13l-8 3-8-3V5Zm2 1.4v10.2l5 1.9V8.3L6 6.4Zm7 2v10.1l5-1.9V6.4l-5 2Z',
    settlement: 'M3 20v-9l5-4 4 3 4-5 5 5v10h-6v-6h-4v6H3Z',
    district: 'M4 20V7h5v13H4Zm7 0V4h5v16h-5Zm7 0v-9h3v9h-3Z',
    building:
      'M5 21V3h14v18h-5v-5H10v5H5Zm3-14h3V5H8v2Zm6 0h3V5h-3v2ZM8 11h3V9H8v2Zm6 0h3V9h-3v2Zm-6 4h3v-2H8v2Zm6 0h3v-2h-3v2Z',
    floor: 'M4 6 12 2l8 4-8 4-8-4Zm0 5 8 4 8-4v3l-8 4-8-4v-3Zm0 6 8 4 8-4v2l-8 4-8-4v-2Z',
    room: 'M5 4h14v17H5V4Zm2 2v13h10V6H7Zm8 7h2v2h-2v-2Z',
    landmark: 'M12 2 3 21h18L12 2Zm0 5 4.8 10H7.2L12 7Z',
    poi: 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z',
  };
  return paths[kind] ?? paths.poi;
}

function onWheel(event: WheelEvent): void {
  if (isTransitioning.value) return;
  cancelCameraAnimation();
  const rect = svgRef.value?.getBoundingClientRect();
  if (!rect) return;
  const sx = event.clientX - rect.left;
  const sy = event.clientY - rect.top;
  const worldX = (sx - camera.x) / camera.scale;
  const worldY = (sy - camera.y) / camera.scale;
  const factor = Math.exp(-event.deltaY / 900);
  camera.scale = clamp(camera.scale * factor, zoomLimits.min, zoomLimits.max);
  camera.x = sx - worldX * camera.scale;
  camera.y = sy - worldY * camera.scale;
}

function onPointerDown(event: PointerEvent): void {
  if (isTransitioning.value) return;
  if ((event.target as Element | null)?.closest?.('.world-map-panel__node')) return;
  cancelCameraAnimation();
  isDragging.value = true;
  dragStart.value = { x: event.clientX, y: event.clientY, camera: getCameraSnapshot() };
  svgRef.value?.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!isDragging.value || !dragStart.value) return;
  camera.x = dragStart.value.camera.x + event.clientX - dragStart.value.x;
  camera.y = dragStart.value.camera.y + event.clientY - dragStart.value.y;
}

function onPointerUp(event?: PointerEvent): void {
  isDragging.value = false;
  dragStart.value = null;
  if (event) svgRef.value?.releasePointerCapture(event.pointerId);
}

function getNodeOpacity(node: WorldMapNode, part: 'icon' | 'halo' | 'scene'): number {
  if (transitionNodeId.value !== node.id) return 1;
  if (part === 'icon') return transitionIconOpacity.value;
  if (part === 'halo') return transitionHaloOpacity.value;
  return transitionSceneOpacity.value;
}

function getNodeAreaOpacity(node: WorldMapNode): number {
  const baseOpacity = nodeAreaStyle(node).opacity ?? 1;
  return (
    baseOpacity * (transitionNodeId.value === node.id ? transitionHaloOpacity.value : transitionSceneOpacity.value)
  );
}

function handleResize(): void {
  updateViewport();
  fitActiveView(false);
}

onMounted(() => {
  refreshMap();
  nextTick(() => {
    updateViewport();
    fitActiveView(false);
  });
  window.addEventListener('resize', handleResize);
  unsubscribeMapUpdated = props.api.events.on(WORLD_MAP_UPDATED_EVENT, refreshMap);
});

onBeforeUnmount(() => {
  cancelCameraAnimation();
  window.removeEventListener('resize', handleResize);
  unsubscribeMapUpdated?.();
  unsubscribeMapUpdated = null;
});
</script>

<template>
  <div class="world-map-panel">
    <div class="world-map-panel__toolbar">
      <div class="world-map-panel__path">
        <button
          v-for="item in breadcrumb"
          :key="item.id"
          type="button"
          class="world-map-panel__crumb"
          :disabled="isTransitioning"
          @click="
            activeViewId = item.id;
            hoveredNodeId = null;
            nextTick(() => fitActiveView(true));
          "
        >
          {{ item.name }}
        </button>
      </div>
      <div class="world-map-panel__actions">
        <Button
          icon="fa-solid fa-arrow-up"
          title="Upper map"
          variant="ghost"
          :disabled="!activeView?.parentId || isTransitioning"
          @click="goUp"
        />
        <Button
          icon="fa-solid fa-arrow-down"
          title="Lower floor"
          variant="ghost"
          :disabled="floorSiblings.findIndex((floor) => floor.id === activeView?.id) <= 0 || isTransitioning"
          @click="goFloor(-1)"
        />
        <Button
          icon="fa-solid fa-arrow-up-short-wide"
          title="Upper floor"
          variant="ghost"
          :disabled="
            isTransitioning ||
            floorSiblings.findIndex((floor) => floor.id === activeView?.id) === -1 ||
            floorSiblings.findIndex((floor) => floor.id === activeView?.id) >= floorSiblings.length - 1
          "
          @click="goFloor(1)"
        />
        <Button
          icon="fa-solid fa-crosshairs"
          title="Fit map"
          variant="ghost"
          :disabled="isTransitioning"
          @click="fitActiveView(true)"
        />
        <Button
          icon="fa-solid fa-shuffle"
          title="Smart shuffle"
          variant="ghost"
          :loading="isShuffling"
          :disabled="!hasMap || isUpdating || isTransitioning"
          @click="handleSmartShuffle('all')"
        />
        <Button
          icon="fa-solid fa-object-ungroup"
          title="Shuffle positions"
          variant="ghost"
          :disabled="!hasMap || isUpdating || isShuffling || isTransitioning"
          @click="handleSmartShuffle('positions')"
        />
        <Button
          icon="fa-solid fa-route"
          title="Shuffle paths"
          variant="ghost"
          :disabled="!hasMap || isUpdating || isShuffling || isTransitioning"
          @click="handleSmartShuffle('paths')"
        />
        <Button
          icon="fa-solid fa-draw-polygon"
          title="Shuffle areas"
          variant="ghost"
          :disabled="!hasMap || isUpdating || isShuffling || isTransitioning"
          @click="handleSmartShuffle('areas')"
        />
        <Button
          icon="fa-solid fa-palette"
          title="Shuffle style"
          variant="ghost"
          :disabled="!hasMap || isUpdating || isShuffling || isTransitioning"
          @click="handleSmartShuffle('style')"
        />
        <Button
          icon="fa-solid fa-copy"
          title="Copy map JSON"
          variant="ghost"
          :loading="isCopying"
          :disabled="!hasMap || isUpdating || isShuffling || isTransitioning"
          @click="copyMap"
        />
        <Button
          icon="fa-solid fa-wand-magic-sparkles"
          title="Create or update map"
          :loading="isUpdating"
          :disabled="isShuffling || isTransitioning"
          @click="updateMap"
        />
        <Button
          icon="fa-solid fa-trash"
          title="Remove map"
          variant="danger"
          :disabled="!hasMap || isUpdating || isShuffling || isTransitioning"
          @click="handleRemoveMap"
        />
      </div>
    </div>

    <div class="world-map-panel__instructions">
      <Checkbox
        v-model="includeLorebookEntries"
        label="Send whole lorebook entries"
        description="Include all enabled entries from active lorebooks in this map request."
        :disabled="isUpdating || isShuffling || isTransitioning"
      />
      <textarea
        v-model="updateInstructions"
        class="world-map-panel__instructions-input"
        rows="3"
        placeholder="Optional map instructions for this update"
        :disabled="isUpdating || isShuffling || isTransitioning"
      ></textarea>
    </div>

    <div v-if="!hasMap" class="world-map-panel__empty">
      <i class="fa-solid fa-map-location-dot"></i>
      <span>No world map exists for this chat yet.</span>
      <Button icon="fa-solid fa-wand-magic-sparkles" :loading="isUpdating" @click="updateMap">Create Map</Button>
    </div>

    <div v-else class="world-map-panel__body">
      <svg
        ref="svgRef"
        class="world-map-panel__canvas"
        :class="{ 'is-dragging': isDragging }"
        :viewBox="svgViewBox"
        preserveAspectRatio="none"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
      >
        <defs v-html="defsHtml"></defs>
        <rect
          x="0"
          y="0"
          :width="viewport.width"
          :height="viewport.height"
          :fill="activeView?.view?.background || '#20252b'"
        />
        <g :transform="cameraTransform">
          <rect
            :x="getMapBounds().minX - 4000"
            :y="getMapBounds().minY - 4000"
            :width="getMapBounds().width + 8000"
            :height="getMapBounds().height + 8000"
            :fill="activeView?.view?.background || '#20252b'"
          />
          <g class="world-map-panel__areas" :opacity="transitionSceneOpacity">
            <polygon
              v-for="area in activeAreas"
              :key="area.id"
              :points="polygonPoints(area.points)"
              :fill="mapAreaStyle(area).fill"
              :stroke="mapAreaStyle(area).stroke"
              :opacity="mapAreaStyle(area).opacity"
            />
            <text
              v-for="area in activeAreas.filter((item) => item.label)"
              :key="`${area.id}-label`"
              :x="area.points.reduce((sum, point) => sum + point.x, 0) / area.points.length"
              :y="area.points.reduce((sum, point) => sum + point.y, 0) / area.points.length"
              class="world-map-panel__area-label"
              text-anchor="middle"
            >
              {{ area.label }}
            </text>
          </g>
          <g class="world-map-panel__connections" :opacity="transitionSceneOpacity">
            <path
              v-for="connection in visibleConnections"
              :key="connection.id"
              :d="connectionPath(connection)"
              :stroke="connectionStyle(connection).stroke"
              :stroke-width="connectionStyle(connection).width"
              :stroke-dasharray="connectionStyle(connection).dash"
              :stroke-linecap="connectionStyle(connection).linecap"
            />
          </g>
          <g class="world-map-panel__nodes">
            <g
              v-for="node in activeChildren"
              :key="node.id"
              class="world-map-panel__node"
              @dblclick.stop="handleNodeDoubleClick(node)"
              @pointerenter="hoveredNodeId = node.id"
              @pointerleave="hoveredNodeId = hoveredNodeId === node.id ? null : hoveredNodeId"
            >
              <rect
                class="world-map-panel__node-area"
                :x="getNodeBounds(node).x"
                :y="getNodeBounds(node).y"
                :width="getNodeBounds(node).width"
                :height="getNodeBounds(node).height"
                rx="10"
                :fill="nodeAreaStyle(node).fill"
                :stroke="nodeAreaStyle(node).stroke"
                :opacity="getNodeAreaOpacity(node)"
              />
              <circle
                :cx="nodeCenter(node).x"
                :cy="nodeCenter(node).y"
                :r="nodeRadius(node)"
                :fill="nodeColor(node)"
                :opacity="getNodeOpacity(node, 'icon')"
              />
              <use
                v-if="nodeIconHref(node)"
                :href="nodeIconHref(node) ?? undefined"
                :x="nodeCenter(node).x - 13"
                :y="nodeCenter(node).y - 13"
                width="26"
                height="26"
                fill="#ffffff"
                :opacity="getNodeOpacity(node, 'icon')"
              />
              <path
                v-else
                :d="iconPath(node.kind)"
                :transform="`translate(${nodeCenter(node).x - 12} ${nodeCenter(node).y - 12}) scale(1)`"
                fill="#ffffff"
                :opacity="getNodeOpacity(node, 'icon')"
              />
              <circle
                v-if="hasChildren(node)"
                :cx="nodeCenter(node).x + 24"
                :cy="nodeCenter(node).y - 24"
                r="11"
                fill="#111820"
                stroke="#ffffff"
                stroke-width="2"
                :opacity="getNodeOpacity(node, 'icon')"
              />
              <path
                v-if="hasChildren(node)"
                :transform="`translate(${nodeCenter(node).x + 17} ${nodeCenter(node).y - 31}) scale(0.58)`"
                d="M4 6 12 2l8 4-8 4-8-4Zm0 5 8 4 8-4v3l-8 4-8-4v-3Z"
                fill="#ffffff"
                :opacity="getNodeOpacity(node, 'icon')"
              />
            </g>
          </g>
        </g>
        <g class="world-map-panel__label-layer">
          <g
            v-for="label in visibleNodeLabels"
            :key="`${label.node.id}-label`"
            class="world-map-panel__node-label"
            :class="{ 'is-forced': label.forced }"
            :opacity="transitionNodeId === label.node.id ? transitionIconOpacity : transitionSceneOpacity"
          >
            <rect :x="label.x" :y="label.y" :width="label.width" :height="label.height" rx="5" />
            <text
              :x="labelTextX(label)"
              :y="labelTextY(label)"
              :text-anchor="label.anchor"
              :dominant-baseline="label.dominantBaseline"
            >
              {{ label.node.name }}
            </text>
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.world-map-panel {
  display: flex;
  flex-direction: column;
  min-height: 70vh;
  color: var(--theme-text-color-primary);
}

.world-map-panel__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--theme-border-color);
}

.world-map-panel__path,
.world-map-panel__actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.world-map-panel__path {
  min-width: 0;
  overflow: hidden;
}

.world-map-panel__crumb {
  border: 0;
  background: transparent;
  color: var(--theme-text-color-primary);
  cursor: pointer;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.world-map-panel__crumb + .world-map-panel__crumb::before {
  content: '/';
  margin-right: var(--spacing-xs);
  color: var(--theme-text-color-secondary);
}

.world-map-panel__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  min-height: 520px;
  color: var(--theme-text-color-secondary);
}

.world-map-panel__instructions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--theme-border-color);
}

.world-map-panel__instructions-input {
  display: block;
  width: 100%;
  min-height: 76px;
  resize: vertical;
  padding: var(--spacing-sm);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background: var(--theme-background-tint);
  color: var(--theme-text-color);
  font: inherit;
  line-height: 1.35;
}

.world-map-panel__instructions-input::placeholder {
  color: var(--theme-text-color-secondary);
}

.world-map-panel__instructions-input:focus {
  border-color: var(--theme-quote-color);
  outline: none;
}

.world-map-panel__empty i {
  font-size: 3rem;
}

.world-map-panel__body {
  min-height: 640px;
}

.world-map-panel__canvas {
  width: 100%;
  height: 70vh;
  min-height: 640px;
  background: #20252b;
  cursor: grab;
  touch-action: none;
}

.world-map-panel__connections path {
  fill: none;
  opacity: 0.82;
}

.world-map-panel__areas polygon {
  stroke-width: 2;
}

.world-map-panel__area-label {
  fill: rgba(244, 240, 232, 0.44);
  font-size: 24px;
  font-weight: 800;
  paint-order: stroke;
  pointer-events: none;
  stroke: rgba(17, 24, 32, 0.7);
  stroke-width: 6px;
  text-transform: uppercase;
}

.world-map-panel__node {
  cursor: pointer;
}

.world-map-panel__node-area {
  stroke-width: 2;
}

.world-map-panel__label-layer {
  pointer-events: none;
}

.world-map-panel__node-label rect {
  fill: rgba(13, 18, 24, 0.78);
  stroke: rgba(255, 255, 255, 0.22);
  stroke-width: 1;
}

.world-map-panel__node-label text {
  fill: #f4f0e8;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}

.world-map-panel__node-label.is-forced rect {
  fill: rgba(13, 18, 24, 0.94);
  stroke: rgba(255, 255, 255, 0.72);
  stroke-width: 1.5;
}

@media (max-width: 900px) {
  .world-map-panel__toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
