import type {
  WorldMapArea,
  WorldMapAreaStyleDefinition,
  WorldMapConnection,
  WorldMapConnectionStyleDefinition,
  WorldMapDelta,
  WorldMapDocument,
  WorldMapIconDefinition,
  WorldMapLabelStyleDefinition,
  WorldMapNode,
  WorldMapSettings,
  WorldMapVisualPack,
} from './types';

const ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,80}$/;
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9,.\s]+\)|[a-zA-Z]{3,24})$/;
const SAFE_RAW_PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9,.\s+-]{1,2000}$/;
const SAFE_SVG_TAGS = new Set(['symbol', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon']);
const SAFE_SVG_ATTRS = new Set([
  'id',
  'viewBox',
  'd',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'rx',
  'ry',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
]);
const ALLOWED_CONNECTION_KINDS = new Set<string>([
  'road',
  'path',
  'corridor',
  'door',
  'stairs',
  'elevator',
  'portal',
  'adjacent',
  'unknown',
]);

export function createEmptyMap(): WorldMapDocument {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: {},
    connections: [],
  };
}

export function getMapFromMetadata(metadata?: { extra?: Record<string, unknown> } | null): WorldMapDocument | null {
  const value = metadata?.extra?.['core.world-map'];
  if (!value || typeof value !== 'object') return null;
  const map = (value as { map?: WorldMapDocument }).map;
  if (!map || typeof map !== 'object' || !map.nodes || !Array.isArray(map.connections)) return null;
  return map;
}

function sortNodesForPrompt(first: WorldMapNode, second: WorldMapNode): number {
  const firstFloor = typeof first.floorIndex === 'number' ? first.floorIndex : Number.POSITIVE_INFINITY;
  const secondFloor = typeof second.floorIndex === 'number' ? second.floorIndex : Number.POSITIVE_INFINITY;
  if (firstFloor !== secondFloor) return firstFloor - secondFloor;
  if (first.kind !== second.kind) return first.kind.localeCompare(second.kind);
  return first.name.localeCompare(second.name);
}

function getPromptNodeLabel(node: WorldMapNode): string {
  const details: string[] = [node.kind];
  if (node.subkind) details.push(node.subkind);
  if (node.kind === 'floor' && typeof node.floorIndex === 'number') details.push(`floor ${node.floorIndex}`);
  return `${node.name} (${details.join(', ')})`;
}

function getPromptAreaLabel(area: WorldMapArea): string | null {
  const label = area.label?.trim();
  if (label && area.kind) return `${label} (${area.kind})`;
  if (label) return label;
  return area.kind ?? null;
}

export function serializeWorldMapForPrompt(map: WorldMapDocument): string {
  const nodes = Object.values(map.nodes);
  if (nodes.length === 0) return '';

  const childrenByParent = new Map<string, WorldMapNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  for (const children of childrenByParent.values()) children.sort(sortNodesForPrompt);

  const rootNode = map.rootNodeId ? map.nodes[map.rootNodeId] : undefined;
  const topLevelNodes = rootNode
    ? [rootNode]
    : nodes.filter((node) => !node.parentId || !map.nodes[node.parentId]).sort(sortNodesForPrompt);
  const visited = new Set<string>();
  const lines: string[] = [
    '[World Map Context]',
    'Use this as helpful but potentially incomplete map context for stable locations, hierarchy, and traversal.',
    'The map may omit places, contain outdated details, or have wrong structure. Prefer current chat and lore when they clearly contradict it.',
    '',
    'Locations:',
  ];

  const appendNode = (node: WorldMapNode, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const indent = '  '.repeat(depth);
    lines.push(`${indent}- ${getPromptNodeLabel(node)}`);

    const areaLabels = (node.areas ?? []).map(getPromptAreaLabel).filter((label): label is string => Boolean(label));
    if (areaLabels.length > 0) lines.push(`${indent}  features: ${areaLabels.join(', ')}`);

    for (const child of childrenByParent.get(node.id) ?? []) appendNode(child, depth + 1);
  };

  for (const node of topLevelNodes) appendNode(node, 0);
  const orphanedNodes = nodes.filter((node) => !visited.has(node.id)).sort(sortNodesForPrompt);
  if (orphanedNodes.length > 0) {
    lines.push('', 'Other mapped locations:');
    for (const node of orphanedNodes) appendNode(node, 0);
  }

  const connectionLines = map.connections
    .map((connection) => {
      const from = map.nodes[connection.fromNodeId];
      const to = map.nodes[connection.toNodeId];
      if (!from || !to) return null;
      const label = connection.label ? `, ${connection.label}` : '';
      const direction = connection.bidirectional === false ? 'one-way' : 'two-way';
      return `- ${from.name} to ${to.name}: ${connection.kind}${label}, ${direction}`;
    })
    .filter((line): line is string => Boolean(line));

  if (connectionLines.length > 0) lines.push('', 'Connections:', ...connectionLines);

  return lines.join('\n');
}

export function validateId(id: string | undefined): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function sanitizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return SAFE_COLOR.test(value) ? value : undefined;
}

