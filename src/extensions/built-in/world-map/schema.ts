import type { StructuredResponseOptions } from '../../../types/generation';
import { createStructuredResponse } from '../_shared/runtime/structured-request-format';
import type { WorldMapSettings } from './types';

export function getWorldMapStructuredResponse(
  format: WorldMapSettings['structuredRequestFormat'],
): StructuredResponseOptions {
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
