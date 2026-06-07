import type {
  WorldMapArea,
  WorldMapBounds,
  WorldMapConnection,
  WorldMapDocument,
  WorldMapNode,
  WorldMapNodeKind,
  WorldMapPoint,
} from './types';

export type WorldMapShuffleMode = 'all' | 'positions' | 'paths' | 'areas' | 'style';

interface Rect extends WorldMapBounds {
  id: string;
}

interface LayoutNode {
  id: string;
  node: WorldMapNode;
  original: WorldMapBounds;
  bounds: WorldMapBounds;
}

interface RoutedPath {
  id: string;
  points: WorldMapPoint[];
}

interface RouteChoice {
  points?: WorldMapPoint[];
  smoothPath?: boolean;
}

const KIND_SIZE_LIMITS: Record<WorldMapNodeKind, { minWidth: number; minHeight: number; maxRatio: number }> = {
  world: { minWidth: 260, minHeight: 180, maxRatio: 0.95 },
  region: { minWidth: 220, minHeight: 160, maxRatio: 0.9 },
  settlement: { minWidth: 160, minHeight: 110, maxRatio: 0.72 },
  district: { minWidth: 140, minHeight: 96, maxRatio: 0.62 },
  building: { minWidth: 84, minHeight: 68, maxRatio: 0.28 },
  floor: { minWidth: 120, minHeight: 72, maxRatio: 0.9 },
  room: { minWidth: 58, minHeight: 42, maxRatio: 0.42 },
  landmark: { minWidth: 72, minHeight: 54, maxRatio: 0.34 },
  poi: { minWidth: 44, minHeight: 36, maxRatio: 0.22 },
};

const STYLE_PALETTES = [
  {
    area: ['#6f8f4f', '#466b43', '#8fa85f', '#6e6b5c', '#4d7a73'],
    connection: ['#7d6b4f', '#9a815d', '#66717f', '#7a8560'],
    label: { color: '#f5f7f0', background: 'rgba(24,30,32,0.72)' },
  },
  {
    area: ['#587a8f', '#395869', '#7c9baa', '#56616b', '#69806e'],
    connection: ['#8a785f', '#b19a72', '#5d7482', '#7d8b74'],
    label: { color: '#f7fbff', background: 'rgba(20,28,36,0.74)' },
  },
  {
    area: ['#7f6f95', '#5d5271', '#9a8ab1', '#5f6f79', '#74805c'],
    connection: ['#887761', '#a78c68', '#706b84', '#75806a'],
    label: { color: '#fffaf4', background: 'rgba(34,28,38,0.74)' },
  },
];

const ICON_COLORS = ['#5d8aa8', '#7d8f5a', '#a8835d', '#8a6fb0', '#b06f7d', '#5a9b8f', '#b39b4f', '#6f83b0', '#8f7f6a'];

const DEFAULT_KIND_ICON_IDS: Record<WorldMapNodeKind, string> = {
  world: 'smart_world',
  region: 'smart_region',
  settlement: 'smart_settlement',
  district: 'smart_district',
  building: 'smart_building',
  floor: 'smart_floor',
  room: 'smart_room',
  landmark: 'smart_landmark',
  poi: 'smart_poi',
};

const DEFAULT_CONNECTION_STYLE_IDS: Record<WorldMapConnection['kind'], string> = {
  road: 'smart_road',
  path: 'smart_path',
  corridor: 'smart_corridor',
  door: 'smart_door',
  stairs: 'smart_stairs',
  elevator: 'smart_elevator',
  portal: 'smart_portal',
  adjacent: 'smart_adjacent',
  unknown: 'smart_unknown',
};

