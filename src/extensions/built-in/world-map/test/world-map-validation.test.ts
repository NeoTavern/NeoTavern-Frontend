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
    routes: [],
    accessPoints: [],
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

function addCampusRoute(map: WorldMapDocument): void {
  map.routes.push({
    id: 'campus-route',
    parentId: 'root',
    kind: 'path',
    points: [
      { x: 24, y: 64 },
      { x: 320, y: 64 },
    ],
    visual: { styleId: 'route' },
  });
  map.accessPoints.push(
    { id: 'admin-access', routeId: 'campus-route', nodeId: 'admin', point: { x: 24, y: 64 } },
    { id: 'dorm-access', routeId: 'campus-route', nodeId: 'dorm', point: { x: 104, y: 64 } },
    { id: 'field-access', routeId: 'campus-route', nodeId: 'field', point: { x: 184, y: 64 } },
    { id: 'beach-access', routeId: 'campus-route', nodeId: 'beach', point: { x: 264, y: 64 } },
    { id: 'room-a-access', routeId: 'campus-route', nodeId: 'room-a', point: { x: 344, y: 64 } },
    { id: 'room-b-access', routeId: 'campus-route', nodeId: 'room-b', point: { x: 424, y: 64 } },
    { id: 'training-access', routeId: 'campus-route', nodeId: 'training', point: { x: 504, y: 64 } },
    { id: 'gate-access', routeId: 'campus-route', nodeId: 'gate', point: { x: 584, y: 64 } },
  );
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

  it('removes visual pack assets and clears references to removed visual ids', () => {
    const map = createMap();
    map.visualPacks!.pack.areaStyles = {
      area: { id: 'area', label: 'Area', fill: '#ffffff' },
    };
    map.visualPacks!.pack.routeStyles = {
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
    addCampusRoute(map);

    const nextMap = mergeWorldMapDelta(
      map,
      {
        visualPackDelta: {
          packId: 'pack',
          packName: 'Pack',
          removeIconIds: ['building'],
          removeAreaStyleIds: ['area'],
          removeRouteStyleIds: ['route'],
          removeLabelStyleIds: ['label'],
        },
      },
      DEFAULT_SETTINGS,
    );

    expect(nextMap.visualPacks?.pack.icons?.building).toBeUndefined();
    expect(nextMap.visualPacks?.pack.areaStyles?.area).toBeUndefined();
    expect(nextMap.visualPacks?.pack.routeStyles?.route).toBeUndefined();
    expect(nextMap.visualPacks?.pack.labelStyles?.label).toBeUndefined();
    expect(nextMap.nodes.admin.visual).toBeUndefined();
    expect(nextMap.nodes.root.areas?.[0].visual?.areaStyleId).toBeUndefined();
    expect(nextMap.routes.find((route) => route.id === 'campus-route')?.visual).toBeUndefined();
  });

  it('restores previous node, route, and access point state from a rollback snapshot', () => {
    const map = createMap();
    map.nodes.admin.name = 'Admin Building';
    map.nodes.admin.bounds = { x: 0, y: 40, width: 48, height: 48 };
    addCampusRoute(map);

    const delta: WorldMapDelta = {
      createOrUpdateNodes: [
        {
          ...map.nodes.admin,
          name: 'Administration Tower',
          bounds: { x: 400, y: 400, width: 96, height: 96 },
        },
      ],
      createOrUpdateRoutes: [
        {
          id: 'campus-route',
          parentId: 'root',
          kind: 'path',
          label: 'New Path',
          points: [
            { x: 20, y: 20 },
            { x: 300, y: 20 },
          ],
        },
      ],
      createOrUpdateAccessPoints: [
        {
          id: 'admin-access',
          routeId: 'campus-route',
          nodeId: 'admin',
          point: { x: 20, y: 20 },
        },
      ],
    };

    const rollback = createRollbackSnapshot(map, [delta]);
    const updatedMap = mergeWorldMapDelta(map, delta, DEFAULT_SETTINGS);
    const restoredMap = applyRollbackSnapshot(updatedMap, rollback);

    expect(restoredMap?.nodes.admin.name).toBe('Admin Building');
    expect(restoredMap?.nodes.admin.bounds).toEqual({ x: 0, y: 40, width: 48, height: 48 });
    expect(restoredMap?.routes.find((route) => route.id === 'campus-route')?.label).toBeUndefined();
    expect(restoredMap?.accessPoints.find((access) => access.id === 'admin-access')?.point).toEqual({ x: 24, y: 64 });
  });

  it('detects sibling maps with no shared route network', () => {
    const map = createMap();

    expect(issueCodesFor({}, map)).toContain('disconnected_sibling_map');
  });

  it('allows sibling maps that include at least one shared route network', () => {
    const map = createMap();
    addCampusRoute(map);

    expect(issueCodesFor({}, map)).not.toContain('disconnected_sibling_map');
    expect(issueCodesFor({}, map)).not.toContain('incomplete_sibling_route_access');
  });

  it('detects renderable siblings left unattached by an otherwise shared route network', () => {
    const map = createMap();
    map.routes.push({
      id: 'campus-route',
      parentId: 'root',
      kind: 'path',
      points: [
        { x: 24, y: 64 },
        { x: 320, y: 64 },
      ],
    });
    map.accessPoints.push(
      { id: 'admin-access', routeId: 'campus-route', nodeId: 'admin', point: { x: 24, y: 64 } },
      { id: 'dorm-access', routeId: 'campus-route', nodeId: 'dorm', point: { x: 104, y: 64 } },
    );

    const issueCodes = issueCodesFor({}, map);
    expect(issueCodes).not.toContain('disconnected_sibling_map');
    expect(issueCodes).toContain('incomplete_sibling_route_access');
  });

  it('ignores redundant access point parentId values from model output during merge', () => {
    const map = createMap();
    map.routes.push({
      id: 'campus-route',
      parentId: 'root',
      kind: 'path',
      points: [
        { x: 24, y: 64 },
        { x: 320, y: 64 },
      ],
    });

    const delta = {
      createOrUpdateAccessPoints: [
        {
          id: 'admin-access',
          parentId: 'admin',
          routeId: 'campus-route',
          nodeId: 'admin',
          point: { x: 24, y: 64 },
        },
        {
          id: 'dorm-access',
          parentId: 'dorm',
          routeId: 'campus-route',
          nodeId: 'dorm',
          point: { x: 104, y: 64 },
        },
      ],
    } as unknown as WorldMapDelta;

    const nextMap = mergeWorldMapDelta(map, delta, DEFAULT_SETTINGS);

    expect(nextMap.accessPoints.map((access) => access.id)).toEqual(['admin-access', 'dorm-access']);
    expect(issueCodesFor({}, nextMap)).not.toContain('disconnected_sibling_map');
  });

  it('detects destination-named routes with no access points', () => {
    const map = createMap();
    map.routes.push({
      id: 'path-to-fields',
      parentId: 'root',
      kind: 'path',
      label: 'Path to Athletic Fields',
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
    });

    expect(issueCodesFor({}, map)).toContain('unattached_named_route');
  });

  it('detects areas that extend outside their owning view', () => {
    const map = createMap();
    map.nodes.root.areas = [
      {
        id: 'oversized-zone',
        kind: 'interior',
        points: [
          { x: 0, y: 0 },
          { x: 1200, y: 0 },
          { x: 1200, y: 900 },
          { x: 0, y: 900 },
        ],
      },
    ];

    expect(issueCodesFor({}, map)).toContain('area_outside_view');
  });

  it('detects direct room children under buildings that describe floors as areas', () => {
    const map = createMap();
    map.nodes.admin.view = { width: 900, height: 650, background: '#20252b' };
    map.nodes.admin.areas = [
      {
        id: 'admin-ground-floor',
        label: 'Ground Floor',
        kind: 'interior',
        points: [
          { x: 0, y: 0 },
          { x: 800, y: 0 },
          { x: 800, y: 160 },
          { x: 0, y: 160 },
        ],
      },
    ];
    map.nodes.cafeteria = {
      id: 'cafeteria',
      name: 'Cafeteria',
      kind: 'room',
      parentId: 'admin',
      bounds: { x: 100, y: 80, width: 200, height: 80 },
    };
    map.nodes.pantry = {
      id: 'pantry',
      name: 'Pantry',
      kind: 'room',
      parentId: 'admin',
      bounds: { x: 320, y: 80, width: 80, height: 60 },
    };

    expect(issueCodesFor({}, map)).toContain('rooms_need_floor_parent');
  });

  it('detects unused route styles in the active visual pack', () => {
    const map = createMap();
    map.visualPacks!.pack.routeStyles = {
      route: { id: 'route', label: 'Route', stroke: '#ffffff' },
    };

    expect(issueCodesFor({}, map)).toContain('unused_route_style_definition');
  });

  it('detects invalid access points', () => {
    const delta: WorldMapDelta = {
      createOrUpdateAccessPoints: [
        {
          id: 'bad-access',
          routeId: 'missing-route',
          nodeId: 'admin',
          point: { x: 10, y: 10 },
        },
      ],
    };

    expect(issueCodesFor(delta)).toContain('invalid_access_point');
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
      createOrUpdateRoutes: [
        {
          id: 'route-with-missing-style',
          parentId: 'root',
          kind: 'path',
          points: [
            { x: 10, y: 10 },
            { x: 80, y: 80 },
          ],
          visual: { styleId: 'missing-route' },
        },
      ],
    };

    const issueCodes = issueCodesFor(delta);
    expect(issueCodes).toContain('missing_icon_definition');
    expect(issueCodes).toContain('missing_area_style_definition');
    expect(issueCodes).toContain('missing_label_style_definition');
    expect(issueCodes).toContain('missing_route_style_definition');
  });

  it('removes descendant nodes and affected route access points when deleting a parent node', () => {
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
    map.routes.push({
      id: 'room-route',
      parentId: 'root',
      kind: 'path',
      points: [
        { x: 20, y: 20 },
        { x: 200, y: 20 },
      ],
    });
    map.accessPoints.push(
      { id: 'room-access', routeId: 'room-route', nodeId: 'room1', point: { x: 20, y: 20 } },
      { id: 'dorm-access', routeId: 'room-route', nodeId: 'dorm', point: { x: 200, y: 20 } },
    );

    const nextMap = mergeWorldMapDelta(map, { removeNodeIds: ['admin'] }, DEFAULT_SETTINGS);

    expect(nextMap.nodes.admin).toBeUndefined();
    expect(nextMap.nodes.floor1).toBeUndefined();
    expect(nextMap.nodes.room1).toBeUndefined();
    expect(nextMap.accessPoints.find((access) => access.id === 'room-access')).toBeUndefined();
    expect(nextMap.routes.find((route) => route.id === 'room-route')).toBeDefined();
    expect(nextMap.rootNodeId).not.toBe('admin');
    expect(nextMap.rootNodeId && nextMap.nodes[nextMap.rootNodeId]).toBeTruthy();
  });

  it('rolls back cascaded descendant removals and affected access points', () => {
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
    map.routes.push({
      id: 'room-route',
      parentId: 'root',
      kind: 'path',
      points: [
        { x: 20, y: 20 },
        { x: 200, y: 20 },
      ],
    });
    map.accessPoints.push({
      id: 'room-access',
      routeId: 'room-route',
      nodeId: 'room1',
      point: { x: 20, y: 20 },
    });

    const delta: WorldMapDelta = { removeNodeIds: ['admin'] };
    const rollback = createRollbackSnapshot(map, [delta]);
    const updatedMap = mergeWorldMapDelta(map, delta, DEFAULT_SETTINGS);
    const restoredMap = applyRollbackSnapshot(updatedMap, rollback);

    expect(restoredMap?.nodes.admin).toBeDefined();
    expect(restoredMap?.nodes.floor1).toBeDefined();
    expect(restoredMap?.nodes.room1).toBeDefined();
    expect(restoredMap?.accessPoints.find((access) => access.id === 'room-access')).toBeDefined();
  });
});
