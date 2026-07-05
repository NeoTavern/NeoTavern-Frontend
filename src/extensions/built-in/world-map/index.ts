import type { Component } from 'vue';
import type { ChatMessage } from '../../../types';
import type { ApiChatMessage, StructuredResponseOptions } from '../../../types/generation';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import { resolveConnectionProfile } from '../_shared/runtime/connection-profile';
import { cloneJson } from '../_shared/data-utils';
import { findChatMessageIndex, isFinishedAssistantMessage } from '../_shared/runtime/chat-message';
import {
  clearChatExtra,
  clearMessageExtra,
  getChatExtra,
  mergeChatExtra,
  mergeMessageExtra,
  setChatExtra,
} from '../_shared/runtime/extension-extra';
import { generateStructuredResult } from '../_shared/runtime/structured-generation';
import { createStructuredResponse } from '../_shared/runtime/structured-request-format';
import { manifest } from './manifest';
import { getMapFromMetadata, mergeWorldMapDelta, serializeWorldMapForPrompt } from './map-utils';
import MapMessageButton from './MapMessageButton.vue';
import SettingsPanel from './SettingsPanel.vue';
import { smartShuffleWorldMap, type WorldMapShuffleMode } from './smart-shuffle';
import {
  WORLD_MAP_UPDATED_EVENT,
  type WorldMapAccessPoint,
  type WorldMapBounds,
  type WorldMapChatExtra,
  type WorldMapDelta,
  type WorldMapDocument,
  type WorldMapExtensionAPI,
  type WorldMapMessageExtra,
  type WorldMapMessageExtraData,
  type WorldMapNode,
  type WorldMapRollbackSnapshot,
  type WorldMapRoute,
  type WorldMapSettings,
  migrateWorldMapSettings,
  resolveWorldMapPrompts,
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

function areaOverflowsView(node: WorldMapNode, area: NonNullable<WorldMapNode['areas']>[number]): boolean {
  if (!node.view) return false;
  const bounds = areaBounds(area);
  if (!bounds) return false;
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  return bounds.x < -1 || bounds.y < -1 || maxX > node.view.width + 1 || maxY > node.view.height + 1;
}

function isFloorLikeArea(area: NonNullable<WorldMapNode['areas']>[number]): boolean {
  const text = `${area.id} ${area.label ?? ''}`.toLowerCase();
  return (
    area.kind === 'interior' &&
    /\b(floor|ground|basement|level|1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\b/.test(text)
  );
}

function routeLooksLikeNamedDestination(route: WorldMapRoute): boolean {
  const text = `${route.id} ${route.label ?? ''}`.toLowerCase();
  return (
    /\bto[-_\s]+[a-z0-9]/.test(text) || /\b(path|road|trail|corridor|stairs|elevator|portal)[-_\s]+to[-_\s]+/.test(text)
  );
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

function hasSiblingRouteAccess(
  parentId: string,
  children: WorldMapNode[],
  routes: WorldMapRoute[],
  accessPoints: WorldMapAccessPoint[],
): boolean {
  const childIds = new Set(children.map((child) => child.id));
  const routeIds = new Set(routes.filter((route) => route.parentId === parentId).map((route) => route.id));
  const counts = new Map<string, number>();
  for (const access of accessPoints) {
    if (!routeIds.has(access.routeId) || !childIds.has(access.nodeId)) continue;
    counts.set(access.routeId, (counts.get(access.routeId) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 2);
}

function childIdsWithRouteAccess(
  parentId: string,
  children: WorldMapNode[],
  routes: WorldMapRoute[],
  accessPoints: WorldMapAccessPoint[],
): Set<string> {
  const childIds = new Set(children.map((child) => child.id));
  const routeIds = new Set(routes.filter((route) => route.parentId === parentId).map((route) => route.id));
  const covered = new Set<string>();
  for (const access of accessPoints) {
    if (!routeIds.has(access.routeId) || !childIds.has(access.nodeId)) continue;
    covered.add(access.nodeId);
  }
  return covered;
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
    routeStyles: {},
    labelStyles: {},
  };
  const icons = { ...(pack.icons ?? {}) };
  const areaStyles = { ...(pack.areaStyles ?? {}) };
  const routeStyles = { ...(pack.routeStyles ?? {}) };
  const labelStyles = { ...(pack.labelStyles ?? {}) };

  for (const id of visualDelta.removeIconIds ?? []) delete icons[id];
  for (const id of visualDelta.removeAreaStyleIds ?? []) delete areaStyles[id];
  for (const id of visualDelta.removeRouteStyleIds ?? []) delete routeStyles[id];
  for (const id of visualDelta.removeLabelStyleIds ?? []) delete labelStyles[id];

  visualPacks[visualDelta.packId] = {
    ...pack,
    icons: { ...icons, ...Object.fromEntries((visualDelta.icons ?? []).map((icon) => [icon.id, icon])) },
    areaStyles: {
      ...areaStyles,
      ...Object.fromEntries((visualDelta.areaStyles ?? []).map((style) => [style.id, style])),
    },
    routeStyles: {
      ...routeStyles,
      ...Object.fromEntries((visualDelta.routeStyles ?? []).map((style) => [style.id, style])),
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

function hasInitialMapAnchor(delta: WorldMapDelta): boolean {
  const nodes = delta.createOrUpdateNodes ?? [];
  if (delta.rootNodeId && nodes.some((node) => node.id === delta.rootNodeId)) return true;
  return nodes.some((node) => !node.parentId && node.view);
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
  target[id] = assets?.[id] ? cloneJson(assets[id]) : null;
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
    routeStyles: {},
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
    snapshot.nodes[nodeId] = map?.nodes[nodeId] ? cloneJson(map.nodes[nodeId]) : null;
  };

  const snapshotRoute = (routeId: string) => {
    snapshot.routes ??= {};
    if (Object.prototype.hasOwnProperty.call(snapshot.routes, routeId)) return;
    const route = map?.routes.find((item) => item.id === routeId);
    snapshot.routes[routeId] = route ? cloneJson(route) : null;
  };

  const snapshotAccessPoint = (accessPointId: string) => {
    snapshot.accessPoints ??= {};
    if (Object.prototype.hasOwnProperty.call(snapshot.accessPoints, accessPointId)) return;
    const accessPoint = map?.accessPoints.find((item) => item.id === accessPointId);
    snapshot.accessPoints[accessPointId] = accessPoint ? cloneJson(accessPoint) : null;
  };

  for (const delta of deltas) {
    if (delta.rootNodeId !== undefined && snapshot.rootNodeId === undefined) {
      snapshot.rootNodeId = map?.rootNodeId ?? null;
    }

    for (const node of delta.createOrUpdateNodes ?? []) snapshotNode(node.id);
    const removedNodeIds = collectNodeIdsWithDescendants(map?.nodes, new Set(delta.removeNodeIds ?? []));
    for (const nodeId of removedNodeIds) snapshotNode(nodeId);
    for (const route of map?.routes ?? []) if (removedNodeIds.has(route.parentId)) snapshotRoute(route.id);
    for (const access of map?.accessPoints ?? []) if (removedNodeIds.has(access.nodeId)) snapshotAccessPoint(access.id);
    for (const assignment of delta.visualPackDelta?.assignNodeVisuals ?? []) snapshotNode(assignment.nodeId);

    for (const route of delta.createOrUpdateRoutes ?? []) snapshotRoute(route.id);
    for (const routeId of delta.removeRouteIds ?? []) snapshotRoute(routeId);
    for (const access of delta.createOrUpdateAccessPoints ?? []) snapshotAccessPoint(access.id);
    for (const accessPointId of delta.removeAccessPointIds ?? []) snapshotAccessPoint(accessPointId);
    for (const assignment of delta.visualPackDelta?.assignRouteVisuals ?? []) snapshotRoute(assignment.routeId);

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
    for (const style of visualDelta.routeStyles ?? []) {
      snapshotVisualPackAsset(packRollback.routeStyles!, style.id, pack?.routeStyles);
    }
    for (const styleId of visualDelta.removeRouteStyleIds ?? []) {
      snapshotVisualPackAsset(packRollback.routeStyles!, styleId, pack?.routeStyles);
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
    else target[id] = cloneJson(value);
  }
}

export function applyRollbackSnapshot(
  currentMap: WorldMapDocument | null,
  rollback: WorldMapRollbackSnapshot,
): WorldMapDocument | null {
  if (!currentMap) return null;
  const map = cloneJson(currentMap);

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
      routeStyles: {},
      labelStyles: {},
    });
    if (packRollback.name) pack.name = packRollback.name;
    pack.icons ??= {};
    pack.areaStyles ??= {};
    pack.routeStyles ??= {};
    pack.labelStyles ??= {};
    restoreRecord(pack.icons, packRollback.icons);
    restoreRecord(pack.areaStyles, packRollback.areaStyles);
    restoreRecord(pack.routeStyles, packRollback.routeStyles);
    restoreRecord(pack.labelStyles, packRollback.labelStyles);
  }

  restoreRecord(map.nodes, rollback.nodes);

  for (const [routeId, route] of Object.entries(rollback.routes ?? {})) {
    const index = map.routes.findIndex((item) => item.id === routeId);
    if (route === null) {
      if (index !== -1) map.routes.splice(index, 1);
    } else if (index === -1) {
      map.routes.push(cloneJson(route));
    } else {
      map.routes[index] = cloneJson(route);
    }
  }

  for (const [accessPointId, accessPoint] of Object.entries(rollback.accessPoints ?? {})) {
    const index = map.accessPoints.findIndex((item) => item.id === accessPointId);
    if (accessPoint === null) {
      if (index !== -1) map.accessPoints.splice(index, 1);
    } else if (index === -1) {
      map.accessPoints.push(cloneJson(accessPoint));
    } else {
      map.accessPoints[index] = cloneJson(accessPoint);
    }
  }

  const routeIds = new Set(map.routes.map((route) => route.id));
  map.routes = map.routes.filter((route) => map.nodes[route.parentId]);
  map.accessPoints = map.accessPoints.filter((access) => map.nodes[access.nodeId] && routeIds.has(access.routeId));
  map.updatedAt = new Date().toISOString();

  return Object.keys(map.nodes).length > 0 ? map : null;
}

export function validateWorldMapDeltaQuality(
  currentMap: WorldMapDocument | null,
  delta: WorldMapDelta,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const nodes = buildProjectedNodes(currentMap, delta);
  const removeRouteIds = new Set(delta.removeRouteIds ?? []);
  const routes = [...(currentMap?.routes ?? [])].filter((route) => !removeRouteIds.has(route.id));
  for (const route of delta.createOrUpdateRoutes ?? []) {
    const index = routes.findIndex((item) => item.id === route.id);
    if (index === -1) routes.push(route);
    else routes[index] = { ...routes[index], ...route };
  }
  const removeAccessPointIds = new Set(delta.removeAccessPointIds ?? []);
  const accessPoints = [...(currentMap?.accessPoints ?? [])].filter((access) => !removeAccessPointIds.has(access.id));
  for (const access of delta.createOrUpdateAccessPoints ?? []) {
    const index = accessPoints.findIndex((item) => item.id === access.id);
    if (index === -1) accessPoints.push(access);
    else accessPoints[index] = { ...accessPoints[index], ...access };
  }
  for (const assignment of delta.visualPackDelta?.assignRouteVisuals ?? []) {
    const route = routes.find((item) => item.id === assignment.routeId);
    if (route) route.visual = { ...assignment.visual };
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

      if (areaOverflowsView(node, area)) {
        issues.push({
          code: 'area_outside_view',
          message: `Area "${area.id}" on node "${node.id}" extends outside the node view. Keep area polygon points inside the owning node's view coordinate space or enlarge the view.`,
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

    const directRoomChildren = (childrenByParent.get(node.id) ?? []).filter((child) =>
      ['room', 'poi'].includes(child.kind),
    );
    if (node.kind === 'building' && directRoomChildren.length >= 2 && node.areas?.some(isFloorLikeArea)) {
      issues.push({
        code: 'rooms_need_floor_parent',
        message: `Building "${node.id}" has floor-like interior areas but ${directRoomChildren.length} direct room/POI child node(s). Create floor nodes for known floors and parent those rooms to the matching floor, or remove the floor-like areas and use a single floor-plan layout.`,
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
    if (
      boundedNavigableChildren.length >= 3 &&
      !hasSiblingRouteAccess(parentId, boundedNavigableChildren, routes, accessPoints)
    ) {
      issues.push({
        code: 'disconnected_sibling_map',
        message: `Parent "${parentId}" has ${boundedNavigableChildren.length} renderable sibling locations but no shared route network. Add route geometry and access points for physical roads, paths, corridors, stairs, elevators, or portals where travel routes are known.`,
      });
    }

    if (
      boundedNavigableChildren.length >= 3 &&
      hasSiblingRouteAccess(parentId, boundedNavigableChildren, routes, accessPoints)
    ) {
      const coveredChildIds = childIdsWithRouteAccess(parentId, boundedNavigableChildren, routes, accessPoints);
      const uncoveredChildren = boundedNavigableChildren.filter((child) => !coveredChildIds.has(child.id));
      if (uncoveredChildren.length > 0) {
        issues.push({
          code: 'incomplete_sibling_route_access',
          message: `Parent "${parentId}" has a shared route network, but ${uncoveredChildren.length} renderable sibling location(s) are not attached by access points: ${uncoveredChildren.map((child) => child.id).join(', ')}. Add access points from each reachable sibling to a route in the same parent view, or remove routes that imply unreachable locations.`,
        });
      }
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

  const routeIds = new Set(routes.map((route) => route.id));
  const accessCountByRoute = new Map<string, number>();
  for (const access of accessPoints) {
    accessCountByRoute.set(access.routeId, (accessCountByRoute.get(access.routeId) ?? 0) + 1);
  }

  for (const route of routes) {
    if (routeLooksLikeNamedDestination(route) && (accessCountByRoute.get(route.id) ?? 0) === 0) {
      issues.push({
        code: 'unattached_named_route',
        message: `Route "${route.id}" is named like it leads to a specific destination, but it has no access points. Add access points to the destination node(s), create the missing destination node, or rename/remove the route if it is only decorative geometry.`,
      });
    }
  }

  for (const access of accessPoints) {
    const route = routes.find((item) => item.id === access.routeId);
    const node = nodes[access.nodeId];
    if (!node || !routeIds.has(access.routeId) || !route || node.parentId !== route.parentId) {
      issues.push({
        code: 'invalid_access_point',
        message: `Access point "${access.id}" references a missing route or node, or attaches a node outside the route parent view.`,
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
  const routeStyleIds = new Set([
    ...existingVisualPacks.flatMap((pack) => Object.keys(pack.routeStyles ?? {})),
    ...(visualDelta?.routeStyles?.map((style) => style.id) ?? []),
  ]);
  const labelStyleIds = new Set([
    ...existingVisualPacks.flatMap((pack) => Object.keys(pack.labelStyles ?? {})),
    ...(visualDelta?.labelStyles?.map((style) => style.id) ?? []),
  ]);
  const activeVisualPack = getActiveVisualPackAfterDelta(currentMap, delta);
  const activeIcons = Object.values(activeVisualPack?.icons ?? {});
  const activeAreaStyles = Object.values(activeVisualPack?.areaStyles ?? {});
  const activeRouteStyles = Object.values(activeVisualPack?.routeStyles ?? {});
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

    for (const style of activeRouteStyles) {
      const assignedCount = routes.filter((route) => route.visual?.styleId === style.id).length;
      if (assignedCount === 0) {
        issues.push({
          code: 'unused_route_style_definition',
          message: `Route style "${style.id}" is defined but not assigned to any route. Assign it to matching routes or remove it with visualPackDelta.removeRouteStyleIds.`,
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

  for (const route of routes) {
    if (route.visual?.styleId && !routeStyleIds.has(route.visual.styleId)) {
      issues.push({
        code: 'missing_route_style_definition',
        message: `Route "${route.id}" references style "${route.visual.styleId}" but no active visual pack defines that route style. Define the style, assign an existing styleId, or remove the invalid route visual reference.`,
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

    for (const assignment of visualDelta.assignRouteVisuals ?? []) {
      if (assignment.visual.styleId && !routeStyleIds.has(assignment.visual.styleId)) {
        issues.push({
          code: 'missing_route_style_definition',
          message: `Route visual assignment for "${assignment.routeId}" references style "${assignment.visual.styleId}" but this delta does not define that route style.`,
        });
      }
    }
  }

  return issues;
}

function getWorldMapStructuredResponse(format: WorldMapSettings['structuredRequestFormat']): StructuredResponseOptions {
  return createStructuredResponse(format, {
    name: 'world_map_delta',
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
                      enum: ['terrain', 'water', 'woods', 'garden', 'courtyard', 'field', 'cliff', 'interior', 'other'],
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
        createOrUpdateRoutes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              parentId: { type: 'string' },
              kind: {
                type: 'string',
                enum: ['road', 'path', 'corridor', 'door', 'stairs', 'elevator', 'portal', 'adjacent', 'unknown'],
              },
              label: { type: 'string' },
              points: {
                type: 'array',
                minItems: 2,
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
              smoothPath: { type: 'boolean' },
              visual: {
                type: 'object',
                properties: {
                  styleId: { type: 'string' },
                },
              },
            },
            required: ['id', 'parentId', 'kind', 'points'],
          },
        },
        removeRouteIds: { type: 'array', items: { type: 'string' } },
        createOrUpdateAccessPoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              routeId: { type: 'string' },
              nodeId: { type: 'string' },
              point: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                },
                required: ['x', 'y'],
              },
              label: { type: 'string' },
              kind: {
                type: 'string',
                enum: ['entrance', 'door', 'gate', 'stairs', 'elevator', 'dock', 'trailhead', 'portal', 'other'],
              },
            },
            required: ['id', 'routeId', 'nodeId', 'point'],
          },
        },
        removeAccessPointIds: { type: 'array', items: { type: 'string' } },
        visualPackDelta: {
          type: 'object',
          properties: {
            packId: { type: 'string' },
            packName: { type: 'string' },
            removeIconIds: { type: 'array', items: { type: 'string' } },
            removeAreaStyleIds: { type: 'array', items: { type: 'string' } },
            removeRouteStyleIds: { type: 'array', items: { type: 'string' } },
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
                    enum: ['world', 'region', 'settlement', 'district', 'building', 'floor', 'room', 'landmark', 'poi'],
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
            routeStyles: {
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
            assignRouteVisuals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  routeId: { type: 'string' },
                  visual: {
                    type: 'object',
                    properties: {
                      styleId: { type: 'string' },
                    },
                  },
                },
                required: ['routeId', 'visual'],
              },
            },
          },
          required: ['packId', 'packName'],
        },
      },
    },
  });
}

class WorldMapManager {
  private mountedButtons = new Map<number, MountedComponent>();
  private pendingRequests = new Set<number>();
  private injectedContextGenerationIds = new Set<string>();
  private unregisterChatUiFns: Array<() => void> = [];

  constructor(private api: WorldMapExtensionAPI) {}

  private getSettings(): WorldMapSettings {
    const settings = migrateWorldMapSettings(this.api.settings.get());
    this.api.settings.set(undefined, settings);
    return settings;
  }

  private getMap(): WorldMapDocument | null {
    return getMapFromMetadata(this.api.chat.metadata.get());
  }

  private async setMap(map: WorldMapDocument): Promise<void> {
    mergeChatExtra<WorldMapChatExtra>(this.api, EXTENSION_ID, { map });
    await this.api.events.emit(WORLD_MAP_UPDATED_EVENT);
  }

  private async removeChatMapMetadata(): Promise<void> {
    const extensionExtra = { ...(getChatExtra<Record<string, unknown>>(this.api, EXTENSION_ID) ?? {}) };
    if (Object.keys(extensionExtra).length === 0) return;
    delete extensionExtra.map;

    if (Object.keys(extensionExtra).length === 0) {
      clearChatExtra<WorldMapChatExtra>(this.api, EXTENSION_ID);
    } else {
      setChatExtra<WorldMapChatExtra>(this.api, EXTENSION_ID, extensionExtra);
    }

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
        await clearMessageExtra<WorldMapMessageExtra>(this.api, index, EXTENSION_ID);
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
    this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.removed'), 'success');
  }

  private async updateMessageExtra(index: number, data: Partial<WorldMapMessageExtraData>): Promise<void> {
    const message = this.api.chat.getHistory()[index];
    if (!message) return;
    await mergeMessageExtra<WorldMapMessageExtra>(this.api, index, EXTENSION_ID, data);
  }

  private async clearMessageExtra(index: number): Promise<void> {
    const message = this.api.chat.getHistory()[index];
    if (!message || message.extra[EXTENSION_ID] === undefined) return;
    const removedDeltaCount = this.getMessageDeltas(index).length;
    const remainingDeltas = this.getReplayableMessageDeltas(index);
    const rollback = this.getMessageRollback(index);
    const isLatestMapProducingMessage = this.getLatestMapProducingMessageIndex() === index;
    await clearMessageExtra<WorldMapMessageExtra>(this.api, index, EXTENSION_ID);
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
        ? this.api.i18n.t('extensionsBuiltin.worldMap.toasts.reverted')
        : removedDeltaCount > 0
          ? this.api.i18n.t('extensionsBuiltin.worldMap.toasts.rebuilt')
          : this.api.i18n.t('extensionsBuiltin.worldMap.toasts.messageDataRemoved'),
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
        : '[Existing world map]\nNo map exists yet. Create a complete initial world map from the available chat context. Use the most useful playable map scope as rootNodeId; do not create generic roots such as "Earth" unless the chat actually has multiple world-scale regions. Include important known locations, sub-map capable places, floors/rooms when known, traversal route networks, access points from places onto routes, renderable bounds, valid CSS background colors, generous view sizes for enterable nodes, stable area overlays, and route geometry. Use backgrounds for broad materials and irregular areas for land/woods/beaches/fields/interiors. Do not create routes for parent-child hierarchy; parentId already represents containment.',
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
    captureMessageIndex?: number,
  ): Promise<WorldMapGenerationResult> {
    const generation = await generateStructuredResult<WorldMapDelta>(this.api, {
      messages,
      options: {
        connectionProfile,
        samplerOverrides: { max_tokens: settings.maxResponseTokens, stream: false },
        structuredResponse,
        captureMessageIndex,
      },
      streamErrorMessage: 'World map generation unexpectedly returned a stream.',
      missingStructuredContentMessage: 'World map generation returned no structured content.',
      collectStreamContent: true,
    });

    return {
      delta: generation.structuredContent,
      rawContent: generation.rawContent,
      parseError: generation.parseError,
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
    captureMessageIndex?: number,
  ): Promise<WorldMapGenerationResult> {
    const repairMessages: ApiChatMessage[] = [
      ...originalMessages,
      {
        role: 'user',
        name: 'User',
        content: `[${repairHeading}]\n${repairDetails}\n\n${repairInstruction}\n\nPreserve every id and all valid values unless a listed problem requires changing that specific field. Do not add unrelated locations, remove unrelated locations, rewrite topology, or invent content.`,
      },
    ];

    const generation = await generateStructuredResult<WorldMapDelta>(this.api, {
      messages: repairMessages,
      options: {
        connectionProfile,
        samplerOverrides: { max_tokens: settings.maxResponseTokens, stream: false },
        structuredResponse,
        captureMessageIndex,
      },
      streamErrorMessage: 'World map repair unexpectedly returned a stream.',
      missingStructuredContentMessage: 'World map repair returned no structured content.',
    });

    return {
      delta: generation.structuredContent,
      rawContent: generation.rawContent,
      messages: [
        ...repairMessages,
        {
          role: 'assistant',
          name: 'Assistant',
          content: generation.rawContent,
        },
      ],
      parseError: generation.parseError,
    };
  }

  public async runMapUpdate(index?: number, instructions?: string, includeLorebookEntries?: boolean): Promise<void> {
    const history = this.api.chat.getHistory();
    const targetIndex = index ?? history.length - 1;
    if (targetIndex < 0 || !history[targetIndex]) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.noMessage'), 'info');
      return;
    }

    if (this.pendingRequests.has(targetIndex)) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.updateAlreadyRunning'), 'info');
      return;
    }

    const settings = this.getSettings();
    if (!settings.enabled) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.disabled'), 'info');
      return;
    }

    const connectionProfile = resolveConnectionProfile(this.api, settings.connectionProfile);
    if (!connectionProfile) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.noConnectionProfile'), 'error');
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
        content: this.api.macro.process(resolveWorldMapPrompts(settings).updatePrompt),
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
        targetIndex,
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
        this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.schemaRepair'), 'info');
        const repaired = await this.repairStructuredMapDelta(
          repairMessages,
          'Schema validation error',
          `${generation.parseError}\n\nFix invalid enum values, invalid visual fields, invalid dash strings, additional properties, or other schema errors by using the closest valid schema value or omitting the invalid optional field.`,
          'Repair your previous World Map structured JSON delta. Return the complete corrected delta, not a partial patch. The previous response was schema-invalid and was not applied, so omitting unchanged nodes, routes, or access points would delete the usable map context.',
          settings,
          connectionProfile,
          structuredResponse,
          targetIndex,
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

        this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.qualityRepair'), 'info');
        let repaired = await this.repairStructuredMapDelta(
          repairMessages,
          'Map quality validation issues',
          `${qualityValidationError}\n\n[Current candidate map after all applied deltas]\n${candidateMapJson}\n\nThis is a valid structured delta that needs render-quality fixes. You may return only the corrected nodes, routes, access points, removals, or visual assignments as a delta patch. Keep unchanged map data out of the response if it is not needed for the correction. Areas are embedded inside their owning node; to remove or change areas, resend that node with the corrected complete areas array. Do not put area ids in removeNodeIds because areas are not nodes.`,
          'Repair your previous World Map structured JSON delta. You may return only the corrected nodes, routes, access points, removals, or visual assignments as a delta patch because the previous structured delta has already been applied to a candidate map.',
          settings,
          connectionProfile,
          structuredResponse,
          targetIndex,
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
            targetIndex,
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
        this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.updateFailed'), 'error');
        return;
      }

      const rollback = createRollbackSnapshot(existingMap, appliedDeltas);
      await this.setMap(candidateMap);
      await this.updateMessageExtra(targetIndex, {
        run: { status: 'success', updatedAt: new Date().toISOString() },
        deltas: appliedDeltas,
        rollback,
      });
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.updated'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown world map update error.';
      await this.updateMessageExtra(targetIndex, {
        run: { status: 'error', error: message, updatedAt: new Date().toISOString() },
      });
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.updateFailed'), 'error');
      console.error('World map update failed:', error);
    } finally {
      this.pendingRequests.delete(targetIndex);
    }
  }

  public async smartShuffleMap(mode: WorldMapShuffleMode): Promise<void> {
    const map = this.getMap();
    if (!map) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.worldMap.toasts.noMapYet'), 'info');
      return;
    }
    const shuffledMap = smartShuffleWorldMap(map, mode, `${Date.now()}-${Math.random()}`);
    await this.setMap(shuffledMap);
    const shuffleModeLabels: Record<Exclude<WorldMapShuffleMode, 'all'>, string> = {
      positions: this.api.i18n.t('extensionsBuiltin.worldMap.shuffleModes.positions'),
      paths: this.api.i18n.t('extensionsBuiltin.worldMap.shuffleModes.paths'),
      areas: this.api.i18n.t('extensionsBuiltin.worldMap.shuffleModes.areas'),
      style: this.api.i18n.t('extensionsBuiltin.worldMap.shuffleModes.style'),
    };
    this.api.ui.showToast(
      mode === 'all'
        ? this.api.i18n.t('extensionsBuiltin.worldMap.toasts.shuffled')
        : this.api.i18n.t('extensionsBuiltin.worldMap.toasts.shuffledMode', {
            mode: shuffleModeLabels[mode],
          }),
      'success',
    );
  }

  public async showMap(): Promise<void> {
    await this.api.ui.showPopup({
      title: this.api.i18n.t('extensionsBuiltin.worldMap.title'),
      component: WorldMapPanel,
      componentProps: {
        api: this.api,
        runMapUpdate: (instructions?: string, includeLorebookEntries?: boolean) =>
          this.runMapUpdate(undefined, instructions, includeLorebookEntries),
        smartShuffleMap: (mode: WorldMapShuffleMode) => this.smartShuffleMap(mode),
        removeMap: async () => {
          const { result } = await this.api.ui.showPopup({
            title: this.api.i18n.t('extensionsBuiltin.worldMap.removeWorldMapTitle'),
            content: this.api.i18n.t('extensionsBuiltin.worldMap.removeWorldMapContent'),
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
    if (message.is_user && shouldTrackUser) {
      const index = this.api.chat.getHistory().lastIndexOf(message);
      if (index === -1) return;
      window.setTimeout(() => this.runMapUpdate(index), 200);
    }
  }

  public handleAutoUpdateGenerationFinished(
    result: { message: ChatMessage | null; error?: Error },
    generationId: string,
  ): void {
    const settings = this.getSettings();
    if (!settings.enabled || result.error || settings.autoMode === 'none') return;
    const shouldTrackBot = settings.autoMode === 'responses' || settings.autoMode === 'both';
    const message = result.message;
    if (!shouldTrackBot || !isFinishedAssistantMessage(message)) return;

    const index = findChatMessageIndex(this.api.chat.getHistory(), message, generationId);
    if (index === -1) return;
    window.setTimeout(() => this.runMapUpdate(index), 200);
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
    const hasMap = Boolean(this.getMap());
    this.api.chat.getHistory().forEach((message, index) => this.injectUiForMessage(index, message, hasMap));
    this.injectChatUi(hasMap);
  }

  public injectUiForMessage(
    index: number,
    message = this.api.chat.getHistory()[index],
    hasMap = Boolean(this.getMap()),
  ): void {
    if (!message || this.mountedButtons.has(index)) return;
    const messageEl = document.querySelector(`[data-message-index="${index}"]`);
    const target = messageEl?.querySelector('.message-buttons');
    if (!target) return;

    const mountPoint = document.createElement('div');
    target.insertAdjacentElement('afterbegin', mountPoint);
    const button = this.api.ui.mount(mountPoint, MapMessageButton, {
      message,
      title: hasMap
        ? this.api.i18n.t('extensionsBuiltin.worldMap.updateFromMessage')
        : this.api.i18n.t('extensionsBuiltin.worldMap.createFromMessage'),
      clearTitle: this.api.i18n.t('extensionsBuiltin.worldMap.removeDeltaFromMessage'),
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

  public injectChatUi(hasMap = Boolean(this.getMap())): void {
    this.unregisterChatUiFns.forEach((fn) => fn());
    this.unregisterChatUiFns = [];
    if (!this.api.chat.getChatInfo()) return;

    this.unregisterChatUiFns.push(
      this.api.ui.registerChatQuickAction(
        QUICK_ACTION_GROUP_ID,
        this.api.i18n.t('extensionsBuiltin.worldMap.contextAi'),
        {
          id: 'world-map-open',
          icon: 'fa-solid fa-map-location-dot',
          label: this.api.i18n.t('extensionsBuiltin.worldMap.title'),
          onClick: () => this.showMap(),
        },
      ),
    );
    this.unregisterChatUiFns.push(
      this.api.ui.registerChatFormOptionsMenuItem({
        id: 'world-map-update',
        icon: 'fa-solid fa-map-location-dot',
        label: hasMap
          ? this.api.i18n.t('extensionsBuiltin.worldMap.updateWorldMap')
          : this.api.i18n.t('extensionsBuiltin.worldMap.createWorldMap'),
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
    const hasMap = Boolean(this.getMap());
    this.api.chat.getHistory().forEach((message, index) => this.injectUiForMessage(index, message, hasMap));
    this.injectChatUi(hasMap);
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
    title: api.i18n.t('extensionsBuiltin.worldMap.title'),
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
    api.events.on('generation:finished', (result: { message: ChatMessage | null; error?: Error }, context) => {
      manager.handleAutoUpdateGenerationFinished(result, context.generationId);
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