function cloneMap(map: WorldMapDocument): WorldMapDocument {
  return JSON.parse(JSON.stringify(map)) as WorldMapDocument;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getViewSize(node: WorldMapNode): { width: number; height: number } {
  if (node.view) return { width: node.view.width, height: node.view.height };
  if (node.kind === 'building') return { width: 900, height: 650 };
  if (node.kind === 'floor') return { width: 800, height: 600 };
  if (['world', 'region', 'settlement', 'district'].includes(node.kind)) return { width: 1200, height: 800 };
  return { width: 600, height: 400 };
}

function getBounds(node: WorldMapNode): WorldMapBounds {
  return node.bounds ?? { x: 80, y: 80, width: 96, height: 72 };
}

function center(bounds: WorldMapBounds): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function edgePoint(bounds: WorldMapBounds, toward: WorldMapPoint): WorldMapPoint {
  const boundsCenter = center(bounds);
  const dx = toward.x - boundsCenter.x;
  const dy = toward.y - boundsCenter.y;
  if (dx === 0 && dy === 0) return boundsCenter;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : bounds.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : bounds.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return {
    x: Math.round(boundsCenter.x + dx * scale),
    y: Math.round(boundsCenter.y + dy * scale),
  };
}

function inflateRect(bounds: WorldMapBounds, padding: number): WorldMapBounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function rectsOverlap(first: WorldMapBounds, second: WorldMapBounds): boolean {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

function clampBounds(bounds: WorldMapBounds, view: { width: number; height: number }, padding: number): WorldMapBounds {
  const maxX = Math.max(padding, view.width - bounds.width - padding);
  const maxY = Math.max(padding, view.height - bounds.height - padding);
  return {
    ...bounds,
    x: clamp(bounds.x, padding, maxX),
    y: clamp(bounds.y, padding, maxY),
  };
}

function normalizeBounds(
  node: WorldMapNode,
  bounds: WorldMapBounds,
  view: { width: number; height: number },
): WorldMapBounds {
  const limits = KIND_SIZE_LIMITS[node.kind] ?? KIND_SIZE_LIMITS.poi;
  const maxWidth = Math.max(limits.minWidth, view.width * limits.maxRatio);
  const maxHeight = Math.max(limits.minHeight, view.height * limits.maxRatio);
  return {
    x: bounds.x,
    y: bounds.y,
    width: clamp(bounds.width, limits.minWidth, maxWidth),
    height: clamp(bounds.height, limits.minHeight, maxHeight),
  };
}

function getChildrenByParent(map: WorldMapDocument): Map<string, WorldMapNode[]> {
  const childrenByParent = new Map<string, WorldMapNode[]>();
  for (const node of Object.values(map.nodes)) {
    if (!node.parentId || !map.nodes[node.parentId]) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  return childrenByParent;
}

function connectionsForChildren(children: LayoutNode[], connections: WorldMapConnection[]): WorldMapConnection[] {
  const ids = new Set(children.map((child) => child.id));
  return connections.filter((connection) => ids.has(connection.fromNodeId) && ids.has(connection.toNodeId));
}

function scaleChildrenIntoView(children: LayoutNode[], view: { width: number; height: number }, padding: number): void {
  if (children.length === 0) return;
  const minX = Math.min(...children.map((child) => child.bounds.x));
  const minY = Math.min(...children.map((child) => child.bounds.y));
  const maxX = Math.max(...children.map((child) => child.bounds.x + child.bounds.width));
  const maxY = Math.max(...children.map((child) => child.bounds.y + child.bounds.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  if (width <= view.width - padding * 2 && height <= view.height - padding * 2 && minX >= 0 && minY >= 0) return;
  const scale = Math.min((view.width - padding * 2) / width, (view.height - padding * 2) / height);
  for (const child of children) {
    child.bounds = {
      x: padding + (child.bounds.x - minX) * scale,
      y: padding + (child.bounds.y - minY) * scale,
      width: child.bounds.width * scale,
      height: child.bounds.height * scale,
    };
  }
}

function layoutFloors(children: LayoutNode[], view: { width: number; height: number }, rng: () => number): void {
  const sorted = [...children].sort((first, second) => {
    const floorDelta = (first.node.floorIndex ?? 0) - (second.node.floorIndex ?? 0);
    return floorDelta || first.node.name.localeCompare(second.node.name);
  });
  const padding = 24;
  const gap = 12;
  const horizontal = view.width > view.height * 1.15 && rng() > 0.55;
  if (horizontal) {
    const width = Math.max(72, (view.width - padding * 2 - gap * (sorted.length - 1)) / Math.max(1, sorted.length));
    for (const [index, child] of sorted.entries()) {
      child.bounds = {
        x: padding + index * (width + gap),
        y: padding,
        width,
        height: Math.max(80, view.height - padding * 2),
      };
    }
  } else {
    const height = Math.max(52, (view.height - padding * 2 - gap * (sorted.length - 1)) / Math.max(1, sorted.length));
    for (const [index, child] of sorted.entries()) {
      child.bounds = {
        x: padding,
        y: padding + index * (height + gap),
        width: Math.max(80, view.width - padding * 2),
        height,
      };
    }
  }
}

function layoutRooms(children: LayoutNode[], view: { width: number; height: number }, rng: () => number): void {
  const sorted = [...children].sort((first, second) => first.node.name.localeCompare(second.node.name));
  const padding = 28;
  const gap = 18;
  const variant = Math.floor(rng() * 3);

  if (variant === 0) {
    const columns = Math.ceil(Math.sqrt(sorted.length));
    const rows = Math.ceil(sorted.length / columns);
    const cellWidth = (view.width - padding * 2 - gap * (columns - 1)) / columns;
    const cellHeight = (view.height - padding * 2 - gap * (rows - 1)) / rows;
    for (const [index, child] of sorted.entries()) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      child.bounds = {
        x: padding + column * (cellWidth + gap) + cellWidth * 0.08,
        y: padding + row * (cellHeight + gap) + cellHeight * 0.08,
        width: Math.max(54, cellWidth * randomBetween(rng, 0.62, 0.86)),
        height: Math.max(42, cellHeight * randomBetween(rng, 0.55, 0.82)),
      };
    }
    return;
  }

  const horizontal = variant === 1;
  const slots = sorted.length;
  for (const [index, child] of sorted.entries()) {
    if (horizontal) {
      const width = (view.width - padding * 2 - gap * (slots - 1)) / slots;
      child.bounds = {
        x: padding + index * (width + gap),
        y: randomBetween(rng, padding, Math.max(padding, view.height * 0.44)),
        width: Math.max(54, width * randomBetween(rng, 0.68, 0.9)),
        height: Math.max(42, view.height * randomBetween(rng, 0.18, 0.28)),
      };
    } else {
      const height = (view.height - padding * 2 - gap * (slots - 1)) / slots;
      child.bounds = {
        x: randomBetween(rng, padding, Math.max(padding, view.width * 0.5)),
        y: padding + index * (height + gap),
        width: Math.max(54, view.width * randomBetween(rng, 0.2, 0.34)),
        height: Math.max(42, height * randomBetween(rng, 0.68, 0.9)),
      };
    }
  }
}

function applyForceLayout(
  children: LayoutNode[],
  connections: WorldMapConnection[],
  view: { width: number; height: number },
  rng: () => number,
): void {
  const padding = 26;
  scaleChildrenIntoView(children, view, padding);
  for (const child of children) {
    child.bounds = normalizeBounds(child.node, child.bounds, view);
    child.bounds.x += randomBetween(rng, -54, 54);
    child.bounds.y += randomBetween(rng, -54, 54);
    child.bounds = clampBounds(child.bounds, view, padding);
  }
  applySeededLayoutVariant(children, view, padding, rng);

  const connectedPairs = connections
    .map((connection) => ({
      from: children.find((child) => child.id === connection.fromNodeId),
      to: children.find((child) => child.id === connection.toNodeId),
    }))
    .filter((pair): pair is { from: LayoutNode; to: LayoutNode } => Boolean(pair.from && pair.to));

  for (let iteration = 0; iteration < 92; iteration += 1) {
    const forces = new Map<string, { x: number; y: number }>();
    for (const child of children) forces.set(child.id, { x: 0, y: 0 });

    for (let firstIndex = 0; firstIndex < children.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < children.length; secondIndex += 1) {
        const first = children[firstIndex];
        const second = children[secondIndex];
        const firstCenter = center(first.bounds);
        const secondCenter = center(second.bounds);
        const dx = secondCenter.x - firstCenter.x || randomBetween(rng, -1, 1);
        const dy = secondCenter.y - firstCenter.y || randomBetween(rng, -1, 1);
        const distance = Math.max(1, Math.hypot(dx, dy));
        const desired =
          (Math.hypot(first.bounds.width, first.bounds.height) +
            Math.hypot(second.bounds.width, second.bounds.height)) *
          0.42;
        const overlapBoost = rectsOverlap(inflateRect(first.bounds, 14), inflateRect(second.bounds, 14)) ? 7.5 : 1;
        const strength = Math.max(0, desired - distance) * 0.045 * overlapBoost;
        const fx = (dx / distance) * strength;
        const fy = (dy / distance) * strength;
        forces.get(first.id)!.x -= fx;
        forces.get(first.id)!.y -= fy;
        forces.get(second.id)!.x += fx;
        forces.get(second.id)!.y += fy;
      }
    }

    for (const pair of connectedPairs) {
      const fromCenter = center(pair.from.bounds);
      const toCenter = center(pair.to.bounds);
      const dx = toCenter.x - fromCenter.x;
      const dy = toCenter.y - fromCenter.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const target = pair.from.node.kind === 'room' || pair.to.node.kind === 'room' ? 150 : 245;
      const strength = (distance - target) * 0.012;
      const fx = (dx / distance) * strength;
      const fy = (dy / distance) * strength;
      forces.get(pair.from.id)!.x += fx;
      forces.get(pair.from.id)!.y += fy;
      forces.get(pair.to.id)!.x -= fx;
      forces.get(pair.to.id)!.y -= fy;
    }

    for (const child of children) {
      const childCenter = center(child.bounds);
      const originalCenter = center(child.original);
      const force = forces.get(child.id)!;
      force.x += (originalCenter.x - childCenter.x) * 0.0012;
      force.y += (originalCenter.y - childCenter.y) * 0.0012;
      child.bounds.x += clamp(force.x, -18, 18);
      child.bounds.y += clamp(force.y, -18, 18);
      child.bounds = clampBounds(child.bounds, view, padding);
    }
  }
  resolveCollisions(children, view, padding, rng);
}

function applySeededLayoutVariant(
  children: LayoutNode[],
  view: { width: number; height: number },
  padding: number,
  rng: () => number,
): void {
  if (children.length < 3) return;
  const nonRoomCount = children.filter((child) => child.node.kind !== 'room').length;
  const variantStrength = nonRoomCount >= 3 ? 0.58 : 0.35;
  const usableWidth = Math.max(1, view.width - padding * 2);
  const usableHeight = Math.max(1, view.height - padding * 2);
  const variant = Math.floor(rng() * 3);
  if (variant === 1) {
    applyGridLayoutVariant(children, view, padding, rng, variantStrength);
    return;
  }
  if (variant === 2) {
    applyBandLayoutVariant(children, view, padding, rng, variantStrength);
    return;
  }
  const radiusX = usableWidth * randomBetween(rng, 0.22, 0.38);
  const radiusY = usableHeight * randomBetween(rng, 0.2, 0.34);
  const startAngle = randomBetween(rng, 0, Math.PI * 2);
  const sorted = [...children].sort((first, second) => first.node.name.localeCompare(second.node.name));

  for (const [index, child] of sorted.entries()) {
    const angle = startAngle + (Math.PI * 2 * index) / sorted.length + randomBetween(rng, -0.28, 0.28);
    const targetCenter = {
      x: view.width / 2 + Math.cos(angle) * radiusX,
      y: view.height / 2 + Math.sin(angle) * radiusY,
    };
    const currentCenter = center(child.bounds);
    child.bounds.x += (targetCenter.x - currentCenter.x) * variantStrength;
    child.bounds.y += (targetCenter.y - currentCenter.y) * variantStrength;
    child.bounds = clampBounds(child.bounds, view, padding);
  }
}

function applyGridLayoutVariant(
  children: LayoutNode[],
  view: { width: number; height: number },
  padding: number,
  rng: () => number,
  strength: number,
): void {
  const sorted = [...children].sort((first, second) => first.node.name.localeCompare(second.node.name));
  const columns = Math.ceil(Math.sqrt(sorted.length * randomBetween(rng, 0.8, 1.35)));
  const rows = Math.ceil(sorted.length / columns);
  const cellWidth = (view.width - padding * 2) / columns;
  const cellHeight = (view.height - padding * 2) / rows;
  for (const [index, child] of sorted.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const targetCenter = {
      x: padding + cellWidth * (column + randomBetween(rng, 0.32, 0.68)),
      y: padding + cellHeight * (row + randomBetween(rng, 0.32, 0.68)),
    };
    const currentCenter = center(child.bounds);
    child.bounds.x += (targetCenter.x - currentCenter.x) * strength;
    child.bounds.y += (targetCenter.y - currentCenter.y) * strength;
    child.bounds = clampBounds(child.bounds, view, padding);
  }
}

function applyBandLayoutVariant(
  children: LayoutNode[],
  view: { width: number; height: number },
  padding: number,
  rng: () => number,
  strength: number,
): void {
  const sorted = [...children].sort((first, second) => first.node.name.localeCompare(second.node.name));
  const horizontal = rng() > 0.5;
  for (const [index, child] of sorted.entries()) {
    const t = sorted.length === 1 ? 0.5 : index / (sorted.length - 1);
    const targetCenter = horizontal
      ? {
          x: padding + (view.width - padding * 2) * randomBetween(rng, 0.22, 0.78),
          y: padding + (view.height - padding * 2) * (0.18 + t * 0.64),
        }
      : {
          x: padding + (view.width - padding * 2) * (0.18 + t * 0.64),
          y: padding + (view.height - padding * 2) * randomBetween(rng, 0.22, 0.78),
        };
    const currentCenter = center(child.bounds);
    child.bounds.x += (targetCenter.x - currentCenter.x) * strength;
    child.bounds.y += (targetCenter.y - currentCenter.y) * strength;
    child.bounds = clampBounds(child.bounds, view, padding);
  }
}

function resolveCollisions(
  children: LayoutNode[],
  view: { width: number; height: number },
  padding: number,
  rng: () => number,
): void {
  for (let iteration = 0; iteration < 80; iteration += 1) {
    let changed = false;
    for (let firstIndex = 0; firstIndex < children.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < children.length; secondIndex += 1) {
        const first = children[firstIndex];
        const second = children[secondIndex];
        const firstRect = inflateRect(first.bounds, 8);
        const secondRect = inflateRect(second.bounds, 8);
        if (!rectsOverlap(firstRect, secondRect)) continue;
        const firstCenter = center(first.bounds);
        const secondCenter = center(second.bounds);
        const dx = secondCenter.x - firstCenter.x || randomBetween(rng, -1, 1);
        const dy = secondCenter.y - firstCenter.y || randomBetween(rng, -1, 1);
        const overlapX = Math.min(
          firstRect.x + firstRect.width - secondRect.x,
          secondRect.x + secondRect.width - firstRect.x,
        );
        const overlapY = Math.min(
          firstRect.y + firstRect.height - secondRect.y,
          secondRect.y + secondRect.height - firstRect.y,
        );
        if (overlapX < overlapY) {
          const push = overlapX / 2 + 3;
          first.bounds.x -= Math.sign(dx) * push;
          second.bounds.x += Math.sign(dx) * push;
        } else {
          const push = overlapY / 2 + 3;
          first.bounds.y -= Math.sign(dy) * push;
          second.bounds.y += Math.sign(dy) * push;
        }
        first.bounds = clampBounds(first.bounds, view, padding);
        second.bounds = clampBounds(second.bounds, view, padding);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function smartShufflePositions(map: WorldMapDocument, rng: () => number): void {
  const childrenByParent = getChildrenByParent(map);
  for (const [parentId, children] of childrenByParent) {
    const parent = map.nodes[parentId];
    if (!parent) continue;
    const bounded = children.filter((node) => node.bounds);
    if (bounded.length < 2) continue;
    const view = getViewSize(parent);
    const layoutChildren = bounded.map((node) => ({
      id: node.id,
      node,
      original: getBounds(node),
      bounds: getBounds(node),
    }));
    if (layoutChildren.every((child) => child.node.kind === 'floor')) {
      layoutFloors(layoutChildren, view, rng);
    } else if (layoutChildren.every((child) => child.node.kind === 'room')) {
      layoutRooms(layoutChildren, view, rng);
      resolveCollisions(layoutChildren, view, 24, rng);
    } else {
      applyForceLayout(layoutChildren, connectionsForChildren(layoutChildren, map.connections), view, rng);
    }
    for (const child of layoutChildren) {
      map.nodes[child.id] = {
        ...map.nodes[child.id],
        bounds: {
          x: Math.round(child.bounds.x),
          y: Math.round(child.bounds.y),
          width: Math.round(child.bounds.width),
          height: Math.round(child.bounds.height),
        },
      };
    }
  }
}

function createObstacleElbowCandidates(
  from: WorldMapPoint,
  to: WorldMapPoint,
  obstacles: Rect[],
  rng: () => number,
): WorldMapPoint[][] {
  const blocking = obstacles.find((obstacle) => lineIntersectsRect(from, to, inflateRect(obstacle, 18)));
  if (!blocking) return [];
  const inflated = inflateRect(blocking, 30);
  const horizontalOptions = [inflated.x - 18, inflated.x + inflated.width + 18].sort(
    (first, second) => Math.abs(first - from.x) - Math.abs(second - from.x),
  );
  const verticalOptions = [inflated.y - 18, inflated.y + inflated.height + 18].sort(
    (first, second) => Math.abs(first - from.y) - Math.abs(second - from.y),
  );
  const candidates =
    rng() > 0.5
      ? [
          ...horizontalOptions.map((x) => [
            { x: Math.round(x), y: Math.round(from.y) },
            { x: Math.round(x), y: Math.round(to.y) },
          ]),
          ...verticalOptions.map((y) => [
            { x: Math.round(from.x), y: Math.round(y) },
            { x: Math.round(to.x), y: Math.round(y) },
          ]),
        ]
      : [
          ...verticalOptions.map((y) => [
            { x: Math.round(from.x), y: Math.round(y) },
            { x: Math.round(to.x), y: Math.round(y) },
          ]),
          ...horizontalOptions.map((x) => [
            { x: Math.round(x), y: Math.round(from.y) },
            { x: Math.round(x), y: Math.round(to.y) },
          ]),
        ];
  return [
    ...candidates.filter((points) => !pathIntersectsObstacles([from, ...points, to], obstacles)),
    ...candidates.filter((points) => pathIntersectsObstacles([from, ...points, to], obstacles)),
  ];
}

function createSoftBendCandidates(from: WorldMapPoint, to: WorldMapPoint, rng: () => number): WorldMapPoint[][] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 80) return [];
  const candidates: WorldMapPoint[][] = [];
  for (const variant of [0, 1, 2, 3]) {
    candidates.push(createSoftBendVariant(from, to, variant, rng));
  }
  return rng() > 0.5 ? candidates : candidates.reverse();
}

function createSoftBendVariant(
  from: WorldMapPoint,
  to: WorldMapPoint,
  variant: number,
  rng: () => number,
): WorldMapPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  if (variant === 0) {
    const mix = randomBetween(rng, 0.35, 0.65);
    const midX = Math.round(from.x + dx * mix);
    return [
      { x: midX, y: Math.round(from.y) },
      { x: midX, y: Math.round(to.y) },
    ];
  }
  if (variant === 1) {
    const mix = randomBetween(rng, 0.35, 0.65);
    const midY = Math.round(from.y + dy * mix);
    return [
      { x: Math.round(from.x), y: midY },
      { x: Math.round(to.x), y: midY },
    ];
  }
  const normal = { x: -dy / distance, y: dx / distance };
  const direction = rng() > 0.5 ? 1 : -1;
  const offset = direction * randomBetween(rng, 0.08, variant === 2 ? 0.22 : 0.32) * Math.min(distance, 420);
  const firstT = variant === 2 ? randomBetween(rng, 0.35, 0.45) : randomBetween(rng, 0.22, 0.34);
  const secondT = variant === 2 ? randomBetween(rng, 0.55, 0.65) : randomBetween(rng, 0.66, 0.78);
  return [
    {
      x: Math.round(from.x + dx * firstT + normal.x * offset),
      y: Math.round(from.y + dy * firstT + normal.y * offset),
    },
    {
      x: Math.round(from.x + dx * secondT - normal.x * offset * (variant === 2 ? 0.35 : 0.8)),
      y: Math.round(from.y + dy * secondT - normal.y * offset * (variant === 2 ? 0.35 : 0.8)),
    },
  ];
}

function pathIntersectsObstacles(points: WorldMapPoint[], obstacles: Rect[]): boolean {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (obstacles.some((obstacle) => lineIntersectsRect(points[index], points[index + 1], inflateRect(obstacle, 14)))) {
      return true;
    }
  }
  return false;
}

function lineIntersectsRect(from: WorldMapPoint, to: WorldMapPoint, rect: WorldMapBounds): boolean {
  if (
    (from.x < rect.x && to.x < rect.x) ||
    (from.x > rect.x + rect.width && to.x > rect.x + rect.width) ||
    (from.y < rect.y && to.y < rect.y) ||
    (from.y > rect.y + rect.height && to.y > rect.y + rect.height)
  ) {
    return false;
  }
  const steps = 18;
  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return true;
  }
  return false;
}

function routePoints(from: WorldMapPoint, via: WorldMapPoint[] | undefined, to: WorldMapPoint): WorldMapPoint[] {
  return [from, ...(via ?? []), to];
}

function quadraticPoint(start: WorldMapPoint, control: WorldMapPoint, end: WorldMapPoint, t: number): WorldMapPoint {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  };
}

