import type { ExtensionAPI } from '../../../types';

export type WorldMapNodeKind =
  | 'world'
  | 'region'
  | 'settlement'
  | 'district'
  | 'building'
  | 'floor'
  | 'room'
  | 'landmark'
  | 'poi';

export type WorldMapConnectionKind =
  | 'road'
  | 'path'
  | 'corridor'
  | 'door'
  | 'stairs'
  | 'elevator'
  | 'portal'
  | 'adjacent'
  | 'unknown';

export interface WorldMapPoint {
  x: number;
  y: number;
}

export interface WorldMapBounds extends WorldMapPoint {
  width: number;
  height: number;
}

export interface WorldMapNodeVisualRef {
  iconId?: string;
  areaStyleId?: string;
  footprintStyleId?: string;
  labelStyleId?: string;
}

export interface WorldMapConnectionVisualRef {
  styleId?: string;
}

export interface WorldMapNode {
  id: string;
  name: string;
  kind: WorldMapNodeKind;
  subkind?: string;
  parentId?: string;
  floorIndex?: number;
  bounds?: WorldMapBounds;
  view?: {
    width: number;
    height: number;
    background?: string;
  };
  areas?: WorldMapArea[];
  visual?: WorldMapNodeVisualRef;
}

export interface WorldMapArea {
  id: string;
  label?: string;
  kind?: 'terrain' | 'water' | 'woods' | 'garden' | 'courtyard' | 'field' | 'cliff' | 'interior' | 'other';
  points: WorldMapPoint[];
  visual?: {
    areaStyleId?: string;
    fill?: string;
    stroke?: string;
    opacity?: number;
  };
}

export interface WorldMapConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: WorldMapConnectionKind;
  label?: string;
  bidirectional?: boolean;
  points?: WorldMapPoint[];
  visual?: WorldMapConnectionVisualRef;
}

export interface WorldMapIconDefinition {
  id: string;
  label: string;
  svgSymbol?: string;
  fallbackKind?: WorldMapNodeKind;
  color?: string;
}

export interface WorldMapAreaStyleDefinition {
  id: string;
  label: string;
  fill?: string;
  stroke?: string;
  pattern?: 'solid' | 'grid' | 'dots' | 'diagonal' | 'water' | 'grass' | 'stone';
  opacity?: number;
}

export interface WorldMapConnectionStyleDefinition {
  id: string;
  label: string;
  stroke?: string;
  width?: number;
  dash?: string;
  linecap?: 'butt' | 'round' | 'square';
}

export interface WorldMapLabelStyleDefinition {
  id: string;
  label: string;
  color?: string;
  background?: string;
}

export interface WorldMapVisualPack {
  id: string;
  name: string;
  icons?: Record<string, WorldMapIconDefinition>;
  areaStyles?: Record<string, WorldMapAreaStyleDefinition>;
  connectionStyles?: Record<string, WorldMapConnectionStyleDefinition>;
  labelStyles?: Record<string, WorldMapLabelStyleDefinition>;
}

export interface WorldMapDocument {
  version: 1;
  updatedAt: string;
  rootNodeId?: string;
  activeVisualPackId?: string;
  nodes: Record<string, WorldMapNode>;
  connections: WorldMapConnection[];
  visualPacks?: Record<string, WorldMapVisualPack>;
}

export interface WorldMapVisualPackDelta {
  packId: string;
  packName: string;
  removeIconIds?: string[];
  removeAreaStyleIds?: string[];
  removeConnectionStyleIds?: string[];
  removeLabelStyleIds?: string[];
  icons?: WorldMapIconDefinition[];
  areaStyles?: WorldMapAreaStyleDefinition[];
  connectionStyles?: WorldMapConnectionStyleDefinition[];
  labelStyles?: WorldMapLabelStyleDefinition[];
  assignNodeVisuals?: Array<{ nodeId: string; visual: WorldMapNodeVisualRef }>;
  assignConnectionVisuals?: Array<{ connectionId: string; visual: WorldMapConnectionVisualRef }>;
}

export interface WorldMapDelta {
  rootNodeId?: string;
  createOrUpdateNodes?: WorldMapNode[];
  removeNodeIds?: string[];
  createOrUpdateConnections?: WorldMapConnection[];
  removeConnectionIds?: string[];
  visualPackDelta?: WorldMapVisualPackDelta;
}

export interface WorldMapVisualPackRollback {
  existed: boolean;
  name?: string;
  icons?: Record<string, WorldMapIconDefinition | null>;
  areaStyles?: Record<string, WorldMapAreaStyleDefinition | null>;
  connectionStyles?: Record<string, WorldMapConnectionStyleDefinition | null>;
  labelStyles?: Record<string, WorldMapLabelStyleDefinition | null>;
}

export interface WorldMapRollbackSnapshot {
  rootNodeId?: string | null;
  activeVisualPackId?: string | null;
  nodes?: Record<string, WorldMapNode | null>;
  connections?: Record<string, WorldMapConnection | null>;
  visualPacks?: Record<string, WorldMapVisualPackRollback>;
}

export interface WorldMapRunState {
  status: 'idle' | 'pending' | 'success' | 'error';
  error?: string;
  updatedAt?: string;
}

export interface WorldMapChatExtraData {
  map?: WorldMapDocument;
}

export interface WorldMapMessageExtraData {
  run?: WorldMapRunState;
  deltas?: WorldMapDelta[];
  rollback?: WorldMapRollbackSnapshot;
}

export interface WorldMapChatExtra {
  'core.world-map'?: WorldMapChatExtraData;
}

export interface WorldMapMessageExtra {
  'core.world-map'?: WorldMapMessageExtraData;
}

