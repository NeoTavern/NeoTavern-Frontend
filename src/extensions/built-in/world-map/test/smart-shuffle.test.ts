import { describe, expect, it } from 'vitest';
import { smartShuffleWorldMap } from '../smart-shuffle';
import type { WorldMapDocument } from '../types';

function createMap(): WorldMapDocument {
  return {
    version: 1,
    updatedAt: '2026-06-07T00:00:00.000Z',
    rootNodeId: 'root',
    activeVisualPackId: 'pack',
    nodes: {
      root: {
        id: 'root',
        name: 'Root',
        kind: 'settlement',
        view: { width: 1200, height: 800, background: '#223344' },
      },
      admin: {
        id: 'admin',
        name: 'Admin',
        kind: 'building',
        parentId: 'root',
        bounds: { x: 100, y: 100, width: 180, height: 140 },
      },
      dorm: {
        id: 'dorm',
        name: 'Dorm',
        kind: 'building',
        parentId: 'root',
        bounds: { x: 120, y: 120, width: 180, height: 140 },
      },
      field: {
        id: 'field',
        name: 'Field',
        kind: 'landmark',
        parentId: 'root',
        bounds: { x: 160, y: 140, width: 170, height: 130 },
      },
      dorm_floor_3: {
        id: 'dorm_floor_3',
        name: 'Third Floor',
        kind: 'floor',
        parentId: 'dorm',
        floorIndex: 3,
        bounds: { x: 0, y: 0, width: 200, height: 160 },
      },
      dorm_floor_4: {
        id: 'dorm_floor_4',
        name: 'Fourth Floor',
        kind: 'floor',
        parentId: 'dorm',
        floorIndex: 4,
        bounds: { x: 0, y: 0, width: 200, height: 160 },
      },
    },
    connections: [
      { id: 'admin-field', fromNodeId: 'admin', toNodeId: 'field', kind: 'path' },
      { id: 'floors', fromNodeId: 'dorm_floor_3', toNodeId: 'dorm_floor_4', kind: 'stairs' },
    ],
    visualPacks: {
      pack: {
        id: 'pack',
        name: 'Pack',
        icons: { building: { id: 'building', label: 'Building', fallbackKind: 'building', color: '#808080' } },
        areaStyles: { land: { id: 'land', label: 'Land', fill: '#445533', opacity: 0.5 } },
        connectionStyles: { path: { id: 'path', label: 'Path', stroke: '#776655', width: 3 } },
        labelStyles: {},
      },
    },
  };
}