function sampleQuadratic(
  start: WorldMapPoint,
  control: WorldMapPoint,
  end: WorldMapPoint,
  samples: number,
): WorldMapPoint[] {
  const points: WorldMapPoint[] = [];
  for (let index = 1; index <= samples; index += 1) {
    points.push(quadraticPoint(start, control, end, index / samples));
  }
  return points;
}

function renderedRoutePoints(points: WorldMapPoint[], smoothPath: boolean): WorldMapPoint[] {
  if (!smoothPath || points.length <= 2) return points;
  const rendered: WorldMapPoint[] = [points[0]];
  let cursor = points[0];
  for (let index = 1; index < points.length - 2; index += 1) {
    const midpoint = {
      x: (points[index].x + points[index + 1].x) / 2,
      y: (points[index].y + points[index + 1].y) / 2,
    };
    const samples = sampleQuadratic(cursor, points[index], midpoint, 6);
    rendered.push(...samples);
    cursor = midpoint;
  }
  rendered.push(...sampleQuadratic(cursor, points[points.length - 2], points[points.length - 1], 6));
  return normalizeRoutePoints(rendered);
}

function samePoint(first: WorldMapPoint, second: WorldMapPoint): boolean {
  return Math.round(first.x) === Math.round(second.x) && Math.round(first.y) === Math.round(second.y);
}

