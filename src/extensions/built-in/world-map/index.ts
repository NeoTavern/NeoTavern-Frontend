import type { Component } from 'vue';
import type { ChatMessage } from '../../../types';
import type { ApiChatMessage, GenerationResponse, StructuredResponseOptions } from '../../../types/generation';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import { manifest } from './manifest';
import { getMapFromMetadata, mergeWorldMapDelta, serializeWorldMapForPrompt } from './map-utils';
import MapMessageButton from './MapMessageButton.vue';
import SettingsPanel from './SettingsPanel.vue';
import { smartShuffleWorldMap, type WorldMapShuffleMode } from './smart-shuffle';
import {
  DEFAULT_SETTINGS,
  WORLD_MAP_UPDATED_EVENT,
  type WorldMapBounds,
  type WorldMapConnection,
  type WorldMapDelta,
  type WorldMapDocument,
  type WorldMapExtensionAPI,
  type WorldMapMessageExtra,
  type WorldMapMessageExtraData,
  type WorldMapNode,
  type WorldMapRollbackSnapshot,
  type WorldMapSettings,
} from './types';
import WorldMapPanel from './WorldMapPanel.vue';

export { manifest };

interface MountedComponent {
  unmount: () => void;
  component: Component;
}

const EXTENSION_ID = 'core.world-map';
const MAP_NAV_ID = 'core.world-map-nav';
const QUICK_ACTION_GROUP_ID = 'core.context-ai';
const MAX_QUALITY_REPAIRS = 20;

interface WorldMapGenerationResult {
  delta?: WorldMapDelta;
  rawContent: string;
  parseError?: string;
  messages?: ApiChatMessage[];
}

export interface QualityIssue {
  code: string;
  message: string;
}

function boundsOverlapRatio(a: WorldMapBounds, b: WorldMapBounds): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const intersection = width * height;
  if (intersection <= 0) return 0;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 ? intersection / smallerArea : 0;
}

function sameBounds(a: WorldMapBounds, b: WorldMapBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function getSiblingOverlapThreshold(first: WorldMapNode, second: WorldMapNode): number {
  if (first.kind === 'floor' || second.kind === 'floor') return 0.6;
  if (first.kind === 'room' || second.kind === 'room') return 0.65;
  return 0.75;
}

function areaCoversView(node: WorldMapNode, area: NonNullable<WorldMapNode['areas']>[number]): boolean {
  if (!node.view || area.points.length < 4) return false;
  const xs = area.points.map((point) => point.x);
  const ys = area.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return minX <= 1 && minY <= 1 && maxX >= node.view.width - 1 && maxY >= node.view.height - 1;
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!match) return null;
  const hex = match[1];
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbFunctionToRgb(color: string): { r: number; g: number; b: number } | null {
  const match = color.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const [r, g, b] = match[1]
    .split(',')
    .slice(0, 3)
    .map((part) => Number(part.trim()));
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r, g, b };
}

function isWaterLikeColor(color: string | undefined): boolean {
  if (!color) return false;
  const normalized = color.trim().toLowerCase();
  if (/\b(blue|navy|aqua|cyan|teal|turquoise|water|ocean|sea)\b/.test(normalized)) return true;
  const rgb = hexToRgb(normalized) ?? rgbFunctionToRgb(normalized);
  if (!rgb) return false;
  return rgb.b >= rgb.r + 25 && rgb.b >= rgb.g - 15;
}