function overlaps(
  first: NonNullable<WorldMapDocument['nodes'][string]['bounds']>,
  second: NonNullable<WorldMapDocument['nodes'][string]['bounds']>,
): boolean {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

function hasAdjacentDuplicatePoints(points: Array<{ x: number; y: number }> | undefined): boolean {
  return (points ?? []).some(
    (point, index, list) => index > 0 && point.x === list[index - 1].x && point.y === list[index - 1].y,
  );
}

describe('smartShuffleWorldMap', () => {
  it('separates overlapping sibling positions and stacks floors', () => {
    const map = smartShuffleWorldMap(createMap(), 'positions', 'seed');

    expect(overlaps(map.nodes.admin.bounds!, map.nodes.dorm.bounds!)).toBe(false);
    expect(map.nodes.dorm_floor_3.bounds!.y).toBeLessThan(map.nodes.dorm_floor_4.bounds!.y);
    expect(overlaps(map.nodes.dorm_floor_3.bounds!, map.nodes.dorm_floor_4.bounds!)).toBe(false);
  });

  it('regenerates routed connection points for visible sibling connections', () => {
    const source = createMap();
    source.nodes.admin.bounds = { x: 100, y: 100, width: 120, height: 100 };
    source.nodes.field.bounds = { x: 760, y: 500, width: 120, height: 100 };
    const map = smartShuffleWorldMap(source, 'paths', 'seed');
    const connection = map.connections.find((item) => item.id === 'admin-field');

    expect(connection?.points?.length).toBeGreaterThanOrEqual(2);
    expect(connection?.smoothPath === true || connection?.smoothPath === undefined).toBe(true);
  });

  it('clears routed points for connections across different parent views', () => {
    const source = createMap();
    source.connections.push({
      id: 'cross-parent',
      fromNodeId: 'admin',
      toNodeId: 'dorm_floor_3',
      kind: 'stairs',
      points: [
        { x: 220, y: 180 },
        { x: 260, y: 220 },
      ],
    });

    const map = smartShuffleWorldMap(source, 'paths', 'seed');
    const connection = map.connections.find((item) => item.id === 'cross-parent');

    expect(connection?.points).toBeUndefined();
    expect(connection?.smoothPath).toBeUndefined();
  });

  it('deconflicts duplicate sibling routes instead of stacking identical paths', () => {
    const source = createMap();
    source.nodes.admin.bounds = { x: 100, y: 100, width: 120, height: 100 };
    source.nodes.field.bounds = { x: 760, y: 500, width: 120, height: 100 };
    source.connections.push({ id: 'admin-field-alt', fromNodeId: 'admin', toNodeId: 'field', kind: 'road' });

    const map = smartShuffleWorldMap(source, 'paths', 'seed');
    const first = map.connections.find((connection) => connection.id === 'admin-field')?.points;
    const second = map.connections.find((connection) => connection.id === 'admin-field-alt')?.points;
    const stairs = map.connections.find((connection) => connection.id === 'floors');

    expect(second?.length).toBeGreaterThanOrEqual(2);
    expect(second).not.toEqual(first);
    expect(hasAdjacentDuplicatePoints(first)).toBe(false);
    expect(hasAdjacentDuplicatePoints(second)).toBe(false);
    expect(stairs?.smoothPath).toBeUndefined();
  });

  it('adds organic points to rectangular non-water areas', () => {
    const source = createMap();
    source.nodes.root.areas = [
      {
        id: 'land',
        kind: 'terrain',
        points: [
          { x: 100, y: 100 },
          { x: 500, y: 100 },
          { x: 500, y: 400 },
          { x: 100, y: 400 },
        ],
      },
    ];

    const map = smartShuffleWorldMap(source, 'areas', 'seed');

    expect(map.nodes.root.areas?.[0].points.length).toBeGreaterThan(4);
  });

  it('updates visual style assets without changing topology', () => {
    const source = createMap();
    const map = smartShuffleWorldMap(source, 'style', 'seed');

    expect(map.visualPacks?.pack.icons?.building.color).not.toBe(source.visualPacks?.pack.icons?.building.color);
    expect(map.visualPacks?.pack.areaStyles?.land.fill).not.toBe(source.visualPacks?.pack.areaStyles?.land.fill);
    expect(map.visualPacks?.pack.connectionStyles?.path.width).toBeLessThanOrEqual(5.5);
    expect(Object.keys(map.nodes)).toEqual(Object.keys(source.nodes));
    expect(map.connections.map((connection) => connection.id)).toEqual(
      source.connections.map((connection) => connection.id),
    );
  });

  it('creates visible style assignments for maps without an existing visual pack', () => {
    const source = createMap();
    delete source.activeVisualPackId;
    delete source.visualPacks;

    const map = smartShuffleWorldMap(source, 'style', 'seed');

    expect(map.activeVisualPackId).toBe('smart_shuffle');
    expect(map.nodes.admin.visual?.iconId).toBe('smart_building');
    expect(map.connections.find((connection) => connection.id === 'admin-field')?.visual?.styleId).toBe('smart_path');
    expect(map.visualPacks?.smart_shuffle?.icons?.smart_building.color).toBeDefined();
  });

  it('moves already separated sibling layouts by a visible amount', () => {
    const source = createMap();
    source.nodes.admin.bounds = { x: 100, y: 100, width: 120, height: 100 };
    source.nodes.dorm.bounds = { x: 440, y: 160, width: 120, height: 100 };
    source.nodes.field.bounds = { x: 720, y: 420, width: 120, height: 100 };

    const map = smartShuffleWorldMap(source, 'positions', 'visible-change');
    const movedDistance = Math.hypot(
      map.nodes.admin.bounds!.x - source.nodes.admin.bounds!.x,
      map.nodes.admin.bounds!.y - source.nodes.admin.bounds!.y,
    );

    expect(movedDistance).toBeGreaterThan(25);
  });

  it('rebuilds room layouts instead of only nudging room positions', () => {
    const source = createMap();
    source.nodes.room_a = {
      id: 'room_a',
      name: 'Room A',
      kind: 'room',
      parentId: 'dorm_floor_4',
      bounds: { x: 10, y: 10, width: 60, height: 40 },
    };
    source.nodes.room_b = {
      id: 'room_b',
      name: 'Room B',
      kind: 'room',
      parentId: 'dorm_floor_4',
      bounds: { x: 20, y: 20, width: 60, height: 40 },
    };

    const map = smartShuffleWorldMap(source, 'positions', 'room-layout');

    expect(overlaps(map.nodes.room_a.bounds!, map.nodes.room_b.bounds!)).toBe(false);
    expect(Math.abs(map.nodes.room_a.bounds!.x - source.nodes.room_a.bounds!.x)).toBeGreaterThan(20);
  });
});