function isCollinear(first: WorldMapPoint, second: WorldMapPoint, third: WorldMapPoint): boolean {
  const cross = (second.x - first.x) * (third.y - second.y) - (second.y - first.y) * (third.x - second.x);
  return Math.abs(cross) < 0.001;
}

function normalizeRoutePoints(points: WorldMapPoint[]): WorldMapPoint[] {
  const rounded = points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
  const deduped: WorldMapPoint[] = [];
  for (const point of rounded) {
    if (!deduped.at(-1) || !samePoint(deduped.at(-1)!, point)) deduped.push(point);
  }
  const normalized: WorldMapPoint[] = [];
  for (const point of deduped) {
    normalized.push(point);
    while (
      normalized.length >= 3 &&
      isCollinear(
        normalized[normalized.length - 3],
        normalized[normalized.length - 2],
        normalized[normalized.length - 1],
      )
    ) {
      const last = normalized.pop()!;
      normalized.pop();
      normalized.push(last);
    }
  }
  return normalized;
}

function normalizeIntermediateRoute(
  from: WorldMapPoint,
  intermediate: WorldMapPoint[],
  to: WorldMapPoint,
): WorldMapPoint[] | undefined {
  const normalized = normalizeRoutePoints([from, ...intermediate, to]).slice(1, -1);
  return normalized.length > 0 ? normalized : undefined;
}