function areaBounds(area: NonNullable<WorldMapNode['areas']>[number]): WorldMapBounds | null {
  if (area.points.length === 0) return null;
  const xs = area.points.map((point) => point.x);
  const ys = area.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

function childExtentRatio(parent: WorldMapNode, children: WorldMapNode[]): number | null {
  if (!parent.view) return null;
  const boundedChildren = children.filter((child) => child.bounds);
  if (boundedChildren.length < 3) return null;
  if (boundedChildren.every((child) => child.kind === 'floor' || child.kind === 'room')) return null;
  const minX = Math.min(...boundedChildren.map((child) => child.bounds!.x));
  const minY = Math.min(...boundedChildren.map((child) => child.bounds!.y));
  const maxX = Math.max(...boundedChildren.map((child) => child.bounds!.x + child.bounds!.width));
  const maxY = Math.max(...boundedChildren.map((child) => child.bounds!.y + child.bounds!.height));
  return Math.max((maxX - minX) / parent.view.width, (maxY - minY) / parent.view.height);
}

function hasSiblingConnection(children: WorldMapNode[], connections: WorldMapConnection[]): boolean {
  const childIds = new Set(children.map((child) => child.id));
  return connections.some((connection) => childIds.has(connection.fromNodeId) && childIds.has(connection.toNodeId));
}

function buildProjectedNodes(currentMap: WorldMapDocument | null, delta: WorldMapDelta): Record<string, WorldMapNode> {
  const nodes: Record<string, WorldMapNode> = { ...(currentMap?.nodes ?? {}) };
  const removedIconIds = new Set((delta.visualPackDelta?.removeIconIds ?? []).filter(Boolean));
  const removedAreaStyleIds = new Set((delta.visualPackDelta?.removeAreaStyleIds ?? []).filter(Boolean));
  const removedLabelStyleIds = new Set((delta.visualPackDelta?.removeLabelStyleIds ?? []).filter(Boolean));

  for (const node of delta.createOrUpdateNodes ?? []) {
    if (node.id) nodes[node.id] = { ...nodes[node.id], ...node };
  }
  for (const [nodeId, node] of Object.entries(nodes)) {
    let nextNode = node;
    if (node.visual) {
      const nextVisual = { ...node.visual };
      if (nextVisual.iconId && removedIconIds.has(nextVisual.iconId)) delete nextVisual.iconId;
      if (nextVisual.areaStyleId && removedAreaStyleIds.has(nextVisual.areaStyleId)) delete nextVisual.areaStyleId;
      if (nextVisual.footprintStyleId && removedAreaStyleIds.has(nextVisual.footprintStyleId)) {
        delete nextVisual.footprintStyleId;
      }
      if (nextVisual.labelStyleId && removedLabelStyleIds.has(nextVisual.labelStyleId)) delete nextVisual.labelStyleId;
      nextNode = { ...nextNode, visual: Object.keys(nextVisual).length > 0 ? nextVisual : undefined };
    }
    if (node.areas) {
      nextNode = {
        ...nextNode,
        areas: node.areas.map((area) => {
          if (!area.visual?.areaStyleId || !removedAreaStyleIds.has(area.visual.areaStyleId)) return area;
          const visual = { ...area.visual };
          delete visual.areaStyleId;
          return { ...area, visual: Object.keys(visual).length > 0 ? visual : undefined };
        }),
      };
    }
    nodes[nodeId] = nextNode;
  }
  for (const assignment of delta.visualPackDelta?.assignNodeVisuals ?? []) {
    if (nodes[assignment.nodeId]) {
      nodes[assignment.nodeId] = {
        ...nodes[assignment.nodeId],
        visual: { ...assignment.visual },
      };
    }
  }
  for (const nodeId of delta.removeNodeIds ?? []) delete nodes[nodeId];
  return nodes;
}

function getVisualPacksAfterDelta(
  currentMap: WorldMapDocument | null,
  delta: WorldMapDelta,
): WorldMapDocument['visualPacks'] {
  const visualPacks: WorldMapDocument['visualPacks'] = { ...(currentMap?.visualPacks ?? {}) };
  const visualDelta = delta.visualPackDelta;
  if (!visualDelta?.packId) return visualPacks;

  const pack = visualPacks[visualDelta.packId] ?? {
    id: visualDelta.packId,
    name: visualDelta.packName,
    icons: {},
    areaStyles: {},
    connectionStyles: {},
    labelStyles: {},
  };
  const icons = { ...(pack.icons ?? {}) };
  const areaStyles = { ...(pack.areaStyles ?? {}) };
  const connectionStyles = { ...(pack.connectionStyles ?? {}) };
  const labelStyles = { ...(pack.labelStyles ?? {}) };

  for (const id of visualDelta.removeIconIds ?? []) delete icons[id];
  for (const id of visualDelta.removeAreaStyleIds ?? []) delete areaStyles[id];
  for (const id of visualDelta.removeConnectionStyleIds ?? []) delete connectionStyles[id];
  for (const id of visualDelta.removeLabelStyleIds ?? []) delete labelStyles[id];

  visualPacks[visualDelta.packId] = {
    ...pack,
    icons: { ...icons, ...Object.fromEntries((visualDelta.icons ?? []).map((icon) => [icon.id, icon])) },
    areaStyles: {
      ...areaStyles,
      ...Object.fromEntries((visualDelta.areaStyles ?? []).map((style) => [style.id, style])),
    },
    connectionStyles: {
      ...connectionStyles,
      ...Object.fromEntries((visualDelta.connectionStyles ?? []).map((style) => [style.id, style])),
    },
    labelStyles: {
      ...labelStyles,
      ...Object.fromEntries((visualDelta.labelStyles ?? []).map((style) => [style.id, style])),
    },
  };
  return visualPacks;
}

function getActiveVisualPackAfterDelta(currentMap: WorldMapDocument | null, delta: WorldMapDelta) {
  const visualPacks = getVisualPacksAfterDelta(currentMap, delta);
  const activeVisualPackId = delta.visualPackDelta?.packId ?? currentMap?.activeVisualPackId;
  return activeVisualPackId ? visualPacks?.[activeVisualPackId] : undefined;
}

function isMajorVisualNode(node: WorldMapNode): boolean {
  return Boolean(
    node.bounds && ['region', 'settlement', 'district', 'building', 'room', 'landmark', 'poi'].includes(node.kind),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function svgSymbolHasMatchingId(svgSymbol: string, iconId: string): boolean {
  const symbolTag = svgSymbol.match(/<symbol\b[^>]*>/i)?.[0];
  if (!symbolTag) return false;
  return new RegExp(`\\sid\\s*=\\s*["']${escapeRegExp(iconId)}["']`, 'i').test(symbolTag);
}

function getContainingFloor(
  node: WorldMapNode | undefined,
  nodes: Record<string, WorldMapNode>,
): WorldMapNode | undefined {
  if (!node) return undefined;
  if (node.kind === 'floor') return node;
  const parent = node.parentId ? nodes[node.parentId] : undefined;
  return parent?.kind === 'floor' ? parent : undefined;
}

function hasInitialMapAnchor(delta: WorldMapDelta): boolean {
  const nodes = delta.createOrUpdateNodes ?? [];
  if (delta.rootNodeId && nodes.some((node) => node.id === delta.rootNodeId)) return true;
  return nodes.some((node) => !node.parentId && node.view);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function collectNodeIdsWithDescendants(
  nodes: Record<string, WorldMapNode> | undefined,
  nodeIds: Set<string>,
): Set<string> {
  const ids = new Set(nodeIds);
  if (!nodes) return ids;

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of Object.values(nodes)) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return ids;
}

function snapshotVisualPackAsset<T>(
  target: Record<string, T | null>,
  id: string,
  assets: Record<string, T> | undefined,
): void {
  if (Object.prototype.hasOwnProperty.call(target, id)) return;
  target[id] = assets?.[id] ? cloneValue(assets[id]) : null;
}

function ensureVisualPackRollback(
  snapshot: WorldMapRollbackSnapshot,
  map: WorldMapDocument | null,
  packId: string,
): NonNullable<WorldMapRollbackSnapshot['visualPacks']>[string] {
  snapshot.visualPacks ??= {};
  const existing = snapshot.visualPacks[packId];
  if (existing) return existing;
  const pack = map?.visualPacks?.[packId];
  const rollback = {
    existed: Boolean(pack),
    name: pack?.name,
    icons: {},
    areaStyles: {},
    connectionStyles: {},
    labelStyles: {},
  };
  snapshot.visualPacks[packId] = rollback;
  return rollback;
}

export function createRollbackSnapshot(
  map: WorldMapDocument | null,
  deltas: WorldMapDelta[],
): WorldMapRollbackSnapshot {
  const snapshot: WorldMapRollbackSnapshot = {};

  const snapshotNode = (nodeId: string) => {
    snapshot.nodes ??= {};
    if (Object.prototype.hasOwnProperty.call(snapshot.nodes, nodeId)) return;
    snapshot.nodes[nodeId] = map?.nodes[nodeId] ? cloneValue(map.nodes[nodeId]) : null;
  };

  const snapshotConnection = (connectionId: string) => {
    snapshot.connections ??= {};
    if (Object.prototype.hasOwnProperty.call(snapshot.connections, connectionId)) return;
    const connection = map?.connections.find((item) => item.id === connectionId);
    snapshot.connections[connectionId] = connection ? cloneValue(connection) : null;
  };

  for (const delta of deltas) {
    if (delta.rootNodeId !== undefined && snapshot.rootNodeId === undefined) {
      snapshot.rootNodeId = map?.rootNodeId ?? null;
    }

    for (const node of delta.createOrUpdateNodes ?? []) snapshotNode(node.id);
    const removedNodeIds = collectNodeIdsWithDescendants(map?.nodes, new Set(delta.removeNodeIds ?? []));
    for (const nodeId of removedNodeIds) snapshotNode(nodeId);
    for (const connection of map?.connections ?? []) {
      if (removedNodeIds.has(connection.fromNodeId) || removedNodeIds.has(connection.toNodeId)) {
        snapshotConnection(connection.id);
      }
    }
    for (const assignment of delta.visualPackDelta?.assignNodeVisuals ?? []) snapshotNode(assignment.nodeId);

    for (const connection of delta.createOrUpdateConnections ?? []) snapshotConnection(connection.id);
    for (const connectionId of delta.removeConnectionIds ?? []) snapshotConnection(connectionId);
    for (const assignment of delta.visualPackDelta?.assignConnectionVisuals ?? []) {
      snapshotConnection(assignment.connectionId);
    }

    const visualDelta = delta.visualPackDelta;
    if (!visualDelta?.packId) continue;
    if (snapshot.activeVisualPackId === undefined) snapshot.activeVisualPackId = map?.activeVisualPackId ?? null;

    const packRollback = ensureVisualPackRollback(snapshot, map, visualDelta.packId);
    const pack = map?.visualPacks?.[visualDelta.packId];
    for (const icon of visualDelta.icons ?? []) snapshotVisualPackAsset(packRollback.icons!, icon.id, pack?.icons);
    for (const iconId of visualDelta.removeIconIds ?? [])
      snapshotVisualPackAsset(packRollback.icons!, iconId, pack?.icons);
    for (const style of visualDelta.areaStyles ?? []) {
      snapshotVisualPackAsset(packRollback.areaStyles!, style.id, pack?.areaStyles);
    }
    for (const styleId of visualDelta.removeAreaStyleIds ?? []) {
      snapshotVisualPackAsset(packRollback.areaStyles!, styleId, pack?.areaStyles);
    }
    for (const style of visualDelta.connectionStyles ?? []) {
      snapshotVisualPackAsset(packRollback.connectionStyles!, style.id, pack?.connectionStyles);
    }
    for (const styleId of visualDelta.removeConnectionStyleIds ?? []) {
      snapshotVisualPackAsset(packRollback.connectionStyles!, styleId, pack?.connectionStyles);
    }
    for (const style of visualDelta.labelStyles ?? []) {
      snapshotVisualPackAsset(packRollback.labelStyles!, style.id, pack?.labelStyles);
    }
    for (const styleId of visualDelta.removeLabelStyleIds ?? []) {
      snapshotVisualPackAsset(packRollback.labelStyles!, styleId, pack?.labelStyles);
    }
  }

  return snapshot;
}

function restoreRecord<T>(target: Record<string, T>, snapshots: Record<string, T | null> | undefined): void {
  for (const [id, value] of Object.entries(snapshots ?? {})) {
    if (value === null) delete target[id];
    else target[id] = cloneValue(value);
  }
}

export function applyRollbackSnapshot(
  currentMap: WorldMapDocument | null,
  rollback: WorldMapRollbackSnapshot,
): WorldMapDocument | null {
  if (!currentMap) return null;
  const map = cloneValue(currentMap);

  if (rollback.rootNodeId !== undefined) {
    if (rollback.rootNodeId === null) delete map.rootNodeId;
    else map.rootNodeId = rollback.rootNodeId;
  }

  if (rollback.activeVisualPackId !== undefined) {
    if (rollback.activeVisualPackId === null) delete map.activeVisualPackId;
    else map.activeVisualPackId = rollback.activeVisualPackId;
  }

  for (const [packId, packRollback] of Object.entries(rollback.visualPacks ?? {})) {
    map.visualPacks ??= {};
    if (!packRollback.existed) {
      delete map.visualPacks[packId];
      continue;
    }
    const pack = (map.visualPacks[packId] ??= {
      id: packId,
      name: packRollback.name ?? packId,
      icons: {},
      areaStyles: {},
      connectionStyles: {},
      labelStyles: {},
    });
    if (packRollback.name) pack.name = packRollback.name;
    pack.icons ??= {};
    pack.areaStyles ??= {};
    pack.connectionStyles ??= {};
    pack.labelStyles ??= {};
    restoreRecord(pack.icons, packRollback.icons);
    restoreRecord(pack.areaStyles, packRollback.areaStyles);
    restoreRecord(pack.connectionStyles, packRollback.connectionStyles);
    restoreRecord(pack.labelStyles, packRollback.labelStyles);
  }

  restoreRecord(map.nodes, rollback.nodes);

  for (const [connectionId, connection] of Object.entries(rollback.connections ?? {})) {
    const index = map.connections.findIndex((item) => item.id === connectionId);
    if (connection === null) {
      if (index !== -1) map.connections.splice(index, 1);
    } else if (index === -1) {
      map.connections.push(cloneValue(connection));
    } else {
      map.connections[index] = cloneValue(connection);
    }
  }

  map.connections = map.connections.filter(
    (connection) => map.nodes[connection.fromNodeId] && map.nodes[connection.toNodeId],
  );
  map.updatedAt = new Date().toISOString();

  return Object.keys(map.nodes).length > 0 ? map : null;
}

export function validateWorldMapDeltaQuality(
  currentMap: WorldMapDocument | null,
  delta: WorldMapDelta,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const nodes = buildProjectedNodes(currentMap, delta);
  const removeConnectionIds = new Set(delta.removeConnectionIds ?? []);
  const connections = [...(currentMap?.connections ?? [])].filter(
    (connection) => !removeConnectionIds.has(connection.id),
  );
  for (const connection of delta.createOrUpdateConnections ?? []) {
    const index = connections.findIndex((item) => item.id === connection.id);
    if (index === -1) connections.push(connection);
    else connections[index] = { ...connections[index], ...connection };
  }
  for (const assignment of delta.visualPackDelta?.assignConnectionVisuals ?? []) {
    const connection = connections.find((item) => item.id === assignment.connectionId);
    if (connection) connection.visual = { ...assignment.visual };
  }
  const childrenByParent = new Map<string, WorldMapNode[]>();

  for (const node of Object.values(nodes)) {
    if (node.parentId) {
      const children = childrenByParent.get(node.parentId) ?? [];
      children.push(node);
      childrenByParent.set(node.parentId, children);
    }
  }

  for (const node of Object.values(nodes)) {
    const isIslandNode = node.subkind?.toLowerCase() === 'island' || /\bisland\b/i.test(node.name);
    if (isIslandNode && node.areas?.some((area) => area.kind === 'water') && !isWaterLikeColor(node.view?.background)) {
      issues.push({
        code: 'island_water_background',
        message: `Island node "${node.id}" has water area(s), but its view.background is not water-like. Use the broad ocean/sea color as the view background and draw the island landmass as terrain inside it.`,
      });
    }

    if (node.areas?.some((area) => areaCoversView(node, area))) {
      const areaIds = node.areas.filter((area) => areaCoversView(node, area)).map((area) => area.id);
      issues.push({
        code: 'full_view_area',
        message: `Node "${node.id}" has area(s) covering the entire view: ${areaIds.join(', ')}. Remove full-view areas and use view.background for broad background material.`,
      });
    }

    for (const area of node.areas ?? []) {
      const areaLabel = `${area.id} ${area.label ?? ''}`.toLowerCase();
      if (area.kind === 'water' && /\b(beach|sand|cove)\b/.test(areaLabel)) {
        issues.push({
          code: 'beach_area_kind',
          message: `Area "${area.id}" on node "${node.id}" is labeled like a beach/sandy cove but uses kind "water". Use kind "terrain" or "other" for beach/sand land areas; reserve "water" for actual water.`,
        });
      }

      const bounds = areaBounds(area);
      if (isIslandNode && node.view && area.kind === 'water' && bounds) {
        const coversMostWidth = bounds.width / node.view.width > 0.85;
        const coversMostHeight = bounds.height / node.view.height > 0.85;
        if (coversMostWidth || coversMostHeight) {
          issues.push({
            code: 'island_water_area_too_large',
            message: `Island node "${node.id}" has water area "${area.id}" spanning most of the view. For island maps, use view.background for ocean/water and keep areas for landmass, beaches, cliffs, woods, fields, or other stable features.`,
          });
        }
      }
    }

    const childCount = childrenByParent.get(node.id)?.length ?? 0;
    if (childCount > 0 && !node.view) {
      issues.push({
        code: 'missing_child_view',
        message: `Node "${node.id}" has ${childCount} child node(s) but no view. Add a generous view for this enterable sub-map.`,
      });
    }
  }

  for (const [parentId, children] of childrenByParent) {
    const parent = nodes[parentId];
    const extentRatio = parent ? childExtentRatio(parent, children) : null;
    if (extentRatio !== null && extentRatio < 0.28) {
      issues.push({
        code: 'underscaled_child_layout',
        message: `Children under "${parentId}" occupy only ${(extentRatio * 100).toFixed(0)}% of the parent view's usable scale. Place child bounds in the parent view coordinate space instead of clustering them into a tiny placeholder layout.`,
      });
    }

    const boundedNavigableChildren = children.filter(
      (node) => node.bounds && ['settlement', 'district', 'building', 'room', 'landmark', 'poi'].includes(node.kind),
    );
    if (boundedNavigableChildren.length >= 3 && !hasSiblingConnection(boundedNavigableChildren, connections)) {
      issues.push({
        code: 'disconnected_sibling_map',
        message: `Parent "${parentId}" has ${boundedNavigableChildren.length} renderable sibling locations but no traversal connections between them. Add physical road, path, corridor, door, adjacent, stairs, elevator, or portal connections where travel routes are known.`,
      });
    }

    const boundedChildren = children.filter((node) => node.bounds);
    for (let i = 0; i < boundedChildren.length; i += 1) {
      for (let j = i + 1; j < boundedChildren.length; j += 1) {
        const first = boundedChildren[i];
        const second = boundedChildren[j];
        if (!first.bounds || !second.bounds) continue;
        const overlapRatio = boundsOverlapRatio(first.bounds, second.bounds);
        const threshold = getSiblingOverlapThreshold(first, second);
        if (sameBounds(first.bounds, second.bounds) || overlapRatio > threshold) {
          issues.push({
            code: 'overlapping_sibling_bounds',
            message: `Sibling nodes "${first.id}" (${first.kind}) and "${second.id}" (${second.kind}) under "${parentId}" overlap too much. Give siblings distinct bounds in the parent view; floor siblings can use stacked strips, rooms can use a floor-plan layout, and buildings/landmarks should occupy separate map positions.`,
          });
        }
      }
    }
  }

  for (const connection of connections) {
    const from = nodes[connection.fromNodeId];
    const to = nodes[connection.toNodeId];
    if (from && to && (from.parentId === to.id || to.parentId === from.id)) {
      issues.push({
        code: 'parent_child_connection',
        message: `Connection "${connection.id}" connects direct parent/child nodes "${connection.fromNodeId}" and "${connection.toNodeId}". Remove this connection because parentId already represents containment.`,
      });
    }
  }

  const visualDelta = delta.visualPackDelta;
  const existingVisualPacks = Object.values(currentMap?.visualPacks ?? {});
  const iconIds = new Set([
    ...existingVisualPacks.flatMap((pack) => Object.keys(pack.icons ?? {})),
    ...(visualDelta?.icons?.map((icon) => icon.id) ?? []),
  ]);
  const areaStyleIds = new Set([
    ...existingVisualPacks.flatMap((pack) => Object.keys(pack.areaStyles ?? {})),
    ...(visualDelta?.areaStyles?.map((style) => style.id) ?? []),
  ]);
  const connectionStyleIds = new Set([
    ...existingVisualPacks.flatMap((pack) => Object.keys(pack.connectionStyles ?? {})),
    ...(visualDelta?.connectionStyles?.map((style) => style.id) ?? []),
  ]);
  const labelStyleIds = new Set([
    ...existingVisualPacks.flatMap((pack) => Object.keys(pack.labelStyles ?? {})),
    ...(visualDelta?.labelStyles?.map((style) => style.id) ?? []),
  ]);
  const activeVisualPack = getActiveVisualPackAfterDelta(currentMap, delta);
  const activeIcons = Object.values(activeVisualPack?.icons ?? {});
  const activeAreaStyles = Object.values(activeVisualPack?.areaStyles ?? {});
  const activeConnectionStyles = Object.values(activeVisualPack?.connectionStyles ?? {});
  const activeLabelStyles = Object.values(activeVisualPack?.labelStyles ?? {});
  const majorVisualNodes = Object.values(nodes).filter(isMajorVisualNode);

  for (const icon of activeIcons) {
    if (icon.svgSymbol && !svgSymbolHasMatchingId(icon.svgSymbol, icon.id)) {
      issues.push({
        code: 'invalid_svg_symbol_id',
        message: `Icon "${icon.id}" has svgSymbol but the <symbol> tag does not include id="${icon.id}". The renderer references icons by this id, so the symbol must match exactly.`,
      });
    }
  }

  if (majorVisualNodes.length >= 8) {
    const distinctMajorKinds = new Set(majorVisualNodes.map((node) => node.kind));
    const minimumIconCount = Math.min(6, Math.max(3, distinctMajorKinds.size));
    const minimumSvgIconCount = Math.min(3, minimumIconCount);
    const assignedIconCount = majorVisualNodes.filter((node) => node.visual?.iconId).length;

    if (activeIcons.length < minimumIconCount) {
      issues.push({
        code: 'insufficient_custom_icons',
        message: `The active visual pack defines ${activeIcons.length} icon(s), but this map has ${majorVisualNodes.length} major renderable locations. Define at least ${minimumIconCount} chat-specific icons with labels and fallbackKind values, and assign them to important visible nodes.`,
      });
    }

    if (activeIcons.filter((icon) => icon.svgSymbol).length < minimumSvgIconCount) {
      issues.push({
        code: 'insufficient_svg_icons',
        message: `The active visual pack should include at least ${minimumSvgIconCount} svgSymbol icon(s) for important chat-specific places. Use safe <symbol> SVG snippets with simple paths/shapes.`,
      });
    }

    if (assignedIconCount / majorVisualNodes.length < 0.45) {
      issues.push({
        code: 'insufficient_icon_assignments',
        message: `Only ${assignedIconCount} of ${majorVisualNodes.length} major renderable locations have visual.iconId. Assign custom icons to important regions, settlements, buildings, landmarks, points of interest, and notable rooms.`,
      });
    }

    for (const icon of activeIcons) {
      const assignedCount = Object.values(nodes).filter((node) => node.visual?.iconId === icon.id).length;
      if (assignedCount === 0) {
        issues.push({
          code: 'unused_icon_definition',
          message: `Icon "${icon.id}" is defined but not assigned to any node. Assign it to matching nodes or remove it with visualPackDelta.removeIconIds.`,
        });
      }
    }

    for (const style of activeAreaStyles) {
      const assignedCount = Object.values(nodes).filter(
        (node) =>
          node.visual?.areaStyleId === style.id ||
          node.visual?.footprintStyleId === style.id ||
          node.areas?.some((area) => area.visual?.areaStyleId === style.id),
      ).length;
      if (assignedCount === 0) {
        issues.push({
          code: 'unused_area_style_definition',
          message: `Area style "${style.id}" is defined but not assigned to any node or area. Assign it where it affects rendering or remove it with visualPackDelta.removeAreaStyleIds.`,
        });
      }
    }

    for (const style of activeConnectionStyles) {
      const assignedCount = connections.filter((connection) => connection.visual?.styleId === style.id).length;
      if (assignedCount === 0) {
        issues.push({
          code: 'unused_connection_style_definition',
          message: `Connection style "${style.id}" is defined but not assigned to any connection. Assign it to matching connections or remove it with visualPackDelta.removeConnectionStyleIds.`,
        });
      }
    }

    for (const style of activeLabelStyles) {
      const assignedCount = Object.values(nodes).filter((node) => node.visual?.labelStyleId === style.id).length;
      if (assignedCount === 0) {
        issues.push({
          code: 'unused_label_style_definition',
          message: `Label style "${style.id}" is defined but not assigned to any node. Assign it where it affects labels or remove it with visualPackDelta.removeLabelStyleIds.`,
        });
      }
    }

    for (const kind of ['building', 'floor', 'room', 'landmark', 'poi'] as const) {
      const kindNodes = Object.values(nodes).filter((node) => node.kind === kind && node.bounds);
      if (kindNodes.length < 2) continue;
      const hasKindIcon = activeIcons.some((icon) => icon.fallbackKind === kind);
      if (!hasKindIcon) continue;
      const assignedKindNodes = kindNodes.filter((node) => node.visual?.iconId).length;
      if (assignedKindNodes / kindNodes.length < 0.5) {
        issues.push({
          code: 'insufficient_kind_icon_assignments',
          message: `The active visual pack defines ${kind} icon(s), but only ${assignedKindNodes} of ${kindNodes.length} ${kind} nodes use visual.iconId. Assign the matching icon to important ${kind} nodes.`,
        });
      }
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.visual?.iconId && !iconIds.has(node.visual.iconId)) {
      issues.push({
        code: 'missing_icon_definition',
        message: `Node "${node.id}" references icon "${node.visual.iconId}" but no active visual pack defines that icon. Define the icon, assign an existing iconId, or remove the invalid visual.iconId.`,
      });
    }
    if (node.visual?.areaStyleId && !areaStyleIds.has(node.visual.areaStyleId)) {
      issues.push({
        code: 'missing_area_style_definition',
        message: `Node "${node.id}" references area style "${node.visual.areaStyleId}" but no active visual pack defines that area style. Define the style, assign an existing areaStyleId, or remove the invalid visual.areaStyleId.`,
      });
    }
    if (node.visual?.footprintStyleId && !areaStyleIds.has(node.visual.footprintStyleId)) {
      issues.push({
        code: 'missing_area_style_definition',
        message: `Node "${node.id}" references footprint style "${node.visual.footprintStyleId}" but no active visual pack defines that area style. Define the style, assign an existing footprintStyleId, or remove the invalid visual.footprintStyleId.`,
      });
    }
    if (node.visual?.labelStyleId && !labelStyleIds.has(node.visual.labelStyleId)) {
      issues.push({
        code: 'missing_label_style_definition',
        message: `Node "${node.id}" references label style "${node.visual.labelStyleId}" but no active visual pack defines that label style. Define the style, assign an existing labelStyleId, or remove the invalid visual.labelStyleId.`,
      });
    }

    for (const area of node.areas ?? []) {
      if (area.visual?.areaStyleId && !areaStyleIds.has(area.visual.areaStyleId)) {
        issues.push({
          code: 'missing_area_style_definition',
          message: `Area "${area.id}" on node "${node.id}" references area style "${area.visual.areaStyleId}" but no active visual pack defines that area style. Define the style, assign an existing areaStyleId, or remove the invalid area visual reference.`,
        });
      }
    }
  }

  for (const connection of connections) {
    if (connection.visual?.styleId && !connectionStyleIds.has(connection.visual.styleId)) {
      issues.push({
        code: 'missing_connection_style_definition',
        message: `Connection "${connection.id}" references style "${connection.visual.styleId}" but no active visual pack defines that connection style. Define the style, assign an existing styleId, or remove the invalid connection visual reference.`,
      });
    }
  }

  if (visualDelta) {
    for (const assignment of visualDelta.assignNodeVisuals ?? []) {
      if (assignment.visual.iconId && !iconIds.has(assignment.visual.iconId)) {
        issues.push({
          code: 'missing_icon_definition',
          message: `Node visual assignment for "${assignment.nodeId}" references icon "${assignment.visual.iconId}" but this delta does not define that icon.`,
        });
      }
      if (assignment.visual.labelStyleId && !labelStyleIds.has(assignment.visual.labelStyleId)) {
        issues.push({
          code: 'missing_label_style_definition',
          message: `Node visual assignment for "${assignment.nodeId}" references label style "${assignment.visual.labelStyleId}" but this delta does not define that label style.`,
        });
      }
    }

    for (const assignment of visualDelta.assignConnectionVisuals ?? []) {
      if (assignment.visual.styleId && !connectionStyleIds.has(assignment.visual.styleId)) {
        issues.push({
          code: 'missing_connection_style_definition',
          message: `Connection visual assignment for "${assignment.connectionId}" references style "${assignment.visual.styleId}" but this delta does not define that connection style.`,
        });
      }
    }
  }

  for (const connection of connections) {
    if (connection.kind !== 'stairs' && connection.kind !== 'elevator') continue;
    const from = nodes[connection.fromNodeId];
    const to = nodes[connection.toNodeId];
    const fromFloor = getContainingFloor(from, nodes);
    const toFloor = getContainingFloor(to, nodes);
    if (fromFloor && toFloor && fromFloor.id !== toFloor.id && (from?.kind !== 'floor' || to?.kind !== 'floor')) {
      issues.push({
        code: 'cross_floor_room_connection',
        message: `Connection "${connection.id}" links "${connection.fromNodeId}" to "${connection.toNodeId}" across floors. Stairs/elevators between floors should connect floor nodes, not specific rooms on different floors.`,
      });
    }
  }

  return issues;
}

function getWorldMapStructuredResponse(format: WorldMapSettings['structuredRequestFormat']): StructuredResponseOptions {
  return {
    format,
    schema: {
      name: 'world_map_delta',
      strict: true,
      value: {
        type: 'object',
        properties: {
          rootNodeId: { type: 'string' },
          createOrUpdateNodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                kind: {
                  type: 'string',
                  enum: ['world', 'region', 'settlement', 'district', 'building', 'floor', 'room', 'landmark', 'poi'],
                },
                subkind: { type: 'string' },
                parentId: { type: 'string' },
                floorIndex: { type: 'number' },
                bounds: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                    width: { type: 'number', minimum: 8 },
                    height: { type: 'number', minimum: 8 },
                  },
                  required: ['x', 'y', 'width', 'height'],
                },
                view: {
                  type: 'object',
                  properties: {
                    width: { type: 'number', minimum: 600 },
                    height: { type: 'number', minimum: 400 },
                    background: { type: 'string' },
                  },
                  required: ['width', 'height'],
                },
                areas: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' },
                      kind: {
                        type: 'string',
                        enum: [
                          'terrain',
                          'water',
                          'woods',
                          'garden',
                          'courtyard',
                          'field',
                          'cliff',
                          'interior',
                          'other',
                        ],
                      },
                      points: {
                        type: 'array',
                        minItems: 3,
                        maxItems: 40,
                        items: {
                          type: 'object',
                          properties: {
                            x: { type: 'number' },
                            y: { type: 'number' },
                          },
                          required: ['x', 'y'],
                        },
                      },
                      visual: {
                        type: 'object',
                        properties: {
                          areaStyleId: { type: 'string' },
                          fill: { type: 'string' },
                          stroke: { type: 'string' },
                          opacity: { type: 'number', minimum: 0.05, maximum: 1 },
                        },
                      },
                    },
                    required: ['id', 'points'],
                  },
                },
                visual: {
                  type: 'object',
                  properties: {
                    iconId: { type: 'string' },
                    areaStyleId: { type: 'string' },
                    footprintStyleId: { type: 'string' },
                    labelStyleId: { type: 'string' },
                  },
                },
              },
              required: ['id', 'name', 'kind'],
            },
          },
          removeNodeIds: { type: 'array', items: { type: 'string' } },
          createOrUpdateConnections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                fromNodeId: { type: 'string' },
                toNodeId: { type: 'string' },
                kind: {
                  type: 'string',
                  enum: ['road', 'path', 'corridor', 'door', 'stairs', 'elevator', 'portal', 'adjacent', 'unknown'],
                },
                label: { type: 'string' },
                bidirectional: { type: 'boolean' },
                points: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 12,
                  items: {
                    type: 'object',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' },
                    },
                    required: ['x', 'y'],
                  },
                },
                visual: {
                  type: 'object',
                  properties: {
                    styleId: { type: 'string' },
                  },
                },
              },
              required: ['id', 'fromNodeId', 'toNodeId', 'kind'],
            },
          },
          removeConnectionIds: { type: 'array', items: { type: 'string' } },
          visualPackDelta: {
            type: 'object',
            properties: {
              packId: { type: 'string' },
              packName: { type: 'string' },
              removeIconIds: { type: 'array', items: { type: 'string' } },
              removeAreaStyleIds: { type: 'array', items: { type: 'string' } },
              removeConnectionStyleIds: { type: 'array', items: { type: 'string' } },
              removeLabelStyleIds: { type: 'array', items: { type: 'string' } },
              icons: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    svgSymbol: { type: 'string' },
                    fallbackKind: {
                      type: 'string',
                      enum: [
                        'world',
                        'region',
                        'settlement',
                        'district',
                        'building',
                        'floor',
                        'room',
                        'landmark',
                        'poi',
                      ],
                    },
                    color: { type: 'string' },
                  },
                  required: ['id', 'label'],
                },
              },
              areaStyles: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    fill: { type: 'string' },
                    stroke: { type: 'string' },
                    pattern: {
                      type: 'string',
                      enum: ['solid', 'grid', 'dots', 'diagonal', 'water', 'grass', 'stone'],
                    },
                    opacity: { type: 'number', minimum: 0.05, maximum: 1 },
                  },
                  required: ['id', 'label'],
                },
              },
              connectionStyles: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    stroke: { type: 'string' },
                    width: { type: 'number', minimum: 1, maximum: 18 },
                    dash: { type: 'string', pattern: '^[0-9 .]{1,40}$' },
                    linecap: {
                      type: 'string',
                      enum: ['butt', 'round', 'square'],
                    },
                  },
                  required: ['id', 'label'],
                },
              },
              labelStyles: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    color: { type: 'string' },
                    background: { type: 'string' },
                  },
                  required: ['id', 'label'],
                },
              },
              assignNodeVisuals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    nodeId: { type: 'string' },
                    visual: {
                      type: 'object',
                      properties: {
                        iconId: { type: 'string' },
                        areaStyleId: { type: 'string' },
                        footprintStyleId: { type: 'string' },
                        labelStyleId: { type: 'string' },
                      },
                    },
                  },
                  required: ['nodeId', 'visual'],
                },
              },
              assignConnectionVisuals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    connectionId: { type: 'string' },
                    visual: {
                      type: 'object',
                      properties: {
                        styleId: { type: 'string' },
                      },
                    },
                  },
                  required: ['connectionId', 'visual'],
                },
              },
            },
            required: ['packId', 'packName'],
          },
        },
      },
    },
  };
}