export function sanitizeSvgSymbol(svg: string | undefined, iconId?: string, maxLength = 4000): string | undefined {
  if (!svg || svg.length > maxLength) return undefined;
  const trimmedSvg = svg.trim();
  if (!trimmedSvg) return undefined;
  if (!trimmedSvg.includes('<')) {
    if (!iconId || !validateId(iconId) || !SAFE_RAW_PATH_DATA.test(trimmedSvg)) return undefined;
    return `<symbol id="${iconId}" viewBox="0 0 24 24"><path d="${trimmedSvg}"/></symbol>`;
  }
  if (/<(?:script|foreignObject|image|use|style|animate|set)\b/i.test(svg)) return undefined;
  if (/\son[a-z]+\s*=|href\s*=|xlink:href\s*=|url\s*\(/i.test(svg)) return undefined;

  const tagMatches = svg.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g);
  let hasSymbol = false;
  for (const match of tagMatches) {
    const tagName = match[1];
    const attributes = match[2] ?? '';
    if (!SAFE_SVG_TAGS.has(tagName)) return undefined;
    if (tagName === 'symbol') hasSymbol = true;

    for (const attr of attributes.matchAll(/\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=/g)) {
      if (!SAFE_SVG_ATTRS.has(attr[1])) return undefined;
    }
  }

  return hasSymbol ? svg : undefined;
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function getViewSizeDefaults(kind: WorldMapNode['kind']): { width: number; height: number } {
  if (kind === 'building') return { width: 900, height: 650 };
  if (kind === 'floor') return { width: 800, height: 600 };
  if (kind === 'world' || kind === 'region' || kind === 'settlement' || kind === 'district') {
    return { width: 1200, height: 800 };
  }
  return { width: 600, height: 400 };
}

function sanitizeNode(node: WorldMapNode): WorldMapNode | null {
  if (!validateId(node.id) || typeof node.name !== 'string' || !node.name.trim()) return null;
  const next: WorldMapNode = {
    id: node.id,
    name: node.name.trim().slice(0, 120),
    kind: node.kind,
  };
  if (node.subkind) next.subkind = node.subkind.slice(0, 80);
  if (validateId(node.parentId)) next.parentId = node.parentId;
  if (typeof node.floorIndex === 'number') next.floorIndex = Math.round(node.floorIndex);
  if (node.bounds) {
    next.bounds = {
      x: clampNumber(node.bounds.x, 0, -100000, 100000),
      y: clampNumber(node.bounds.y, 0, -100000, 100000),
      width: clampNumber(node.bounds.width, 80, 8, 100000),
      height: clampNumber(node.bounds.height, 60, 8, 100000),
    };
  }
  if (node.view) {
    const viewDefaults = getViewSizeDefaults(node.kind);
    next.view = {
      width: clampNumber(node.view.width, viewDefaults.width, viewDefaults.width, 100000),
      height: clampNumber(node.view.height, viewDefaults.height, viewDefaults.height, 100000),
      background: sanitizeColor(node.view.background),
    };
  }
  if (Array.isArray(node.areas)) {
    next.areas = node.areas
      .map(sanitizeArea)
      .filter((area): area is WorldMapArea => area !== null)
      .slice(0, 40);
  }
  if (node.visual) next.visual = { ...node.visual };
  return next;
}

function sanitizeArea(area: WorldMapArea): WorldMapArea | null {
  if (!validateId(area.id) || !Array.isArray(area.points) || area.points.length < 3) return null;
  return {
    id: area.id,
    label: area.label?.slice(0, 120),
    kind: area.kind,
    points: area.points.slice(0, 40).map((point) => ({
      x: clampNumber(point.x, 0, -100000, 100000),
      y: clampNumber(point.y, 0, -100000, 100000),
    })),
    visual: area.visual
      ? {
          areaStyleId: validateId(area.visual.areaStyleId) ? area.visual.areaStyleId : undefined,
          fill: sanitizeColor(area.visual.fill),
          stroke: sanitizeColor(area.visual.stroke),
          opacity: clampNumber(area.visual.opacity, 0.4, 0.05, 1),
        }
      : undefined,
  };
}

function sanitizeConnection(connection: WorldMapConnection): WorldMapConnection | null {
  if (!validateId(connection.id) || !validateId(connection.fromNodeId) || !validateId(connection.toNodeId)) return null;
  if (!ALLOWED_CONNECTION_KINDS.has((connection as { kind: string }).kind)) return null;
  const next: WorldMapConnection = {
    id: connection.id,
    fromNodeId: connection.fromNodeId,
    toNodeId: connection.toNodeId,
    kind: connection.kind,
  };
  if (connection.label) next.label = connection.label.slice(0, 120);
  if (typeof connection.bidirectional === 'boolean') next.bidirectional = connection.bidirectional;
  if (typeof connection.smoothPath === 'boolean') next.smoothPath = connection.smoothPath;
  if (Array.isArray(connection.points) && connection.points.length >= 2) {
    next.points = connection.points.slice(0, 12).map((point) => ({
      x: clampNumber(point.x, 0, -100000, 100000),
      y: clampNumber(point.y, 0, -100000, 100000),
    }));
  }
  if (connection.visual) next.visual = { ...connection.visual };
  return next;
}

function isDirectParentChildConnection(connection: WorldMapConnection, nodes: Record<string, WorldMapNode>): boolean {
  const from = nodes[connection.fromNodeId];
  const to = nodes[connection.toNodeId];
  return Boolean(from && to && (from.parentId === to.id || to.parentId === from.id));
}

function collectNodeIdsWithDescendants(nodes: Record<string, WorldMapNode>, nodeIds: Set<string>): Set<string> {
  const ids = new Set(nodeIds);
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

function addVisualPackAsset<T extends { id: string }>(
  target: Record<string, T>,
  assets: T[] | undefined,
  maxAssets: number,
  normalize: (asset: T) => T | null,
): void {
  for (const asset of (assets ?? []).slice(0, maxAssets)) {
    if (!validateId(asset.id)) continue;
    const normalized = normalize(asset);
    if (normalized) target[normalized.id] = normalized;
  }
}

function removeVisualPackAssets<T>(target: Record<string, T>, ids: string[] | undefined): Set<string> {
  const removedIds = new Set<string>();
  for (const id of ids ?? []) {
    if (!validateId(id)) continue;
    delete target[id];
    removedIds.add(id);
  }
  return removedIds;
}

function clearRemovedVisualRefs(
  map: WorldMapDocument,
  removed: {
    iconIds: Set<string>;
    areaStyleIds: Set<string>;
    connectionStyleIds: Set<string>;
    labelStyleIds: Set<string>;
  },
): void {
  for (const node of Object.values(map.nodes)) {
    if (node.visual) {
      const nextVisual = { ...node.visual };
      if (nextVisual.iconId && removed.iconIds.has(nextVisual.iconId)) delete nextVisual.iconId;
      if (nextVisual.areaStyleId && removed.areaStyleIds.has(nextVisual.areaStyleId)) delete nextVisual.areaStyleId;
      if (nextVisual.footprintStyleId && removed.areaStyleIds.has(nextVisual.footprintStyleId)) {
        delete nextVisual.footprintStyleId;
      }
      if (nextVisual.labelStyleId && removed.labelStyleIds.has(nextVisual.labelStyleId)) delete nextVisual.labelStyleId;
      node.visual = Object.keys(nextVisual).length > 0 ? nextVisual : undefined;
    }

    if (node.areas) {
      node.areas = node.areas.map((area) => {
        if (!area.visual?.areaStyleId || !removed.areaStyleIds.has(area.visual.areaStyleId)) return area;
        const visual = { ...area.visual };
        delete visual.areaStyleId;
        return { ...area, visual: Object.keys(visual).length > 0 ? visual : undefined };
      });
    }
  }

  for (const connection of map.connections) {
    if (connection.visual?.styleId && removed.connectionStyleIds.has(connection.visual.styleId)) {
      connection.visual = undefined;
    }
  }
}

function normalizeIcon(icon: WorldMapIconDefinition): WorldMapIconDefinition | null {
  return {
    ...icon,
    label: icon.label?.slice(0, 80) || icon.id,
    color: sanitizeColor(icon.color),
    svgSymbol: sanitizeSvgSymbol(icon.svgSymbol, icon.id),
  };
}

function normalizeAreaStyle(style: WorldMapAreaStyleDefinition): WorldMapAreaStyleDefinition | null {
  return {
    ...style,
    label: style.label?.slice(0, 80) || style.id,
    fill: sanitizeColor(style.fill),
    stroke: sanitizeColor(style.stroke),
    opacity: clampNumber(style.opacity, 1, 0.05, 1),
  };
}

function normalizeConnectionStyle(style: WorldMapConnectionStyleDefinition): WorldMapConnectionStyleDefinition | null {
  return {
    ...style,
    label: style.label?.slice(0, 80) || style.id,
    stroke: sanitizeColor(style.stroke),
    width: clampNumber(style.width, 3, 1, 18),
    dash: typeof style.dash === 'string' && /^[0-9\s.]{1,40}$/.test(style.dash) ? style.dash : undefined,
  };
}

function normalizeLabelStyle(style: WorldMapLabelStyleDefinition): WorldMapLabelStyleDefinition | null {
  return {
    ...style,
    label: style.label?.slice(0, 80) || style.id,
    color: sanitizeColor(style.color),
    background: sanitizeColor(style.background),
  };
}

function mergeVisualPack(map: WorldMapDocument, delta: WorldMapDelta, settings: WorldMapSettings): void {
  const visualDelta = delta.visualPackDelta;
  if (!visualDelta || !validateId(visualDelta.packId)) return;

  const visualPacks = { ...(map.visualPacks ?? {}) };
  const pack: WorldMapVisualPack = {
    ...(visualPacks[visualDelta.packId] ?? { id: visualDelta.packId, name: visualDelta.packName }),
    id: visualDelta.packId,
    name: visualDelta.packName?.slice(0, 80) || visualDelta.packId,
    icons: { ...(visualPacks[visualDelta.packId]?.icons ?? {}) },
    areaStyles: { ...(visualPacks[visualDelta.packId]?.areaStyles ?? {}) },
    connectionStyles: { ...(visualPacks[visualDelta.packId]?.connectionStyles ?? {}) },
    labelStyles: { ...(visualPacks[visualDelta.packId]?.labelStyles ?? {}) },
  };

  const removed = {
    iconIds: removeVisualPackAssets(pack.icons!, visualDelta.removeIconIds),
    areaStyleIds: removeVisualPackAssets(pack.areaStyles!, visualDelta.removeAreaStyleIds),
    connectionStyleIds: removeVisualPackAssets(pack.connectionStyles!, visualDelta.removeConnectionStyleIds),
    labelStyleIds: removeVisualPackAssets(pack.labelStyles!, visualDelta.removeLabelStyleIds),
  };

  addVisualPackAsset(pack.icons!, visualDelta.icons, settings.maxVisualAssetsPerDelta, normalizeIcon);
  addVisualPackAsset(pack.areaStyles!, visualDelta.areaStyles, settings.maxVisualAssetsPerDelta, normalizeAreaStyle);
  addVisualPackAsset(
    pack.connectionStyles!,
    visualDelta.connectionStyles,
    settings.maxVisualAssetsPerDelta,
    normalizeConnectionStyle,
  );
  addVisualPackAsset(pack.labelStyles!, visualDelta.labelStyles, settings.maxVisualAssetsPerDelta, normalizeLabelStyle);

  visualPacks[pack.id] = pack;
  map.visualPacks = visualPacks;
  map.activeVisualPackId = pack.id;

  for (const assignment of visualDelta.assignNodeVisuals ?? []) {
    if (validateId(assignment.nodeId) && map.nodes[assignment.nodeId]) {
      map.nodes[assignment.nodeId] = { ...map.nodes[assignment.nodeId], visual: { ...assignment.visual } };
    }
  }

  for (const assignment of visualDelta.assignConnectionVisuals ?? []) {
    const connection = map.connections.find((item) => item.id === assignment.connectionId);
    if (connection) connection.visual = { ...assignment.visual };
  }

  clearRemovedVisualRefs(map, removed);
}

export function mergeWorldMapDelta(
  current: WorldMapDocument | null | undefined,
  delta: WorldMapDelta,
  settings: WorldMapSettings,
): WorldMapDocument {
  const map: WorldMapDocument = current
    ? {
        ...current,
        nodes: { ...current.nodes },
        connections: [...current.connections],
        visualPacks: current.visualPacks ? { ...current.visualPacks } : undefined,
      }
    : createEmptyMap();

  for (const node of (delta.createOrUpdateNodes ?? []).slice(0, settings.maxNodesPerDelta)) {
    const sanitized = sanitizeNode(node);
    if (sanitized) {
      map.nodes[sanitized.id] = { ...map.nodes[sanitized.id], ...sanitized };
    }
  }

  const removeNodeIds = collectNodeIdsWithDescendants(
    map.nodes,
    new Set((delta.removeNodeIds ?? []).filter(validateId)),
  );
  for (const nodeId of removeNodeIds) delete map.nodes[nodeId];
  map.connections = map.connections.filter(
    (connection) => !removeNodeIds.has(connection.fromNodeId) && !removeNodeIds.has(connection.toNodeId),
  );
  map.connections = map.connections.filter((connection) => !isDirectParentChildConnection(connection, map.nodes));

  const removeConnectionIds = new Set((delta.removeConnectionIds ?? []).filter(validateId));
  map.connections = map.connections.filter((connection) => !removeConnectionIds.has(connection.id));

  for (const connection of (delta.createOrUpdateConnections ?? []).slice(0, settings.maxConnectionsPerDelta)) {
    const sanitized = sanitizeConnection(connection);
    if (!sanitized || !map.nodes[sanitized.fromNodeId] || !map.nodes[sanitized.toNodeId]) continue;
    if (isDirectParentChildConnection(sanitized, map.nodes)) continue;
    const index = map.connections.findIndex((item) => item.id === sanitized.id);
    if (index === -1) map.connections.push(sanitized);
    else map.connections[index] = { ...map.connections[index], ...sanitized };
  }

  if (validateId(delta.rootNodeId) && map.nodes[delta.rootNodeId]) {
    map.rootNodeId = delta.rootNodeId;
  } else if (!map.rootNodeId || !map.nodes[map.rootNodeId]) {
    map.rootNodeId = Object.values(map.nodes).find((node) => !node.parentId)?.id;
  }

  mergeVisualPack(map, delta, settings);
  map.updatedAt = new Date().toISOString();
  return map;
}