function distanceBetweenPoints(first: WorldMapPoint, second: WorldMapPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function distancePointToSegment(point: WorldMapPoint, start: WorldMapPoint, end: WorldMapPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceBetweenPoints(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return distanceBetweenPoints(point, { x: start.x + dx * t, y: start.y + dy * t });
}

function segmentDistance(
  firstStart: WorldMapPoint,
  firstEnd: WorldMapPoint,
  secondStart: WorldMapPoint,
  secondEnd: WorldMapPoint,
): number {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  return Math.min(
    distancePointToSegment(firstStart, secondStart, secondEnd),
    distancePointToSegment(firstEnd, secondStart, secondEnd),
    distancePointToSegment(secondStart, firstStart, firstEnd),
    distancePointToSegment(secondEnd, firstStart, firstEnd),
  );
}

function orientation(first: WorldMapPoint, second: WorldMapPoint, third: WorldMapPoint): number {
  return (second.y - first.y) * (third.x - second.x) - (second.x - first.x) * (third.y - second.y);
}

function segmentsIntersect(
  firstStart: WorldMapPoint,
  firstEnd: WorldMapPoint,
  secondStart: WorldMapPoint,
  secondEnd: WorldMapPoint,
): boolean {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);
  return firstOrientation * secondOrientation < 0 && thirdOrientation * fourthOrientation < 0;
}

function segmentAngle(start: WorldMapPoint, end: WorldMapPoint): number {
  return Math.atan2(end.y - start.y, end.x - start.x);
}

function angleDelta(first: number, second: number): number {
  const delta = Math.abs(first - second) % Math.PI;
  return Math.min(delta, Math.PI - delta);
}

function routeTurnAngle(first: WorldMapPoint, second: WorldMapPoint, third: WorldMapPoint): number {
  const firstAngle = Math.atan2(first.y - second.y, first.x - second.x);
  const secondAngle = Math.atan2(third.y - second.y, third.x - second.x);
  let delta = Math.abs(firstAngle - secondAngle);
  if (delta > Math.PI) delta = Math.PI * 2 - delta;
  return delta;
}

function scoreRouteTurns(points: WorldMapPoint[], kind: WorldMapConnection['kind']): number {
  const naturalRoute = kind === 'path' || kind === 'road';
  let score = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const length = distanceBetweenPoints(points[index], points[index + 1]);
    if (length < 36) score += naturalRoute ? 120 : 32;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const angle = routeTurnAngle(points[index - 1], points[index], points[index + 1]);
    const rightAngleDelta = Math.abs(angle - Math.PI / 2);
    if (rightAngleDelta < 0.18) score += naturalRoute ? 180 : 30;
    if (angle < 0.45) score += naturalRoute ? 90 : 20;
  }
  return score;
}

function hasOrthogonalBend(points: WorldMapPoint[]): boolean {
  for (let index = 0; index < points.length - 2; index += 1) {
    const firstHorizontal = Math.abs(points[index].y - points[index + 1].y) < 0.001;
    const firstVertical = Math.abs(points[index].x - points[index + 1].x) < 0.001;
    const secondHorizontal = Math.abs(points[index + 1].y - points[index + 2].y) < 0.001;
    const secondVertical = Math.abs(points[index + 1].x - points[index + 2].x) < 0.001;
    if ((firstHorizontal || firstVertical) && (secondHorizontal || secondVertical)) return true;
  }
  return false;
}

function scoreRouteOverlap(points: WorldMapPoint[], assignedRoutes: RoutedPath[]): number {
  let score = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const angle = segmentAngle(start, end);
    for (const route of assignedRoutes) {
      for (let routeIndex = 0; routeIndex < route.points.length - 1; routeIndex += 1) {
        const routeStart = route.points[routeIndex];
        const routeEnd = route.points[routeIndex + 1];
        const distance = segmentDistance(start, end, routeStart, routeEnd);
        if (distance === 0) score += 900;
        if (distance < 30) score += (30 - distance) * 18;
        if (distance < 56 && angleDelta(angle, segmentAngle(routeStart, routeEnd)) < 0.28) {
          score += (56 - distance) * 28;
        }
      }
    }
  }
  return score;
}