class WorldMapManager {
  private mountedButtons = new Map<number, MountedComponent>();
  private pendingRequests = new Set<number>();
  private injectedContextGenerationIds = new Set<string>();
  private unregisterChatUiFns: Array<() => void> = [];

  constructor(private api: WorldMapExtensionAPI) {}

  private getSettings(): WorldMapSettings {
    const saved = this.api.settings.get();
    return { ...DEFAULT_SETTINGS, ...saved };
  }

  private getMap(): WorldMapDocument | null {
    return getMapFromMetadata(this.api.chat.metadata.get());
  }

  private async setMap(map: WorldMapDocument): Promise<void> {
    const metadata = this.api.chat.metadata.get();
    if (!metadata) return;
    const extra = { ...(metadata.extra ?? {}) };
    const extensionExtra = { ...((extra[EXTENSION_ID] as Record<string, unknown> | undefined) ?? {}) };
    extra[EXTENSION_ID] = { ...extensionExtra, map };
    this.api.chat.metadata.set({ ...metadata, extra });
    await this.api.events.emit(WORLD_MAP_UPDATED_EVENT);
  }

  private async removeChatMapMetadata(): Promise<void> {
    const metadata = this.api.chat.metadata.get();
    if (!metadata?.extra?.[EXTENSION_ID]) return;

    const extra = { ...metadata.extra };
    const extensionExtra = { ...(extra[EXTENSION_ID] as Record<string, unknown>) };
    delete extensionExtra.map;

    if (Object.keys(extensionExtra).length === 0) {
      delete extra[EXTENSION_ID];
    } else {
      extra[EXTENSION_ID] = extensionExtra;
    }

    this.api.chat.metadata.set({ ...metadata, extra });
    await this.api.events.emit(WORLD_MAP_UPDATED_EVENT);
  }

