import { cloneJson } from '../_shared/data-utils';
import { collectNodeIdsWithDescendants } from './map-utils';
import type { WorldMapDelta, WorldMapDocument, WorldMapRollbackSnapshot } from './types';

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