function countRouteCrossings(points: WorldMapPoint[], assignedRoutes: RoutedPath[]): number {
  let crossings = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    for (const route of assignedRoutes) {
      for (let routeIndex = 0; routeIndex < route.points.length - 1; routeIndex += 1) {
        if (segmentsIntersect(start, end, route.points[routeIndex], route.points[routeIndex + 1])) crossings += 1;
      }
    }
  }
  return crossings;
}

function scoreRouteObstacles(points: WorldMapPoint[], obstacles: Rect[]): number {
  let score = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    for (const obstacle of obstacles) {
      if (lineIntersectsRect(points[index], points[index + 1], inflateRect(obstacle, 12))) score += 2400;
    }
  }
  return score;
}

function routeLength(points: WorldMapPoint[]): number {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += distanceBetweenPoints(points[index], points[index + 1]);
  }
  return length;
}

function createRouteCandidates(
  from: WorldMapPoint,
  to: WorldMapPoint,
  obstacles: Rect[],
  kind: WorldMapConnection['kind'],
  rng: () => number,
): WorldMapPoint[][] {
  const organicCandidates = [...createSoftBendCandidates(from, to, rng), ...createOrganicArcCandidates(from, to, rng)];
  const orthogonalCandidates = [
    ...createObstacleElbowCandidates(from, to, obstacles, rng),
    ...createOrthogonalLaneCandidates(from, to, obstacles, rng),
    ...createPerimeterDetourCandidates(from, to, obstacles, rng),
  ];
  const prefersOrganic = kind === 'path' || kind === 'road';
  const candidates = prefersOrganic
    ? [...organicCandidates, ...orthogonalCandidates]
    : [...orthogonalCandidates, ...organicCandidates];
  return candidates.length > 0 ? candidates : [[]];
}

function createPerimeterDetourCandidates(
  from: WorldMapPoint,
  to: WorldMapPoint,
  obstacles: Rect[],
  rng: () => number,
): WorldMapPoint[][] {
  if (obstacles.length === 0) return [];
  const minX = Math.min(...obstacles.map((obstacle) => obstacle.x), from.x, to.x) - 96;
  const minY = Math.min(...obstacles.map((obstacle) => obstacle.y), from.y, to.y) - 96;
  const maxX = Math.max(...obstacles.map((obstacle) => obstacle.x + obstacle.width), from.x, to.x) + 96;
  const maxY = Math.max(...obstacles.map((obstacle) => obstacle.y + obstacle.height), from.y, to.y) + 96;
  const candidates = [
    [
      { x: Math.round(from.x), y: Math.round(minY) },
      { x: Math.round(to.x), y: Math.round(minY) },
    ],
    [
      { x: Math.round(from.x), y: Math.round(maxY) },
      { x: Math.round(to.x), y: Math.round(maxY) },
    ],
    [
      { x: Math.round(minX), y: Math.round(from.y) },
      { x: Math.round(minX), y: Math.round(to.y) },
    ],
    [
      { x: Math.round(maxX), y: Math.round(from.y) },
      { x: Math.round(maxX), y: Math.round(to.y) },
    ],
  ];
  return rng() > 0.5 ? candidates : candidates.reverse();
}

function createOrganicArcCandidates(from: WorldMapPoint, to: WorldMapPoint, rng: () => number): WorldMapPoint[][] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 80) return [];
  const normal = { x: -dy / distance, y: dx / distance };
  const candidates: WorldMapPoint[][] = [];
  for (const direction of [-1, 1]) {
    for (const strength of [0.12, 0.22, 0.32]) {
      const offset = direction * strength * Math.min(distance, 360);
      const drift = randomBetween(rng, -0.06, 0.06);
      candidates.push([
        {
          x: Math.round(from.x + dx * (0.32 + drift) + normal.x * offset),
          y: Math.round(from.y + dy * (0.32 + drift) + normal.y * offset),
        },
        {
          x: Math.round(from.x + dx * (0.68 - drift) + normal.x * offset * 0.75),
          y: Math.round(from.y + dy * (0.68 - drift) + normal.y * offset * 0.75),
        },
      ]);
    }
  }
  return rng() > 0.5 ? candidates : candidates.reverse();
}

function createOrthogonalLaneCandidates(
  from: WorldMapPoint,
  to: WorldMapPoint,
  obstacles: Rect[],
  rng: () => number,
): WorldMapPoint[][] {
  const xs = new Set<number>();
  const ys = new Set<number>();
  const midX = Math.round((from.x + to.x) / 2);
  const midY = Math.round((from.y + to.y) / 2);
  xs.add(midX);
  ys.add(midY);
  const obstacleExtents = obstacles.length
    ? {
        minX: Math.min(...obstacles.map((obstacle) => obstacle.x), from.x, to.x),
        minY: Math.min(...obstacles.map((obstacle) => obstacle.y), from.y, to.y),
        maxX: Math.max(...obstacles.map((obstacle) => obstacle.x + obstacle.width), from.x, to.x),
        maxY: Math.max(...obstacles.map((obstacle) => obstacle.y + obstacle.height), from.y, to.y),
      }
    : undefined;
  if (obstacleExtents) {
    xs.add(Math.round(obstacleExtents.minX - 64));
    xs.add(Math.round(obstacleExtents.maxX + 64));
    ys.add(Math.round(obstacleExtents.minY - 64));
    ys.add(Math.round(obstacleExtents.maxY + 64));
  }
  for (const obstacle of obstacles) {
    const inflated = inflateRect(obstacle, 36);
    xs.add(Math.round(inflated.x - 18));
    xs.add(Math.round(inflated.x + inflated.width + 18));
    ys.add(Math.round(inflated.y - 18));
    ys.add(Math.round(inflated.y + inflated.height + 18));
  }
  const sortedX = [...xs].sort((first, second) => Math.abs(first - midX) - Math.abs(second - midX)).slice(0, 10);
  const sortedY = [...ys].sort((first, second) => Math.abs(first - midY) - Math.abs(second - midY)).slice(0, 10);
  const candidates = [
    ...sortedX.map((x) => [
      { x, y: Math.round(from.y) },
      { x, y: Math.round(to.y) },
    ]),
    ...sortedY.map((y) => [
      { x: Math.round(from.x), y },
      { x: Math.round(to.x), y },
    ]),
    ...sortedX.flatMap((x) =>
      sortedY.flatMap((y) => [
        [
          { x, y: Math.round(from.y) },
          { x, y },
          { x: Math.round(to.x), y },
        ],
        [
          { x: Math.round(from.x), y },
          { x, y },
          { x, y: Math.round(to.y) },
        ],
      ]),
    ),
  ];
  return rng() > 0.5 ? candidates : candidates.reverse();
}

