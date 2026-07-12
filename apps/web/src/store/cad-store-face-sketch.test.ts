import type { CadDocumentV2, SketchFeature } from '@swalha-cad/document';
import { evaluateDocument } from '@swalha-cad/geometry';
import { describe, expect, it } from 'vitest';
import { createCadStore } from './cad-store.js';
import { selectActiveSketch } from './cad-store.js';

const IDENTITY = { rotationDeg: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };

function documentWithSolids(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    features: [],
    entities: [
      {
        id: 'box',
        name: 'Box',
        primitive: { kind: 'box', width: 40, height: 40, depth: 40 },
        transform: { translation: [0, 0, 0], ...IDENTITY },
        visible: true,
      },
      {
        id: 'cyl',
        name: 'Cylinder',
        primitive: { kind: 'cylinder', radius: 15, height: 40, segments: 24 },
        transform: { translation: [80, 0, 0], ...IDENTITY },
        visible: true,
      },
    ],
  };
}

type Store = ReturnType<typeof createCadStore>;

function store(): Store {
  let n = 0;
  return createCadStore(documentWithSolids(), { createId: () => `gen-${++n}` });
}

describe('cad-store face sketching — entry', () => {
  it('enters a sketch on a planar box face and stores the face support', () => {
    const s = store();
    const outcome = s.getState().enterSketchOnFace({ bodyId: 'box', faceId: '+z' });
    expect(outcome.entered).toBe(true);
    const state = s.getState();
    expect(state.sketch).not.toBeNull();
    expect(state.cameraProjection).toBe('orthographic');
    const sketch = selectActiveSketch(state) as SketchFeature;
    expect(sketch.face).toEqual({ bodyId: 'box', faceId: '+z' });
    expect(sketch.plane).toBe('XY'); // +z face → nearest principal plane
  });

  it('stores the nearest principal plane as an orientation hint per face', () => {
    expect(selectActiveSketch(entered('+x'))!.plane).toBe('YZ');
    expect(selectActiveSketch(entered('-y'))!.plane).toBe('XZ');
    expect(selectActiveSketch(entered('-z'))!.plane).toBe('XY');
  });

  function entered(faceId: string) {
    const s = store();
    s.getState().enterSketchOnFace({ bodyId: 'box', faceId });
    return s.getState();
  }

  it('preselect workflow: selecting a face then Sketch enters directly', () => {
    const s = store();
    s.getState().selectFace({ bodyId: 'box', faceId: '+z' });
    expect(s.getState().selectedFace).toEqual({ bodyId: 'box', faceId: '+z' });
    expect(s.getState().selectedEntityId).toBe('box'); // cross-selected the owning body
    const outcome = s.getState().startFaceSketch();
    expect(outcome.entered).toBe(true);
    expect(s.getState().sketch).not.toBeNull();
    expect(s.getState().faceSketchArmed).toBe(false);
  });

  it('command-then-face workflow: Sketch with no preselection arms, then a face click enters', () => {
    const s = store();
    const outcome = s.getState().startFaceSketch();
    expect(outcome.entered).toBe(false);
    expect(s.getState().faceSketchArmed).toBe(true);
    expect(s.getState().sketch).toBeNull();

    s.getState().enterSketchOnFace({ bodyId: 'box', faceId: '+z' });
    expect(s.getState().sketch).not.toBeNull();
    expect(s.getState().faceSketchArmed).toBe(false);
  });
});

describe('cad-store face sketching — diagnostics', () => {
  it('rejects a curved face with a not-planar diagnostic and no mutation', () => {
    const s = store();
    const before = s.getState().document;
    const outcome = s.getState().enterSketchOnFace({ bodyId: 'cyl', faceId: 'side' });
    expect(outcome).toMatchObject({ entered: false, reason: 'not-planar' });
    expect(outcome.message).toMatch(/curved|flat/i);
    expect(s.getState().sketch).toBeNull();
    expect(s.getState().document).toBe(before);
    expect(s.getState().faceSketchError).toBe(outcome.message);
  });

  it('rejects an unknown face reference', () => {
    const outcome = store().getState().enterSketchOnFace({ bodyId: 'box', faceId: 'side:ghost' });
    expect(outcome.reason).toBe('unknown');
    expect(outcome.entered).toBe(false);
  });

  it('refuses to start a face sketch while already sketching (busy)', () => {
    const s = store();
    s.getState().enterSketchOnFace({ bodyId: 'box', faceId: '+z' });
    const outcome = s.getState().enterSketchOnFace({ bodyId: 'box', faceId: '-z' });
    expect(outcome.reason).toBe('busy');
  });

  it('dismisses the face-sketch error on request', () => {
    const s = store();
    s.getState().enterSketchOnFace({ bodyId: 'cyl', faceId: 'side' });
    expect(s.getState().faceSketchError).not.toBeNull();
    s.getState().dismissFaceSketchError();
    expect(s.getState().faceSketchError).toBeNull();
  });
});

