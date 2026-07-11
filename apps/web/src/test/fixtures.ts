import type { CadDocumentV2 } from '@swalha-cad/document';

export function buildTestDocument(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    features: [],
    entities: [
      {
        id: 'box-1',
        name: 'Box',
        primitive: { kind: 'box', width: 40, height: 30, depth: 20 },
        transform: { translation: [-60, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      },
      {
        id: 'cylinder-1',
        name: 'Cylinder',
        primitive: { kind: 'cylinder', radius: 15, height: 40, segments: 32 },
        transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      },
      {
        id: 'bracket-1',
        name: 'L-Bracket',
        primitive: { kind: 'lBracket', width: 50, height: 50, depth: 20, thickness: 8 },
        transform: { translation: [60, 0, 15], rotationDeg: [0, 45, 0], scale: [1, 1, 1] },
        visible: true,
      },
    ],
  };
}