function chooseRoute(
  fromCenter: WorldMapPoint,
  fromPort: WorldMapPoint,
  toPort: WorldMapPoint,
  toCenter: WorldMapPoint,
  obstacles: Rect[],
  assignedRoutes: RoutedPath[],
  kind: WorldMapConnection['kind'],
  preferredSmoothPath: boolean,
  rng: () => number,
): RouteChoice {
  const candidates = createRouteCandidates(fromPort, toPort, obstacles, kind, rng);
  const naturalRoute = kind === 'path' || kind === 'road';
  const scored = candidates.flatMap((via) => {
    const normalizedVia = normalizeIntermediateRoute(fromCenter, [fromPort, ...via, toPort], toCenter) ?? [];
    const points = routePoints(fromCenter, normalizedVia, toCenter);
    const smoothOptions = preferredSmoothPath && !hasOrthogonalBend(points) ? [true, false] : [false];
    return smoothOptions.map((smoothPath) => {
      const renderedPoints = renderedRoutePoints(points, smoothPath);
      const obstacleScore = scoreRouteObstacles(renderedPoints, obstacles);
      const crossingCount = countRouteCrossings(renderedPoints, assignedRoutes);
      return {
        via: normalizedVia,
        smoothPath,
        obstacleScore,
        crossingCount,
        score:
          obstacleScore +
          scoreRouteOverlap(renderedPoints, assignedRoutes) +
          routeLength(renderedPoints) * 0.015 +
          normalizedVia.length * (naturalRoute ? 72 : 18) +
          scoreRouteTurns(points, kind) +
          (!smoothPath && naturalRoute ? 260 : 0),
      };
    });
  });
  const cleanCandidates = scored.filter((candidate) => candidate.obstacleScore === 0);
  const obstacleSafeCandidates = cleanCandidates.length > 0 ? cleanCandidates : scored;
  const crossingSafeCandidates = obstacleSafeCandidates.filter((candidate) => candidate.crossingCount === 0);
  const best = (crossingSafeCandidates.length > 0 ? crossingSafeCandidates : obstacleSafeCandidates).sort(
    (first, second) => first.score - second.score,
  )[0];
  return {
    points: best?.via.length ? best.via : undefined,
    smoothPath: best?.via.length && best.smoothPath ? true : undefined,
  };
}

function smartShufflePaths(map: WorldMapDocument, rng: () => number): void {
  const childrenByParent = getChildrenByParent(map);
  const parentByChild = new Map(Object.values(map.nodes).map((node) => [node.id, node.parentId]));
  const assignedRoutesByParent = new Map<string, RoutedPath[]>();
  map.connections = map.connections.map((connection) => {
    const from = map.nodes[connection.fromNodeId];
    const to = map.nodes[connection.toNodeId];
    if (!from?.bounds || !to?.bounds) return connection;
    const parentId = parentByChild.get(from.id);
    if (parentId !== parentByChild.get(to.id)) return { ...connection, points: undefined, smoothPath: undefined };
    const siblings = childrenByParent.get(parentId ?? '') ?? [];
    const obstacles = siblings
      .filter((node) => node.id !== from.id && node.id !== to.id && node.bounds)
      .map((node) => ({ id: node.id, ...getBounds(node) }));
    const fromBounds = getBounds(from);
    const toBounds = getBounds(to);
    const fromCenter = center(fromBounds);
    const toCenter = center(toBounds);
    const fromPort = edgePoint(fromBounds, toCenter);
    const toPort = edgePoint(toBounds, fromCenter);
    const assignedRoutes = assignedRoutesByParent.get(parentId ?? '') ?? [];
    const preferredSmoothPath = connection.smoothPath ?? (connection.kind === 'path' || connection.kind === 'road');
    const route = chooseRoute(
      fromCenter,
      fromPort,
      toPort,
      toCenter,
      obstacles,
      assignedRoutes,
      connection.kind,
      preferredSmoothPath,
      rng,
    );
    assignedRoutes.push({
      id: connection.id,
      points: renderedRoutePoints(routePoints(fromCenter, route.points, toCenter), Boolean(route.smoothPath)),
    });
    assignedRoutesByParent.set(parentId ?? '', assignedRoutes);
    return {
      ...connection,
      points: route.points,
      smoothPath: route.smoothPath,
    };
  });
}

function areaExtents(area: WorldMapArea): WorldMapBounds {
  const xs = area.points.map((point) => point.x);
  const ys = area.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function isRectangularArea(area: WorldMapArea): boolean {
  if (area.points.length !== 4) return false;
  const xs = new Set(area.points.map((point) => point.x));
  const ys = new Set(area.points.map((point) => point.y));
  return xs.size === 2 && ys.size === 2;
}

function densifyRectangle(area: WorldMapArea, rng: () => number): WorldMapArea {
  const bounds = areaExtents(area);
  const jitter = Math.min(bounds.width, bounds.height) * 0.08;
  const points = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width * 0.5, y: bounds.y + randomBetween(rng, -jitter, jitter) },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width + randomBetween(rng, -jitter, jitter), y: bounds.y + bounds.height * 0.5 },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height + randomBetween(rng, -jitter, jitter) },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + randomBetween(rng, -jitter, jitter), y: bounds.y + bounds.height * 0.5 },
  ];
  return { ...area, points };
}

function smartShuffleAreas(map: WorldMapDocument, rng: () => number): void {
  for (const node of Object.values(map.nodes)) {
    if (!node.areas || node.areas.length === 0) continue;
    const view = getViewSize(node);
    node.areas = node.areas.map((area) => {
      if (area.kind === 'interior') return area;
      const bounds = areaExtents(area);
      const coversView = bounds.width >= view.width * 0.92 && bounds.height >= view.height * 0.92;
      if (coversView && area.kind === 'water') return area;
      const base = isRectangularArea(area) && area.kind !== 'water' ? densifyRectangle(area, rng) : area;
      const amount = Math.min(Math.max(bounds.width, bounds.height) * 0.035, 28);
      return {
        ...base,
        points: base.points.map((point) => ({
          x: Math.round(clamp(point.x + randomBetween(rng, -amount, amount), 0, view.width)),
          y: Math.round(clamp(point.y + randomBetween(rng, -amount, amount), 0, view.height)),
        })),
      };
    });
  }
}