describe('cad-store face sketching — lifecycle', () => {
  it('undo removes the face sketch feature; redo restores it with its face support', () => {
    const s = store();
    s.getState().enterSketchOnFace({ bodyId: 'box', faceId: '+z' });
    s.getState().finishSketch();
    expect(s.getState().document.features).toHaveLength(1);

    s.getState().undo();
    expect(s.getState().document.features).toHaveLength(0);

    s.getState().redo();
    const restored = s.getState().document.features[0] as SketchFeature;
    expect(restored.face).toEqual({ bodyId: 'box', faceId: '+z' });
  });

  it('finishing a face sketch restores the perspective camera and clears face state', () => {
    const s = store();
    s.getState().selectFace({ bodyId: 'box', faceId: '+z' });
    s.getState().enterSketchOnFace({ bodyId: 'box', faceId: '+z' });
    s.getState().finishSketch();
    const state = s.getState();
    expect(state.cameraProjection).toBe('perspective');
    expect(state.selectedFace).toBeNull();
    expect(state.faceSketchArmed).toBe(false);
  });

  it('clears a selected/hovered face whose owning body is deleted', () => {
    const s = store();
    s.getState().setHoveredFace({ bodyId: 'box', faceId: '+z' });
    s.getState().selectFace({ bodyId: 'box', faceId: '+z' });
    s.getState().requestDelete({ kind: 'entity', id: 'box' });
    expect(s.getState().selectedFace).toBeNull();
    expect(s.getState().hoveredFace).toBeNull();
  });

  it('produces a correctly located downstream solid on the selected face', () => {
    // Manually author what the entry + drawing + extrude produce, then evaluate:
    // a 10×10 sketch on the box +z face swept +5 lives just above z=20.
    const doc: CadDocumentV2 = {
      schemaVersion: 2,
      units: 'mm',
      entities: documentWithSolids().entities,
      features: [
        {
          id: 'fs',
          kind: 'sketch',
          name: 'Sketch 1',
          plane: 'XY',
          face: { bodyId: 'box', faceId: '+z' },
          entities: [
            { id: 'q0', kind: 'point', x: -5, y: -5, construction: false },
            { id: 'q1', kind: 'point', x: 5, y: -5, construction: false },
            { id: 'q2', kind: 'point', x: 5, y: 5, construction: false },
            { id: 'q3', kind: 'point', x: -5, y: 5, construction: false },
            { id: 'e0', kind: 'line', startId: 'q0', endId: 'q1', construction: false },
            { id: 'e1', kind: 'line', startId: 'q1', endId: 'q2', construction: false },
            { id: 'e2', kind: 'line', startId: 'q2', endId: 'q3', construction: false },
            { id: 'e3', kind: 'line', startId: 'q3', endId: 'q0', construction: false },
          ],
          constraints: [],
          visible: true,
        },
        { id: 'fx', kind: 'extrude', name: 'Extrude 1', sketchId: 'fs', depth: 5, direction: 'normal', visible: true },
      ],
    };
    const s = createCadStore(doc, { createId: () => 'x' });
    const evaluated = evaluateDocument(s.getState().document);
    expect(evaluated.diagnostics).toEqual([]);
    const body = evaluated.bodies.find((b) => b.id === 'fx')!;
    if (body.geometry.kind !== 'mesh') throw new Error('expected mesh');
    const zs: number[] = [];
    for (let i = 0; i < body.geometry.mesh.positions.length; i += 3) zs.push(body.geometry.mesh.positions[i + 2]!);
    expect(Math.min(...zs)).toBeCloseTo(20, 5);
    expect(Math.max(...zs)).toBeCloseTo(25, 5);
  });
});