export interface WorldMapSettings {
  enabled: boolean;
  autoMode: 'none' | 'responses' | 'inputs' | 'both';
  connectionProfile: string;
  structuredRequestFormat: 'native' | 'json' | 'xml';
  maxResponseTokens: number;
  includeLastXMessages: number;
  includeActiveLorebookEntriesOnCreate: boolean;
  maxNodesPerDelta: number;
  maxConnectionsPerDelta: number;
  maxVisualAssetsPerDelta: number;
  updatePrompt: string;
}

export type WorldMapExtensionAPI = ExtensionAPI<WorldMapSettings, WorldMapChatExtra, WorldMapMessageExtra>;

export const WORLD_MAP_UPDATED_EVENT = 'world-map:updated';

export const DEFAULT_UPDATE_PROMPT = `You are a World Map Cartographer for an AI roleplay chat.

Create or update a structured map from the recent chat context. Return only the requested structured JSON delta.

Rules:
- Build stable map topology only: worlds, regions, settlements, districts, buildings, floors, rooms, landmarks, points of interest, and traversal connections.
- Do not track character positions or highly dynamic state.
- Do not create social/person relationship edges. Connections are physical/topological map relationships only.
- Treat existing map data as useful saved state, not perfect canon. It may be incomplete, outdated, or partly wrong. Preserve valid existing ids and topology where possible, but correct clear mistakes and add missing stable locations from current chat/lore context.
- Prefer a small, useful delta. Do not rewrite the whole map unless the existing map is empty or clearly wrong.
- Choose rootNodeId as the most useful playable map scope. Do not create generic roots such as "Earth" unless the chat actually has multiple world-scale regions.
- Use parentId for sub-maps. A building may contain floors; floors may contain rooms; towns may contain buildings and landmarks.
- Do not nest rooms or child nodes inside a node property such as "rooms" or "children". Every location must be its own node in createOrUpdateNodes with parentId.
- Use bounds for renderable placement. Coordinates are local to the parent view. Keep values in the parent view's coordinate space.
- Add view width/height for nodes that have children. Use generous local coordinate spaces: roughly 1200x800 for regions/campuses, 900x650 for buildings, and 800x600 for floors. Floor views should stay spacious even when the floor's bounds inside the parent building are a small strip. Do not create tiny 150x100 interior maps.
- view.background must be a valid CSS color such as "#20252b", "rgb(32,37,43)", "seagreen", or "darkslategray". Do not put style names like "ocean" or "campus-ground" in background.
- Use node.areas for stable non-location shapes such as island landmass, woods, cliffs, beach, parks, courtyards, fields, gardens, walls, or large interior zones.
- area.kind must be one of the schema values. Do not use "room" as an area kind; create a room node when the room needs its own identity.
- Use the view background for the broad surrounding material such as ocean, sky, void, ground, or wall color. Do not create multiple full-view overlapping areas. Areas should be smaller or irregular polygons that sit inside the view. For island/coastal maps, use an ocean/water background and draw the landmass as an irregular terrain polygon inside it; do not draw a full-view water area over land. Beaches are terrain areas, not water areas.
- Use connection.points with at least two points for curved or routed roads/paths/corridors. Omit points if no route is known; do not send an empty points array.
- Stairs and elevators between floors should connect floor nodes or explicit stair/elevator nodes, not unrelated rooms on different floors.
- Sibling nodes in the same parent view should not share identical bounds or heavily overlap. Buildings, landmarks, districts, regions, floors, and rooms all need distinct renderable footprints. Floor nodes under the same building can use stacked strips; rooms should use a floor-plan layout.
- Keep room parentage consistent. If a room is on a specific floor, create that floor node and parent the room to it.
- Do not create connections for parent-child hierarchy. parentId already represents containment. Do not create adjacent/path/corridor edges from a room to its own floor, from a floor to its own building, or from a child to its direct parent.
- For non-trivial maps, include visualPackDelta with chat-specific icons, area styles, connection styles, and label styles.
- Define icons for important visible location categories in this chat, such as major regions, settlements, buildings, landmarks, points of interest, floors, and notable rooms.
- Custom visual-pack icons should include safe svgSymbol snippets when the icon is intended to look custom. Use simple <symbol> SVG with paths/shapes only. The <symbol> tag must include id exactly equal to the icon id, for example: <symbol id="icon-library" viewBox="0 0 24 24">...</symbol>.
- Assign visual.iconId to important visible nodes. Do not leave all nodes on renderer fallback icons when the map has many locations.
- Prefer defining only icons and styles that are assigned. During repair, use removeIconIds, removeAreaStyleIds, removeConnectionStyleIds, or removeLabelStyleIds to delete stale visual assets.
- If the visual pack defines a floor or room icon, assign it to important floor or room nodes instead of leaving those nodes unassigned.
- Visual pack node assignments must use { "nodeId": "...", "visual": { "iconId": "..." } }.
- Visual pack connection assignments must use { "connectionId": "...", "visual": { "styleId": "..." } }.
- Connection styles must use "stroke" for line color. Do not use "color".
- For solid lines, omit "dash". For dashed or dotted lines, use numeric SVG dash strings with spaces such as "8 6" or "2 5". Do not use commas.

Existing map data and recent chat messages are already in context.`;

export const DEFAULT_SETTINGS: WorldMapSettings = {
  enabled: true,
  autoMode: 'none',
  connectionProfile: '',
  structuredRequestFormat: 'native',
  maxResponseTokens: 16384,
  includeLastXMessages: -1,
  includeActiveLorebookEntriesOnCreate: true,
  maxNodesPerDelta: 240,
  maxConnectionsPerDelta: 360,
  maxVisualAssetsPerDelta: 90,
  updatePrompt: DEFAULT_UPDATE_PROMPT,
};
