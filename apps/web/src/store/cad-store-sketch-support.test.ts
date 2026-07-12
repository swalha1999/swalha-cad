import type { CadDocumentV2, SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { createCadStore, selectActiveSketch } from './cad-store.js';

const IDENTITY = { rotationDeg: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };

/** A document with one box (planar faces) and one cylinder (a curved side face) to exercise support validity. */
function documentWithSolids(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    features: [],
    entities: [
      { id: 'box', name: 'Box', primitive: { kind: 'box', width: 40, height: 40, depth: 40 }, transform: { translation: [0, 0, 0], ...IDENTITY }, visible: true },
      { id: 'cyl', name: 'Cylinder', primitive: { kind: 'cylinder', radius: 15, height: 40, segments: 24 }, transform: { translation: [80, 0, 0], ...IDENTITY }, visible: true },
    ],
  };
}

type Store = ReturnType<typeof createCadStore>;

function store(document = documentWithSolids()): Store {
  let n = 0;
  return createCadStore(document, { createId: () => `gen-${++n}` });
}

describe('cad-store fresh startup is demo-free', () => {
  it('starts with no bodies and no features', () => {
    const state = createCadStore().getState();
    expect(state.document.entities).toEqual([]);
    expect(state.document.features).toEqual([]);
  });

  it('starts with no selection, no support command, and a perspective camera', () => {
    const state = createCadStore().getState();
    expect(state.selectedEntityId).toBeNull();
    expect(state.selectedFeatureId).toBeNull();
    expect(state.selectedPlane).toBeNull();
    expect(state.sketchSupport).toBeNull();
    expect(state.sketch).toBeNull();
    expect(state.cameraProjection).toBe('perspective');
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
  });

  it('is deterministic across instances (identical startup document)', () => {
    expect(createCadStore().getState().document).toEqual(createCadStore().getState().document);
  });
});

describe('cad-store startSketch — command state', () => {
  it('opens the nonblocking support-selection command with an empty collector instead of an XY sketch', () => {
    const s = store(documentWithSolids());
    const outcome = s.getState().startSketch();
    expect(outcome).toMatchObject({ entered: false, reason: 'command' });
    const state = s.getState();
    expect(state.sketchSupport).not.toBeNull();
    expect(state.sketchSupport!.support).toBeNull();
    expect(state.sketchSupport!.draftName).toBe('Sketch 1');
    // Crucially: no sketch was created and no XY sketch silently chosen.
    expect(state.sketch).toBeNull();
    expect(state.document.features).toHaveLength(0);
  });

  it('creation stays blocked until a support is chosen: confirming an empty collector is rejected', () => {
    const s = store();
    s.getState().startSketch();
    const outcome = s.getState().confirmSketchSupport();
    expect(outcome).toMatchObject({ entered: false, reason: 'no-support' });
    expect(outcome.message).toMatch(/select a sketch plane/i);
    expect(s.getState().sketchSupport!.error).toMatch(/select a sketch plane/i);
    expect(s.getState().sketch).toBeNull();
  });

  it('choosing an origin plane populates the collector and highlights it', () => {
    const s = store();
    s.getState().startSketch();
    s.getState().chooseSketchPlane('XZ');
    expect(s.getState().sketchSupport!.support).toEqual({ kind: 'plane', plane: 'XZ' });
    expect(s.getState().sketchSupport!.error).toBeNull();
  });

  it('choosing a planar face populates the collector', () => {
    const s = store();
    s.getState().startSketch();
    s.getState().chooseSketchFace({ bodyId: 'box', faceId: '+z' });
    expect(s.getState().sketchSupport!.support).toEqual({ kind: 'face', face: { bodyId: 'box', faceId: '+z' } });
  });

  it('confirming a chosen plane creates and enters the sketch', () => {
    const s = store();
    s.getState().startSketch();
    s.getState().chooseSketchPlane('XZ');
    const outcome = s.getState().confirmSketchSupport();
    expect(outcome.entered).toBe(true);
    const state = s.getState();
    expect(state.sketchSupport).toBeNull();
    expect(state.sketch).not.toBeNull();
    expect(state.sketch!.plane).toBe('XZ');
    expect(state.cameraProjection).toBe('orthographic');
    expect(state.document.features).toHaveLength(1);
  });

  it('confirming a chosen planar face enters a face-supported sketch', () => {
    const s = store();
    s.getState().startSketch();
    s.getState().chooseSketchFace({ bodyId: 'box', faceId: '+z' });
    const outcome = s.getState().confirmSketchSupport();
    expect(outcome.entered).toBe(true);
    const sketch = selectActiveSketch(s.getState()) as SketchFeature;
    expect(sketch.face).toEqual({ bodyId: 'box', faceId: '+z' });
  });

  it('rejects a curved face with a concise diagnostic and keeps the collector active', () => {
    const s = store();
    s.getState().startSketch();
    s.getState().chooseSketchFace({ bodyId: 'cyl', faceId: 'side' });
    const state = s.getState();
    expect(state.sketchSupport).not.toBeNull();
    expect(state.sketchSupport!.support).toBeNull();
    expect(state.sketchSupport!.error).toMatch(/curved|flat/i);
    expect(state.sketch).toBeNull();
  });

  it('does not silently mutate the document while the command is open', () => {
    const s = store();
    const before = s.getState().document;
    s.getState().startSketch();
    s.getState().chooseSketchPlane('XY');
    s.getState().chooseSketchFace({ bodyId: 'box', faceId: '+z' });
    expect(s.getState().document).toBe(before);
    expect(s.getState().canUndo).toBe(false);
  });
});