  private getMessageDeltas(messageIndex: number): WorldMapDelta[] {
    const message = this.api.chat.getHistory()[messageIndex];
    const deltas = (message?.extra[EXTENSION_ID] as WorldMapMessageExtraData | undefined)?.deltas;
    return Array.isArray(deltas) ? deltas : [];
  }

  private getMessageRollback(messageIndex: number): WorldMapRollbackSnapshot | undefined {
    const message = this.api.chat.getHistory()[messageIndex];
    return (message?.extra[EXTENSION_ID] as WorldMapMessageExtraData | undefined)?.rollback;
  }

  private getLatestMapProducingMessageIndex(): number {
    const history = this.api.chat.getHistory();
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const extra = history[index].extra[EXTENSION_ID] as WorldMapMessageExtraData | undefined;
      if ((extra?.deltas?.length ?? 0) > 0 || extra?.rollback) return index;
    }
    return -1;
  }

  private getReplayableMessageDeltas(excludedMessageIndex?: number): WorldMapDelta[] {
    return this.api.chat
      .getHistory()
      .flatMap((_, messageIndex) => (messageIndex === excludedMessageIndex ? [] : this.getMessageDeltas(messageIndex)));
  }

  private rebuildMapFromDeltas(deltas: WorldMapDelta[]): WorldMapDocument | null {
    const settings = this.getSettings();
    let rebuiltMap: WorldMapDocument | null = null;
    for (const delta of deltas) {
      rebuiltMap = mergeWorldMapDelta(rebuiltMap, delta, settings);
    }
    return rebuiltMap;
  }

  private async saveRebuiltMapFromDeltas(deltas: WorldMapDelta[]): Promise<void> {
    const rebuiltMap = this.rebuildMapFromDeltas(deltas);
    if (rebuiltMap && Object.keys(rebuiltMap.nodes).length > 0) {
      await this.setMap(rebuiltMap);
    } else {
      await this.removeChatMapMetadata();
    }
  }

  private async clearMessageExtras(): Promise<void> {
    const history = this.api.chat.getHistory();
    await Promise.all(
      history.map(async (message, index) => {
        if (message.extra[EXTENSION_ID] === undefined) return;
        await this.api.chat.updateMessageObject(index, {
          extra: {
            [EXTENSION_ID]: undefined,
          } as WorldMapMessageExtra,
        });
      }),
    );
  }

  public async removeMap(): Promise<void> {
    const metadata = this.api.chat.metadata.get();
    const hasChatMapData = Boolean(metadata?.extra?.[EXTENSION_ID]);
    const hasMessageData = this.api.chat.getHistory().some((message) => message.extra[EXTENSION_ID] !== undefined);
    if (!hasChatMapData && !hasMessageData) return;

    await this.removeChatMapMetadata();
    await this.clearMessageExtras();
    this.injectAllUi();
    this.api.ui.showToast('World map data removed for this chat.', 'success');
  }

  private async updateMessageExtra(index: number, data: Partial<WorldMapMessageExtraData>): Promise<void> {
    const message = this.api.chat.getHistory()[index];
    if (!message) return;
    const existing = message.extra[EXTENSION_ID] ?? {};
    await this.api.chat.updateMessageObject(index, {
      extra: {
        [EXTENSION_ID]: {
          ...existing,
          ...data,
        },
      },
    });
  }

  private async clearMessageExtra(index: number): Promise<void> {
    const message = this.api.chat.getHistory()[index];
    if (!message || message.extra[EXTENSION_ID] === undefined) return;
    const removedDeltaCount = this.getMessageDeltas(index).length;
    const remainingDeltas = this.getReplayableMessageDeltas(index);
    const rollback = this.getMessageRollback(index);
    const isLatestMapProducingMessage = this.getLatestMapProducingMessageIndex() === index;
    await this.api.chat.updateMessageObject(index, {
      extra: {
        [EXTENSION_ID]: undefined,
      } as WorldMapMessageExtra,
    });
    if (rollback && isLatestMapProducingMessage) {
      const rolledBackMap = applyRollbackSnapshot(this.getMap(), rollback);
      if (rolledBackMap) await this.setMap(rolledBackMap);
      else await this.removeChatMapMetadata();
    } else {
      await this.saveRebuiltMapFromDeltas(remainingDeltas);
    }
    this.injectChatUi();
    this.api.ui.showToast(
      rollback && isLatestMapProducingMessage
        ? 'World map reverted to the state before this message delta.'
        : removedDeltaCount > 0
          ? 'World map rebuilt without this message delta.'
          : 'World map data removed from message. No replayable delta was stored for it.',
      'success',
    );
  }

  private async buildMapContext(
    index: number,
    structuredResponse: StructuredResponseOptions,
    includeLorebookEntries?: boolean,
  ): Promise<ApiChatMessage[]> {
    const settings = this.getSettings();
    const history = this.api.chat.getHistory().slice(0, index + 1);
    const chatHistory = settings.includeLastXMessages === -1 ? history : history.slice(-settings.includeLastXMessages);
    const generationId = `world-map-${index}-${Date.now()}`;
    const itemizedPrompt = await this.api.chat.buildPrompt({ chatHistory, generationId, structuredResponse });
    this.api.chat.addItemizedPrompt(itemizedPrompt);
    const messages = [...itemizedPrompt.messages];
    const existingMap = this.getMap();

    const shouldIncludeLorebookEntries =
      includeLorebookEntries ?? (!existingMap && settings.includeActiveLorebookEntriesOnCreate);
    if (shouldIncludeLorebookEntries) {
      const lorebookEntries = await this.getActiveLorebookEntries();
      if (lorebookEntries.length > 0) {
        messages.push({
          role: 'system',
          name: 'System',
          content: `[Active lorebook entries for world map]\n${JSON.stringify(lorebookEntries)}`,
        });
      }
    }

    messages.push({
      role: 'system',
      name: 'System',
      content: existingMap
        ? `[Existing world map]\nThis map is useful saved state, but it may be incomplete, outdated, or partly wrong. Preserve valid existing ids and topology where possible, but correct clear mistakes and add missing stable locations from the current chat/lore context.\n${JSON.stringify(existingMap)}`
        : '[Existing world map]\nNo map exists yet. Create a complete initial world map from the available chat context. Use the most useful playable map scope as rootNodeId; do not create generic roots such as "Earth" unless the chat actually has multiple world-scale regions. Include important known locations, sub-map capable places, floors/rooms when known, traversal connections, renderable bounds, valid CSS background colors, generous view sizes for enterable nodes, stable area overlays, and routed connection points. Use backgrounds for broad materials and irregular areas for land/woods/beaches/fields/interiors. Do not create connections for parent-child hierarchy or adjacent/path/corridor edges from a child to its direct parent.',
    });
    return messages;
  }

  private async getActiveLorebookEntries(): Promise<
    Array<{
      book: string;
      uid: number;
      comment: string;
      keys: string[];
      secondaryKeys: string[];
      content: string;
    }>
  > {
    const bookNames = this.api.worldInfo.getActiveBookNames();
    const books = await Promise.all(bookNames.map((bookName) => this.api.worldInfo.getBook(bookName)));
    return books
      .filter((book) => book !== null)
      .flatMap((book) =>
        book.entries
          .filter((entry) => !entry.disable && entry.content.trim())
          .map((entry) => ({
            book: book.name,
            uid: entry.uid,
            comment: entry.comment,
            keys: entry.key,
            secondaryKeys: entry.keysecondary,
            content: entry.content,
          })),
      );
  }

  private async generateStructuredMapDelta(
    messages: ApiChatMessage[],
    settings: WorldMapSettings,
    connectionProfile: string,
    structuredResponse: StructuredResponseOptions,
  ): Promise<WorldMapGenerationResult> {
    let completionStructuredContent: object | undefined;
    let completionParseError: Error | undefined;
    const response = await this.api.llm.generate(messages, {
      connectionProfile,
      samplerOverrides: { max_tokens: settings.maxResponseTokens, stream: false },
      structuredResponse,
      onCompletion({ structured_content, parse_error }) {
        completionStructuredContent = structured_content;
        completionParseError = parse_error;
      },
    });

    if (Symbol.asyncIterator in response) {
      let rawContent = '';
      for await (const chunk of response) rawContent += chunk.delta;
      return { rawContent, parseError: 'World map generation unexpectedly returned a stream.' };
    }

    const generationResponse = response as GenerationResponse;
    const structuredContent = generationResponse.structured_content ?? completionStructuredContent;
    const parseError = completionParseError?.message;

    console.debug('[World Map] AI structured response:', structuredContent ?? { parseError });

    return {
      delta: structuredContent as WorldMapDelta | undefined,
      rawContent: generationResponse.content,
      parseError: structuredContent
        ? undefined
        : (parseError ?? 'World map generation returned no structured content.'),
    };
  }

  private async repairStructuredMapDelta(
    originalMessages: ApiChatMessage[],
    repairHeading: string,
    repairDetails: string,
    repairInstruction: string,
    settings: WorldMapSettings,
    connectionProfile: string,
    structuredResponse: StructuredResponseOptions,
  ): Promise<WorldMapGenerationResult> {
    const repairMessages: ApiChatMessage[] = [
      ...originalMessages,
      {
        role: 'user',
        name: 'User',
        content: `[${repairHeading}]\n${repairDetails}\n\n${repairInstruction}\n\nPreserve every id and all valid values unless a listed problem requires changing that specific field. Do not add unrelated locations, remove unrelated locations, rewrite topology, or invent content.`,
      },
    ];

    let completionStructuredContent: object | undefined;
    let completionParseError: Error | undefined;
    const response = await this.api.llm.generate(repairMessages, {
      connectionProfile,
      samplerOverrides: { max_tokens: settings.maxResponseTokens, stream: false },
      structuredResponse,
      onCompletion({ structured_content, parse_error }) {
        completionStructuredContent = structured_content;
        completionParseError = parse_error;
      },
    });

    if (Symbol.asyncIterator in response) {
      for await (const chunk of response) {
        void chunk;
        // Non-streamed repair is required so the parsed structured content is available.
      }
      return {
        rawContent: '',
        messages: repairMessages,
        parseError: 'World map repair unexpectedly returned a stream.',
      };
    }

    const generationResponse = response as GenerationResponse;
    const structuredContent = generationResponse.structured_content ?? completionStructuredContent;
    const repairedParseError = completionParseError?.message;
    console.debug(
      '[World Map] AI repaired structured response:',
      structuredContent ?? { parseError: repairedParseError },
    );

    return {
      delta: structuredContent as WorldMapDelta | undefined,
      rawContent: generationResponse.content,
      messages: [
        ...repairMessages,
        {
          role: 'assistant',
          name: 'Assistant',
          content: generationResponse.content,
        },
      ],
      parseError: structuredContent
        ? undefined
        : (repairedParseError ?? 'World map repair returned no structured content.'),
    };
  }

  public async runMapUpdate(index?: number, instructions?: string, includeLorebookEntries?: boolean): Promise<void> {
    const history = this.api.chat.getHistory();
    const targetIndex = index ?? history.length - 1;
    if (targetIndex < 0 || !history[targetIndex]) {
      this.api.ui.showToast('No message available for world map update.', 'info');
      return;
    }

    if (this.pendingRequests.has(targetIndex)) {
      this.api.ui.showToast('World map update is already running for this message.', 'info');
      return;
    }

    const settings = this.getSettings();
    if (!settings.enabled) {
      this.api.ui.showToast('World Map is disabled in settings.', 'info');
      return;
    }

    const connectionProfile =
      settings.connectionProfile || this.api.settings.getGlobal('api.selectedConnectionProfile');
    if (!connectionProfile) {
      this.api.ui.showToast('No connection profile selected for World Map.', 'error');
      return;
    }

    this.pendingRequests.add(targetIndex);
    await this.updateMessageExtra(targetIndex, { run: { status: 'pending', updatedAt: new Date().toISOString() } });

    try {
      const structuredResponse = getWorldMapStructuredResponse(settings.structuredRequestFormat);
      const contextMessages = await this.buildMapContext(targetIndex, structuredResponse, includeLorebookEntries);
      contextMessages.push({
        role: 'system',
        name: 'System',
        content: this.api.macro.process(settings.updatePrompt),
      });
      const trimmedInstructions = instructions?.trim();
      if (trimmedInstructions) {
        contextMessages.push({
          role: 'user',
          name: 'User',
          content: `[User world map instructions for this run]\n${this.api.macro.process(trimmedInstructions)}`,
        });
      }

      let generation = await this.generateStructuredMapDelta(
        contextMessages,
        settings,
        connectionProfile,
        structuredResponse,
      );
      const existingMap = this.getMap();
      let repairMessages = [
        ...contextMessages,
        {
          role: 'assistant' as const,
          name: 'Assistant',
          content: generation.rawContent,
        },
      ];

      if (!generation.delta && generation.parseError && generation.rawContent.trim()) {
        this.api.ui.showToast('World map response needs schema repair. Retrying once...', 'info');
        const repaired = await this.repairStructuredMapDelta(
          repairMessages,
          'Schema validation error',
          `${generation.parseError}\n\nFix invalid enum values, invalid visual fields, invalid dash strings, additional properties, or other schema errors by using the closest valid schema value or omitting the invalid optional field.`,
          'Repair your previous World Map structured JSON delta. Return the complete corrected delta, not a partial patch. The previous response was schema-invalid and was not applied, so omitting unchanged nodes or connections would delete the usable map context.',
          settings,
          connectionProfile,
          structuredResponse,
        );
        generation = { ...generation, ...repaired };
        if (repaired.messages) repairMessages = repaired.messages;
      }

      if (!existingMap && generation.delta && !hasInitialMapAnchor(generation.delta)) {
        generation = {
          ...generation,
          delta: undefined,
          parseError:
            'World map schema repair returned a partial delta without the root/top-level map. Retry creation so the repaired response includes the complete initial map.',
        };
      }

      const appliedDeltas: WorldMapDelta[] = [];
      let candidateMap: WorldMapDocument | undefined;
      if (generation.delta) {
        appliedDeltas.push(generation.delta);
        candidateMap = mergeWorldMapDelta(existingMap, generation.delta, settings);
      }
      let qualityRepairCount = 0;
      let qualityValidationError: string | undefined;
      while (candidateMap && qualityRepairCount < MAX_QUALITY_REPAIRS) {
        const qualityIssues = validateWorldMapDeltaQuality(candidateMap, {});
        if (qualityIssues.length === 0) break;
        qualityValidationError = qualityIssues.map((issue) => `- ${issue.code}: ${issue.message}`).join('\n');
        const candidateMapJson = JSON.stringify(candidateMap);

        this.api.ui.showToast('World map response needs render-quality repair. Retrying once...', 'info');
        let repaired = await this.repairStructuredMapDelta(
          repairMessages,
          'Map quality validation issues',
          `${qualityValidationError}\n\n[Current candidate map after all applied deltas]\n${candidateMapJson}\n\nThis is a valid structured delta that needs render-quality fixes. You may return only the corrected nodes, connections, removals, or visual assignments as a delta patch. Keep unchanged map data out of the response if it is not needed for the correction. Areas are embedded inside their owning node; to remove or change areas, resend that node with the corrected complete areas array. Do not put area ids in removeNodeIds because areas are not nodes.`,
          'Repair your previous World Map structured JSON delta. You may return only the corrected nodes, connections, removals, or visual assignments as a delta patch because the previous structured delta has already been applied to a candidate map.',
          settings,
          connectionProfile,
          structuredResponse,
        );
        if (!repaired.delta && repaired.parseError && repaired.rawContent.trim()) {
          const schemaRepaired = await this.repairStructuredMapDelta(
            repaired.messages ?? repairMessages,
            'Schema validation error in map quality repair',
            `${repaired.parseError}\n\nThe previous quality-repair response was not applied. Fix invalid enum values, missing required fields such as visualPackDelta.packName, invalid visual fields, invalid dash strings, additional properties, or other schema errors by using the closest valid schema value or omitting the invalid optional field.`,
            'Repair your previous World Map quality-repair JSON delta. Return the complete corrected repair delta, not a prose explanation.',
            settings,
            connectionProfile,
            structuredResponse,
          );
          repaired = { ...repaired, ...schemaRepaired };
        }
        generation = { ...generation, ...repaired };
        if (repaired.messages) repairMessages = repaired.messages;
        if (repaired.delta) {
          appliedDeltas.push(repaired.delta);
          candidateMap = mergeWorldMapDelta(candidateMap, repaired.delta, settings);
        } else {
          qualityValidationError = repaired.parseError ?? 'World map quality repair returned no structured delta.';
          break;
        }
        qualityRepairCount += 1;
      }
      if (candidateMap) {
        const remainingQualityIssues = validateWorldMapDeltaQuality(candidateMap, {});
        if (remainingQualityIssues.length > 0) {
          qualityValidationError = remainingQualityIssues
            .map((issue) => `- ${issue.code}: ${issue.message}`)
            .join('\n');
          generation = {
            ...generation,
            delta: undefined,
            parseError: `World map quality validation failed after repair:\n${qualityValidationError}`,
          };
          candidateMap = undefined;
        }
      }

      if (!candidateMap) {
        const error = generation.parseError ?? 'World map generation returned no structured content.';
        await this.updateMessageExtra(targetIndex, {
          run: { status: 'error', error, updatedAt: new Date().toISOString() },
        });
        this.api.ui.showToast('World map update failed.', 'error');
        return;
      }

      const rollback = createRollbackSnapshot(existingMap, appliedDeltas);
      await this.setMap(candidateMap);
      await this.updateMessageExtra(targetIndex, {
        run: { status: 'success', updatedAt: new Date().toISOString() },
        deltas: appliedDeltas,
        rollback,
      });
      this.api.ui.showToast('World map updated.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown world map update error.';
      await this.updateMessageExtra(targetIndex, {
        run: { status: 'error', error: message, updatedAt: new Date().toISOString() },
      });
      this.api.ui.showToast('World map update failed.', 'error');
      console.error('World map update failed:', error);
    } finally {
      this.pendingRequests.delete(targetIndex);
    }
  }

  public async smartShuffleMap(mode: WorldMapShuffleMode): Promise<void> {
    const map = this.getMap();
    if (!map) {
      this.api.ui.showToast('No world map exists for this chat yet.', 'info');
      return;
    }
    const shuffledMap = smartShuffleWorldMap(map, mode, `${Date.now()}-${Math.random()}`);
    await this.setMap(shuffledMap);
    this.api.ui.showToast(
      mode === 'all' ? 'World map shuffled.' : `World map ${mode === 'positions' ? 'positions' : mode} shuffled.`,
      'success',
    );
  }

  public async showMap(): Promise<void> {
    await this.api.ui.showPopup({
      title: 'World Map',
      component: WorldMapPanel,
      componentProps: {
        api: this.api,
        runMapUpdate: (instructions?: string, includeLorebookEntries?: boolean) =>
          this.runMapUpdate(undefined, instructions, includeLorebookEntries),
        smartShuffleMap: (mode: WorldMapShuffleMode) => this.smartShuffleMap(mode),
        removeMap: async () => {
          const { result } = await this.api.ui.showPopup({
            title: 'Remove World Map',
            content: 'Remove the existing world map for this chat?',
            type: POPUP_TYPE.CONFIRM,
            okButton: 'common.delete',
            cancelButton: 'common.cancel',
          });
          if (result === POPUP_RESULT.AFFIRMATIVE) {
            await this.removeMap();
          }
        },
      },
      wide: true,
      large: true,
      okButton: 'common.close',
    });
  }

  public handleAutoUpdate(message: ChatMessage): void {
    const settings = this.getSettings();
    if (!settings.enabled || settings.autoMode === 'none') return;

    const shouldTrackUser = settings.autoMode === 'inputs' || settings.autoMode === 'both';
    const shouldTrackBot = settings.autoMode === 'responses' || settings.autoMode === 'both';
    if ((message.is_user && shouldTrackUser) || (!message.is_user && shouldTrackBot)) {
      const index = this.api.chat.getHistory().length - 1;
      window.setTimeout(() => this.runMapUpdate(index), 200);
    }
  }

  public injectContext(apiMessages: ApiChatMessage[], index: number, chatLength: number, generationId: string): void {
    const settings = this.getSettings();
    if (!settings.enabled || generationId.startsWith('world-map-')) return;
    if (index !== chatLength - 1 || this.injectedContextGenerationIds.has(generationId)) return;

    const map = this.getMap();
    if (!map) return;

    const content = serializeWorldMapForPrompt(map);
    if (!content) return;

    apiMessages.push({
      role: 'system',
      name: 'System',
      content,
    });
    this.injectedContextGenerationIds.add(generationId);
    if (this.injectedContextGenerationIds.size > 100) this.injectedContextGenerationIds.clear();
  }

  public injectAllUi(): void {
    this.unmountAllUi();
    this.api.chat.getHistory().forEach((_, index) => this.injectUiForMessage(index));
    this.injectChatUi();
  }

  public injectUiForMessage(index: number): void {
    const message = this.api.chat.getHistory()[index];
    if (!message || this.mountedButtons.has(index)) return;
    const messageEl = document.querySelector(`[data-message-index="${index}"]`);
    const target = messageEl?.querySelector('.message-buttons');
    if (!target) return;

    const mountPoint = document.createElement('div');
    target.insertAdjacentElement('afterbegin', mountPoint);
    const button = this.api.ui.mount(mountPoint, MapMessageButton, {
      message,
      title: this.getMap() ? 'Update world map from this message' : 'Create world map from this message',
      onRun: () => this.runMapUpdate(index),
      onClear: () => this.clearMessageExtra(index),
    });
    this.mountedButtons.set(index, {
      unmount: () => {
        button.unmount();
        mountPoint.remove();
      },
      component: MapMessageButton,
    });
  }

  public injectChatUi(): void {
    this.unregisterChatUiFns.forEach((fn) => fn());
    this.unregisterChatUiFns = [];
    if (!this.api.chat.getChatInfo()) return;

    this.unregisterChatUiFns.push(
      this.api.ui.registerChatQuickAction(QUICK_ACTION_GROUP_ID, 'Context AI', {
        id: 'world-map-open',
        icon: 'fa-solid fa-map-location-dot',
        label: 'World Map',
        onClick: () => this.showMap(),
      }),
    );
    this.unregisterChatUiFns.push(
      this.api.ui.registerChatFormOptionsMenuItem({
        id: 'world-map-update',
        icon: 'fa-solid fa-map-location-dot',
        label: this.getMap() ? 'Update World Map' : 'Create World Map',
        onClick: () => this.runMapUpdate(),
      }),
    );
  }

  public unmountMessageUi(indices: number[]): void {
    for (const index of indices) {
      this.mountedButtons.get(index)?.unmount();
      this.mountedButtons.delete(index);
    }
  }

  public async handleMessageDeleted(deletedMessages: ChatMessage[]): Promise<void> {
    const deletedMapProducer = deletedMessages.some((message) => {
      const extra = message.extra[EXTENSION_ID] as WorldMapMessageExtraData | undefined;
      return (extra?.deltas?.length ?? 0) > 0 || Boolean(extra?.rollback);
    });

    if (deletedMapProducer) {
      await this.saveRebuiltMapFromDeltas(this.getReplayableMessageDeltas());
    }

    this.mountedButtons.forEach((component) => component.unmount());
    this.mountedButtons.clear();
    this.api.chat.getHistory().forEach((_, index) => this.injectUiForMessage(index));
    this.injectChatUi();
  }

  public unmountAllUi(): void {
    this.mountedButtons.forEach((component) => component.unmount());
    this.mountedButtons.clear();
    this.unregisterChatUiFns.forEach((fn) => fn());
    this.unregisterChatUiFns = [];
    this.pendingRequests.clear();
    this.injectedContextGenerationIds.clear();
  }
}

