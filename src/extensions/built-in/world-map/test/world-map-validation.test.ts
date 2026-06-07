import { describe, expect, it } from 'vitest';
import { applyRollbackSnapshot, createRollbackSnapshot, validateWorldMapDeltaQuality } from '../index';
import { mergeWorldMapDelta } from '../map-utils';
import { DEFAULT_SETTINGS, type WorldMapDelta, type WorldMapDocument, type WorldMapNode } from '../types';

function node(id: string, kind: WorldMapNode['kind'], index: number): WorldMapNode {
  return {
    id,
    name: id,
    kind,
    parentId: 'root',
    bounds: {
      x: index * 80,
      y: 40,
      width: 48,
      height: 48,
    },
  };
}

function createMap(): WorldMapDocument {
  const nodes: Record<string, WorldMapNode> = {
    root: {
      id: 'root',
      name: 'Root',
      kind: 'settlement',
      view: { width: 1200, height: 800, background: '#203040' },
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
    },
  };
  [
    node('admin', 'building', 0),
    node('dorm', 'building', 1),
    node('field', 'landmark', 2),
    node('beach', 'landmark', 3),
    node('room-a', 'room', 4),
    node('room-b', 'room', 5),
    node('training', 'district', 6),
    node('gate', 'poi', 7),
  ].forEach((item) => {
    nodes[item.id] = item;
  });

  return {
    version: 1,
    updatedAt: '2026-06-06T00:00:00.000Z',
    rootNodeId: 'root',
    activeVisualPackId: 'pack',
    nodes,
    connections: [],
    visualPacks: {
      pack: {
        id: 'pack',
        name: 'Pack',
        icons: {
          building: {
            id: 'building',
            label: 'Building',
            fallbackKind: 'building',
            svgSymbol: '<symbol id="building" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></symbol>',
          },
          landmark: {
            id: 'landmark',
            label: 'Landmark',
            fallbackKind: 'landmark',
            svgSymbol: '<symbol id="landmark" viewBox="0 0 24 24"><path d="M12 2 3 21h18z"/></symbol>',
          },
          room: {
            id: 'room',
            label: 'Room',
            fallbackKind: 'room',
            svgSymbol: '<symbol id="room" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/></symbol>',
          },
          district: {
            id: 'district',
            label: 'District',
            fallbackKind: 'district',
            svgSymbol: '<symbol id="district" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></symbol>',
          },
          poi: {
            id: 'poi',
            label: 'POI',
            fallbackKind: 'poi',
            svgSymbol: '<symbol id="poi" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></symbol>',
          },
        },
      },
    },
  };
}

function issueCodesFor(delta: WorldMapDelta, map = createMap()): string[] {
  return validateWorldMapDeltaQuality(map, delta).map((issue) => issue.code);
}