describe('cad-store startSketch — preselection path', () => {
  it('preselected plane then Sketch enters immediately (no command)', () => {
    const s = store();
    s.getState().selectPlane('YZ');
    expect(s.getState().selectedPlane).toBe('YZ');
    const outcome = s.getState().startSketch();
    expect(outcome.entered).toBe(true);
    expect(s.getState().sketchSupport).toBeNull();
    expect(s.getState().sketch!.plane).toBe('YZ');
  });

  it('preselected planar face then Sketch enters immediately (no command)', () => {
    const s = store();
    s.getState().selectFace({ bodyId: 'box', faceId: '+z' });
    const outcome = s.getState().startSketch();
    expect(outcome.entered).toBe(true);
    const sketch = selectActiveSketch(s.getState()) as SketchFeature;
    expect(sketch.face).toEqual({ bodyId: 'box', faceId: '+z' });
  });

  it('selecting a plane is mutually exclusive with body selection', () => {
    const s = store();
    s.getState().selectEntity('box');
    s.getState().selectPlane('XY');
    expect(s.getState().selectedEntityId).toBeNull();
    expect(s.getState().selectedPlane).toBe('XY');
    s.getState().selectEntity('box');
    expect(s.getState().selectedPlane).toBeNull();
  });
});

describe('cad-store sketch support — cancel and neutrality', () => {
  it('cancel removes the command and restores the prior selection without mutation', () => {
    const s = store();
    s.getState().selectEntity('box');
    s.getState().startSketch(); // opens the command (a body selection is not a support)
    expect(s.getState().sketchSupport).not.toBeNull();
    s.getState().chooseSketchPlane('XY');
    const before = s.getState().document;
    s.getState().cancelSketchSupport();
    const state = s.getState();
    expect(state.sketchSupport).toBeNull();
    expect(state.sketch).toBeNull();
    expect(state.selectedEntityId).toBe('box'); // prior selection restored
    expect(state.document).toBe(before);
    expect(state.canUndo).toBe(false);
  });

  it('is busy while sketching and never opens a nested command', () => {
    const s = store();
    s.getState().startSketch();
    s.getState().chooseSketchPlane('XY');
    s.getState().confirmSketchSupport();
    expect(s.getState().sketch).not.toBeNull();
    const outcome = s.getState().startSketch();
    expect(outcome.reason).toBe('busy');
  });

  it('entering a sketch through the command leaves undo history with exactly one entry', () => {
    const s = store();
    s.getState().startSketch();
    s.getState().chooseSketchPlane('XY');
    s.getState().confirmSketchSupport();
    expect(s.getState().canUndo).toBe(true);
    s.getState().undo();
    expect(s.getState().document.features).toHaveLength(0);
    expect(s.getState().canUndo).toBe(false);
  });
});