function ensurePack(map: WorldMapDocument) {
  const packId = map.activeVisualPackId ?? 'smart_shuffle';
  const pack = map.visualPacks?.[packId] ?? {
    id: packId,
    name: 'Smart Shuffle Style',
    icons: {},
    areaStyles: {},
    connectionStyles: {},
    labelStyles: {},
  };
  map.visualPacks = { ...(map.visualPacks ?? {}), [packId]: pack };
  map.activeVisualPackId = packId;
  pack.icons ??= {};
  pack.areaStyles ??= {};
  pack.connectionStyles ??= {};
  pack.labelStyles ??= {};
  return pack;
}

function connectionWidthRange(kind: WorldMapConnection['kind']): { min: number; max: number } {
  if (kind === 'road') return { min: 5, max: 8 };
  if (kind === 'path') return { min: 3, max: 5.5 };
  if (kind === 'corridor') return { min: 2, max: 4 };
  if (kind === 'door') return { min: 1.5, max: 3 };
  if (kind === 'stairs' || kind === 'elevator') return { min: 2, max: 4 };
  return { min: 2, max: 4.5 };
}

function inferConnectionStyleKinds(map: WorldMapDocument): Map<string, WorldMapConnection['kind']> {
  const styleKinds = new Map<string, WorldMapConnection['kind']>();
  for (const connection of map.connections) {
    const styleId = connection.visual?.styleId;
    if (styleId && !styleKinds.has(styleId)) styleKinds.set(styleId, connection.kind);
  }
  for (const [kind, styleId] of Object.entries(DEFAULT_CONNECTION_STYLE_IDS) as Array<
    [WorldMapConnection['kind'], string]
  >) {
    styleKinds.set(styleId, kind);
  }
  return styleKinds;
}

function smartShuffleStyle(map: WorldMapDocument, rng: () => number): void {
  const pack = ensurePack(map);
  const palette = STYLE_PALETTES[Math.floor(rng() * STYLE_PALETTES.length)] ?? STYLE_PALETTES[0];
  const connectionStyleKinds = inferConnectionStyleKinds(map);
  for (const [index, kind] of (
    ['world', 'region', 'settlement', 'district', 'building', 'floor', 'room', 'landmark', 'poi'] as WorldMapNodeKind[]
  ).entries()) {
    const id = DEFAULT_KIND_ICON_IDS[kind];
    pack.icons![id] ??= { id, label: `Smart ${kind}`, fallbackKind: kind };
    pack.icons![id].color = ICON_COLORS[(index + Math.floor(rng() * ICON_COLORS.length)) % ICON_COLORS.length];
  }
  for (const [index, kind] of (
    [
      'road',
      'path',
      'corridor',
      'door',
      'stairs',
      'elevator',
      'portal',
      'adjacent',
      'unknown',
    ] as WorldMapConnection['kind'][]
  ).entries()) {
    const id = DEFAULT_CONNECTION_STYLE_IDS[kind];
    const range = connectionWidthRange(kind);
    pack.connectionStyles![id] ??= { id, label: `Smart ${kind}` };
    pack.connectionStyles![id].stroke = palette.connection[index % palette.connection.length];
    pack.connectionStyles![id].width = randomBetween(rng, range.min, range.max);
    pack.connectionStyles![id].linecap = 'round';
    pack.connectionStyles![id].dash =
      kind === 'door' || kind === 'unknown'
        ? `${Math.round(randomBetween(rng, 4, 9))} ${Math.round(randomBetween(rng, 4, 8))}`
        : undefined;
  }
  for (const [index, icon] of Object.values(pack.icons ?? {}).entries()) {
    icon.color = ICON_COLORS[(index + Math.floor(rng() * ICON_COLORS.length)) % ICON_COLORS.length];
  }
  for (const [index, area] of Object.values(pack.areaStyles ?? {}).entries()) {
    area.fill = palette.area[index % palette.area.length];
    area.opacity = clamp((area.opacity ?? 0.5) + randomBetween(rng, -0.12, 0.12), 0.22, 0.9);
  }
  for (const [index, style] of Object.values(pack.connectionStyles ?? {}).entries()) {
    const range = connectionWidthRange(connectionStyleKinds.get(style.id) ?? 'unknown');
    style.stroke = palette.connection[index % palette.connection.length];
    style.width = clamp((style.width ?? range.min) + randomBetween(rng, -0.6, 0.6), range.min, range.max);
  }
  if (Object.keys(pack.labelStyles ?? {}).length === 0) {
    pack.labelStyles = {
      smart_label: { id: 'smart_label', label: 'Smart Label', ...palette.label },
    };
  } else {
    for (const style of Object.values(pack.labelStyles ?? {})) {
      style.color = palette.label.color;
      style.background = palette.label.background;
    }
  }
  for (const node of Object.values(map.nodes)) {
    node.visual = {
      ...(node.visual ?? {}),
      iconId: node.visual?.iconId ?? DEFAULT_KIND_ICON_IDS[node.kind],
    };
    if (node.areas?.length) {
      node.areas = node.areas.map((area, index) => ({
        ...area,
        visual: {
          ...(area.visual ?? {}),
          fill: area.visual?.areaStyleId
            ? area.visual.fill
            : (area.visual?.fill ?? palette.area[index % palette.area.length]),
          opacity: clamp(area.visual?.opacity ?? randomBetween(rng, 0.3, 0.58), 0.22, 0.9),
        },
      }));
    }
  }
  map.connections = map.connections.map((connection) => ({
    ...connection,
    visual: {
      ...(connection.visual ?? {}),
      styleId: connection.visual?.styleId ?? DEFAULT_CONNECTION_STYLE_IDS[connection.kind],
    },
  }));
}

export function smartShuffleWorldMap(
  map: WorldMapDocument,
  mode: WorldMapShuffleMode,
  seed = `${Date.now()}`,
): WorldMapDocument {
  const nextMap = cloneMap(map);
  const rng = createRng(`${mode}:${seed}`);
  if (mode === 'all' || mode === 'positions') smartShufflePositions(nextMap, rng);
  if (mode === 'all' || mode === 'paths') smartShufflePaths(nextMap, rng);
  if (mode === 'all' || mode === 'areas') smartShuffleAreas(nextMap, rng);
  if (mode === 'all' || mode === 'style') smartShuffleStyle(nextMap, rng);
  nextMap.updatedAt = new Date().toISOString();
  return nextMap;
}