describe('world map quality validation', () => {
  it('counts visualPackDelta node assignments when validating icon coverage', () => {
    const delta: WorldMapDelta = {
      visualPackDelta: {
        packId: 'pack',
        packName: 'Pack',
        assignNodeVisuals: [
          { nodeId: 'root', visual: { iconId: 'district' } },
          { nodeId: 'admin', visual: { iconId: 'building' } },
          { nodeId: 'dorm', visual: { iconId: 'building' } },
          { nodeId: 'field', visual: { iconId: 'landmark' } },
          { nodeId: 'beach', visual: { iconId: 'landmark' } },
          { nodeId: 'room-a', visual: { iconId: 'room' } },
          { nodeId: 'room-b', visual: { iconId: 'room' } },
          { nodeId: 'training', visual: { iconId: 'district' } },
          { nodeId: 'gate', visual: { iconId: 'poi' } },
        ],
      },
    };

    const issueCodes = issueCodesFor(delta);

    expect(issueCodes).not.toContain('insufficient_icon_assignments');
    expect(issueCodes).not.toContain('unused_icon_definition');
    expect(issueCodes).not.toContain('insufficient_kind_icon_assignments');
  });

  it('accepts SVG symbols with matching ids in common quote and spacing formats', () => {
    const delta: WorldMapDelta = {
      visualPackDelta: {
        packId: 'pack',
        packName: 'Pack',
        icons: [
          {
            id: 'double-quote',
            label: 'Double Quote',
            fallbackKind: 'building',
            svgSymbol:
              '<symbol id="double-quote" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></symbol>',
          },
          {
            id: 'single-quote',
            label: 'Single Quote',
            fallbackKind: 'building',
            svgSymbol:
              "<symbol id='single-quote' viewBox='0 0 24 24'><rect x='4' y='4' width='16' height='16'/></symbol>",
          },
          {
            id: 'spaced-id',
            label: 'Spaced Id',
            fallbackKind: 'building',
            svgSymbol:
              '<symbol viewBox="0 0 24 24" id = "spaced-id"><rect x="4" y="4" width="16" height="16"/></symbol>',
          },
        ],
        assignNodeVisuals: [
          { nodeId: 'admin', visual: { iconId: 'double-quote' } },
          { nodeId: 'dorm', visual: { iconId: 'single-quote' } },
          { nodeId: 'training', visual: { iconId: 'spaced-id' } },
        ],
      },
    };

    expect(issueCodesFor(delta)).not.toContain('invalid_svg_symbol_id');
  });

  it('detects SVG symbols that do not expose the icon id', () => {
    const delta: WorldMapDelta = {
      visualPackDelta: {
        packId: 'pack',
        packName: 'Pack',
        icons: [
          {
            id: 'broken',
            label: 'Broken',
            fallbackKind: 'building',
            svgSymbol: '<symbol viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></symbol>',
          },
        ],
        assignNodeVisuals: [{ nodeId: 'admin', visual: { iconId: 'broken' } }],
      },
    };

    expect(issueCodesFor(delta)).toContain('invalid_svg_symbol_id');
  });

  it('normalizes safe raw path icon data into renderer-addressable SVG symbols', () => {
    const map = mergeWorldMapDelta(
      createMap(),
      {
        visualPackDelta: {
          packId: 'pack',
          packName: 'Pack',
          icons: [
            {
              id: 'raw-path',
              label: 'Raw Path',
              fallbackKind: 'building',
              svgSymbol: 'M0,0 L10,0 L10,10 L0,10 Z',
            },
          ],
          assignNodeVisuals: [{ nodeId: 'admin', visual: { iconId: 'raw-path' } }],
        },
      },
      DEFAULT_SETTINGS,
    );

    expect(map.visualPacks?.pack.icons?.['raw-path']?.svgSymbol).toContain('<symbol id="raw-path"');
    expect(map.nodes.admin.visual?.iconId).toBe('raw-path');
    expect(issueCodesFor({}, map)).not.toContain('invalid_svg_symbol_id');
  });

  it('allows quality repair to remove stale unused visual-pack icons', () => {
    const map = createMap();
    map.visualPacks!.pack.icons!.stale = {
      id: 'stale',
      label: 'Stale',
      fallbackKind: 'building',
      svgSymbol: '<symbol id="stale" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></symbol>',
    };

    expect(validateWorldMapDeltaQuality(map, {}).some((issue) => issue.message.includes('"stale"'))).toBe(true);
    expect(
      validateWorldMapDeltaQuality(map, {
        visualPackDelta: {
          packId: 'pack',
          packName: 'Pack',
          removeIconIds: ['stale'],
        },
      }).some((issue) => issue.message.includes('"stale"')),
    ).toBe(false);
  });

  it('removes visual pack assets and clears references to removed visual ids', () => {
    const map = createMap();
    map.visualPacks!.pack.areaStyles = {
      area: { id: 'area', label: 'Area', fill: '#ffffff' },
    };
    map.visualPacks!.pack.connectionStyles = {
      route: { id: 'route', label: 'Route', stroke: '#ffffff' },
    };
    map.visualPacks!.pack.labelStyles = {
      label: { id: 'label', label: 'Label', color: '#ffffff' },
    };
    map.nodes.admin.visual = {
      iconId: 'building',
      areaStyleId: 'area',
      footprintStyleId: 'area',
      labelStyleId: 'label',
    };
    map.nodes.root.areas = [
      {
        id: 'zone',
        kind: 'terrain',
        points: [
          { x: 1, y: 1 },
          { x: 100, y: 1 },
          { x: 1, y: 100 },
        ],
        visual: { areaStyleId: 'area', opacity: 0.5 },
      },
    ];
    map.connections.push({
      id: 'styled',
      fromNodeId: 'admin',
      toNodeId: 'dorm',
      kind: 'path',
      visual: { styleId: 'route' },
    });

    const nextMap = mergeWorldMapDelta(
      map,
      {
        visualPackDelta: {
          packId: 'pack',
          packName: 'Pack',
          removeIconIds: ['building'],
          removeAreaStyleIds: ['area'],
          removeConnectionStyleIds: ['route'],
          removeLabelStyleIds: ['label'],
        },
      },
      DEFAULT_SETTINGS,
    );

    expect(nextMap.visualPacks?.pack.icons?.building).toBeUndefined();
    expect(nextMap.visualPacks?.pack.areaStyles?.area).toBeUndefined();
    expect(nextMap.visualPacks?.pack.connectionStyles?.route).toBeUndefined();
    expect(nextMap.visualPacks?.pack.labelStyles?.label).toBeUndefined();
    expect(nextMap.nodes.admin.visual).toBeUndefined();
    expect(nextMap.nodes.root.areas?.[0].visual?.areaStyleId).toBeUndefined();
    expect(nextMap.connections.find((connection) => connection.id === 'styled')?.visual).toBeUndefined();
  });

  it('restores previous node and connection state from a latest-message rollback snapshot', () => {
    const map = createMap();
    map.nodes.admin.name = 'Admin Building';
    map.nodes.admin.bounds = { x: 0, y: 40, width: 48, height: 48 };
    map.connections.push({
      id: 'admin-dorm',
      fromNodeId: 'admin',
      toNodeId: 'dorm',
      kind: 'path',
      label: 'Old Path',
    });

    const delta: WorldMapDelta = {
      createOrUpdateNodes: [
        {
          ...map.nodes.admin,
          name: 'Administration Tower',
          bounds: { x: 400, y: 400, width: 96, height: 96 },
        },
        {
          id: 'new-floor',
          name: 'New Floor',
          kind: 'floor',
          parentId: 'admin',
          floorIndex: 2,
          bounds: { x: 0, y: 100, width: 200, height: 100 },
        },
      ],
      createOrUpdateConnections: [
        {
          id: 'admin-dorm',
          fromNodeId: 'admin',
          toNodeId: 'dorm',
          kind: 'path',
          label: 'New Path',
        },
      ],
    };

    const rollback = createRollbackSnapshot(map, [delta]);
    const updatedMap = mergeWorldMapDelta(map, delta, DEFAULT_SETTINGS);
    const restoredMap = applyRollbackSnapshot(updatedMap, rollback);

    expect(restoredMap?.nodes.admin.name).toBe('Admin Building');
    expect(restoredMap?.nodes.admin.bounds).toEqual({ x: 0, y: 40, width: 48, height: 48 });
    expect(restoredMap?.nodes['new-floor']).toBeUndefined();
    expect(restoredMap?.connections.find((connection) => connection.id === 'admin-dorm')?.label).toBe('Old Path');
  });

  it('detects enterable parents without a view', () => {
    const map = createMap();
    map.nodes.parent = {
      id: 'parent',
      name: 'Parent',
      kind: 'district',
      parentId: 'root',
      bounds: { x: 700, y: 200, width: 100, height: 100 },
    };
    map.nodes.child = {
      id: 'child',
      name: 'Child',
      kind: 'landmark',
      parentId: 'parent',
      bounds: { x: 20, y: 20, width: 40, height: 40 },
    };

    expect(issueCodesFor({}, map)).toContain('missing_child_view');
  });

  it('detects beach and sand areas typed as water', () => {
    const delta: WorldMapDelta = {
      createOrUpdateNodes: [
        {
          id: 'root',
          name: 'Root',
          kind: 'settlement',
          areas: [
            {
              id: 'beach-cove',
              label: 'Beach Cove',
              kind: 'water',
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
              ],
            },
          ],
        },
      ],
    };

    expect(issueCodesFor(delta)).toContain('beach_area_kind');
  });

  it('detects island maps that use land background plus large water overlays', () => {
    const map = createMap();
    map.nodes.root = {
      id: 'root',
      name: 'Starlight Island',
      kind: 'region',
      subkind: 'island',
      view: { width: 1200, height: 800, background: '#2d5a27' },
      areas: [
        {
          id: 'coastline',
          kind: 'water',
          points: [
            { x: 0, y: 0 },
            { x: 1200, y: 0 },
            { x: 1200, y: 800 },
            { x: 0, y: 800 },
          ],
        },
      ],
    };

    const issueCodes = issueCodesFor({}, map);

    expect(issueCodes).toContain('island_water_background');
    expect(issueCodes).toContain('island_water_area_too_large');
  });

  it('detects clustered child layouts that ignore the parent view scale', () => {
    const map = createMap();
    map.nodes.root.view = { width: 1200, height: 800, background: '#203040' };
    Object.values(map.nodes)
      .filter((node) => node.parentId === 'root')
      .forEach((node, index) => {
        node.bounds = { x: 10 + index * 24, y: 10 + index * 18, width: 20, height: 20 };
      });

    expect(issueCodesFor({}, map)).toContain('underscaled_child_layout');
  });

  it('detects sibling maps with no traversal connections', () => {
    const map = createMap();
    map.connections = [];

    expect(issueCodesFor({}, map)).toContain('disconnected_sibling_map');
  });

  it('allows sibling maps that include at least one traversal connection', () => {
    const map = createMap();
    map.connections = [{ id: 'admin-dorm', fromNodeId: 'admin', toNodeId: 'dorm', kind: 'path' }];

    expect(issueCodesFor({}, map)).not.toContain('disconnected_sibling_map');
  });

  it('detects unused connection styles in the active visual pack', () => {
    const map = createMap();
    map.visualPacks!.pack.connectionStyles = {
      route: { id: 'route', label: 'Route', stroke: '#ffffff' },
    };

    expect(issueCodesFor({}, map)).toContain('unused_connection_style_definition');
  });

  it('detects direct parent-child connections', () => {
    const delta: WorldMapDelta = {
      createOrUpdateConnections: [
        {
          id: 'parent-child',
          fromNodeId: 'root',
          toNodeId: 'admin',
          kind: 'path',
        },
      ],
    };

    expect(issueCodesFor(delta)).toContain('parent_child_connection');
  });

  it('detects stairs that connect rooms across different floors', () => {
    const map = createMap();
    map.nodes.floor1 = {
      id: 'floor1',
      name: 'Floor 1',
      kind: 'floor',
      parentId: 'dorm',
      floorIndex: 1,
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      view: { width: 800, height: 600 },
    };
    map.nodes.floor2 = {
      id: 'floor2',
      name: 'Floor 2',
      kind: 'floor',
      parentId: 'dorm',
      floorIndex: 2,
      bounds: { x: 0, y: 100, width: 200, height: 100 },
      view: { width: 800, height: 600 },
    };
    map.nodes.room1 = {
      id: 'room1',
      name: 'Room 1',
      kind: 'room',
      parentId: 'floor1',
      bounds: { x: 20, y: 20, width: 40, height: 40 },
    };
    map.nodes.room2 = {
      id: 'room2',
      name: 'Room 2',
      kind: 'room',
      parentId: 'floor2',
      bounds: { x: 20, y: 20, width: 40, height: 40 },
    };
    map.connections.push({
      id: 'bad-stairs',
      fromNodeId: 'room1',
      toNodeId: 'room2',
      kind: 'stairs',
    });

    expect(issueCodesFor({}, map)).toContain('cross_floor_room_connection');
  });

  it('allows stairs that connect floor nodes across floors', () => {
    const map = createMap();
    map.nodes.floor1 = {
      id: 'floor1',
      name: 'Floor 1',
      kind: 'floor',
      parentId: 'dorm',
      floorIndex: 1,
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      view: { width: 800, height: 600 },
    };
    map.nodes.floor2 = {
      id: 'floor2',
      name: 'Floor 2',
      kind: 'floor',
      parentId: 'dorm',
      floorIndex: 2,
      bounds: { x: 0, y: 100, width: 200, height: 100 },
      view: { width: 800, height: 600 },
    };
    map.connections.push({
      id: 'good-stairs',
      fromNodeId: 'floor1',
      toNodeId: 'floor2',
      kind: 'stairs',
    });

    expect(issueCodesFor({}, map)).not.toContain('cross_floor_room_connection');
  });

  it('detects visual references to undefined assets', () => {
    const delta: WorldMapDelta = {
      createOrUpdateNodes: [
        {
          id: 'admin',
          name: 'Admin',
          kind: 'building',
          visual: {
            iconId: 'missing-icon',
            areaStyleId: 'missing-area',
            labelStyleId: 'missing-label',
          },
        },
      ],
      createOrUpdateConnections: [
        {
          id: 'conn',
          fromNodeId: 'admin',
          toNodeId: 'dorm',
          kind: 'path',
          visual: { styleId: 'missing-connection' },
        },
      ],
    };

    const issueCodes = issueCodesFor(delta);
    expect(issueCodes).toContain('missing_icon_definition');
    expect(issueCodes).toContain('missing_area_style_definition');
    expect(issueCodes).toContain('missing_label_style_definition');
    expect(issueCodes).toContain('missing_connection_style_definition');
  });

  it('detects undefined visual references already present in the projected map', () => {
    const map = createMap();
    map.nodes.root.visual = {
      iconId: 'missing-island-icon',
      areaStyleId: 'missing-area-style',
      footprintStyleId: 'missing-footprint-style',
      labelStyleId: 'missing-label-style',
    };
    map.nodes.root.areas = [
      {
        id: 'land',
        kind: 'terrain',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        visual: { areaStyleId: 'missing-area-visual-style' },
      },
    ];
    map.connections.push({
      id: 'styled-with-missing-style',
      fromNodeId: 'admin',
      toNodeId: 'dorm',
      kind: 'path',
      visual: { styleId: 'missing-route-style' },
    });

    const issueCodes = issueCodesFor({}, map);

    expect(issueCodes).toContain('missing_icon_definition');
    expect(issueCodes).toContain('missing_area_style_definition');
    expect(issueCodes).toContain('missing_label_style_definition');
    expect(issueCodes).toContain('missing_connection_style_definition');
  });

  it('removes descendant nodes and resets stale roots when deleting a parent node', () => {
    const map = createMap();
    map.rootNodeId = 'admin';
    map.nodes.floor1 = {
      id: 'floor1',
      name: 'Floor 1',
      kind: 'floor',
      parentId: 'admin',
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      view: { width: 800, height: 600 },
    };
    map.nodes.room1 = {
      id: 'room1',
      name: 'Room 1',
      kind: 'room',
      parentId: 'floor1',
      bounds: { x: 20, y: 20, width: 80, height: 70 },
    };
    map.connections.push({ id: 'admin-room', fromNodeId: 'room1', toNodeId: 'dorm', kind: 'path' });

    const nextMap = mergeWorldMapDelta(map, { removeNodeIds: ['admin'] }, DEFAULT_SETTINGS);

    expect(nextMap.nodes.admin).toBeUndefined();
    expect(nextMap.nodes.floor1).toBeUndefined();
    expect(nextMap.nodes.room1).toBeUndefined();
    expect(nextMap.connections.find((connection) => connection.id === 'admin-room')).toBeUndefined();
    expect(nextMap.rootNodeId).not.toBe('admin');
    expect(nextMap.rootNodeId && nextMap.nodes[nextMap.rootNodeId]).toBeTruthy();
  });

  it('rolls back cascaded descendant removals and affected connections', () => {
    const map = createMap();
    map.nodes.floor1 = {
      id: 'floor1',
      name: 'Floor 1',
      kind: 'floor',
      parentId: 'admin',
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      view: { width: 800, height: 600 },
    };
    map.nodes.room1 = {
      id: 'room1',
      name: 'Room 1',
      kind: 'room',
      parentId: 'floor1',
      bounds: { x: 20, y: 20, width: 80, height: 70 },
    };
    map.connections.push({ id: 'admin-room', fromNodeId: 'room1', toNodeId: 'dorm', kind: 'path' });

    const delta: WorldMapDelta = { removeNodeIds: ['admin'] };
    const rollback = createRollbackSnapshot(map, [delta]);
    const updatedMap = mergeWorldMapDelta(map, delta, DEFAULT_SETTINGS);
    const restoredMap = applyRollbackSnapshot(updatedMap, rollback);

    expect(restoredMap?.nodes.admin).toBeDefined();
    expect(restoredMap?.nodes.floor1).toBeDefined();
    expect(restoredMap?.nodes.room1).toBeDefined();
    expect(restoredMap?.connections.find((connection) => connection.id === 'admin-room')).toBeDefined();
  });
});