export function activate(api: WorldMapExtensionAPI) {
  let settingsApp: { unmount: () => void } | null = null;
  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const manager = new WorldMapManager(api);
  const unbinds: Array<() => void> = [];

  api.ui.registerNavBarItem(MAP_NAV_ID, {
    title: 'World Map',
    icon: 'fa-solid fa-map-location-dot',
    onClick: () => manager.showMap(),
  });

  unbinds.push(api.events.on('chat:entered', () => manager.injectAllUi()));
  unbinds.push(
    api.events.on('message:created', (message: ChatMessage) => {
      manager.injectUiForMessage(api.chat.getHistory().length - 1);
      manager.handleAutoUpdate(message);
    }),
  );
  unbinds.push(
    api.events.on('message:updated', (index: number) => {
      manager.unmountMessageUi([index]);
      manager.injectUiForMessage(index);
      manager.injectChatUi();
    }),
  );
  unbinds.push(
    api.events.on('message:deleted', (_indices: number[], deletedMessages: ChatMessage[]) =>
      manager.handleMessageDeleted(deletedMessages),
    ),
  );
  unbinds.push(api.events.on('chat:cleared', () => manager.unmountAllUi()));
  unbinds.push(api.events.on('chat:deleted', () => manager.unmountAllUi()));
  unbinds.push(
    api.events.on(
      'prompt:history-message-processing',
      (
        payload: { apiMessages: ApiChatMessage[] },
        context: { originalMessage: ChatMessage; index: number; generationId: string; chatLength: number },
      ) => {
        manager.injectContext(payload.apiMessages, context.index, context.chatLength, context.generationId);
      },
    ),
  );

  if (api.chat.getChatInfo()) manager.injectAllUi();

  return () => {
    unbinds.forEach((unbind) => unbind());
    manager.unmountAllUi();
    settingsApp?.unmount();
    api.ui.unregisterNavBarItem(MAP_NAV_ID);
  };
}
