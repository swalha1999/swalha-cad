import { describe, expect, it } from 'vitest';
import { planDeletion } from './dependencies.js';
import type { CadDocumentV2, CadEntity, ExtrudeFeature, SketchFeature } from './types.js';

function boxEntity(id: string, name = 'Box'): CadEntity {
  return {
    id,
    name,
    primitive: { kind: 'box', width: 10, height: 20, depth: 30 },
    transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
  };
}

function sketch(id: string, name: string): SketchFeature {
  return { id, kind: 'sketch', name, plane: 'XY', entities: [], constraints: [], visible: true };
}

function extrude(id: string, name: string, sketchId: string): ExtrudeFeature {
  return { id, kind: 'extrude', name, sketchId, depth: 10, direction: 'normal', visible: true };
}

function doc(partial: Partial<CadDocumentV2>): CadDocumentV2 {
  return { schemaVersion: 2, units: 'mm', entities: [], features: [], ...partial };
}

describe('planDeletion', () => {
  it('returns null for an unknown target', () => {
    expect(planDeletion(doc({}), { kind: 'entity', id: 'nope' })).toBeNull();
    expect(planDeletion(doc({}), { kind: 'feature', id: 'nope' })).toBeNull();
  });

  it('plans an independent entity deletion as a single entity.delete with no dependents', () => {
    const document = doc({ entities: [boxEntity('e1', 'Box'), boxEntity('e2')] });

    const plan = planDeletion(document, { kind: 'entity', id: 'e1' });

    expect(plan).not.toBeNull();
    expect(plan!.command).toEqual({ type: 'entity.delete', id: 'e1' });
    expect(plan!.targetName).toBe('Box');
    expect(plan!.dependents).toEqual([]);
  });

  it('plans an extrude deletion as a single feature.delete with no dependents', () => {
    const document = doc({ features: [sketch('s1', 'Sketch 1'), extrude('x1', 'Extrude 1', 's1')] });

    const plan = planDeletion(document, { kind: 'feature', id: 'x1' });

    expect(plan!.command).toEqual({ type: 'feature.delete', id: 'x1' });
    expect(plan!.dependents).toEqual([]);
  });

  it('plans a sketch deletion with a dependent extrude as one atomic batch, dependents first', () => {
    const document = doc({ features: [sketch('s1', 'Sketch 1'), extrude('x1', 'Extrude 1', 's1')] });

    const plan = planDeletion(document, { kind: 'feature', id: 's1' });

    expect(plan!.targetName).toBe('Sketch 1');
    expect(plan!.dependents).toEqual([{ id: 'x1', name: 'Extrude 1' }]);
    expect(plan!.command).toEqual({
      type: 'batch',
      commands: [
        { type: 'feature.delete', id: 'x1' },
        { type: 'feature.delete', id: 's1' },
      ],
    });
  });

  it('reports every extrude that references the sketch as a dependent', () => {
    const document = doc({
      features: [sketch('s1', 'Sketch 1'), extrude('x1', 'Extrude 1', 's1'), extrude('x2', 'Extrude 2', 's1')],
    });

    const plan = planDeletion(document, { kind: 'feature', id: 's1' });

    expect(plan!.dependents.map((d) => d.id).sort()).toEqual(['x1', 'x2']);
    expect(plan!.command).toEqual({
      type: 'batch',
      commands: [
        { type: 'feature.delete', id: 'x1' },
        { type: 'feature.delete', id: 'x2' },
        { type: 'feature.delete', id: 's1' },
      ],
    });
  });

  it('does not treat an extrude on a different sketch as a dependent', () => {
    const document = doc({
      features: [sketch('s1', 'Sketch 1'), sketch('s2', 'Sketch 2'), extrude('x1', 'Extrude 1', 's2')],
    });

    const plan = planDeletion(document, { kind: 'feature', id: 's1' });

    expect(plan!.dependents).toEqual([]);
    expect(plan!.command).toEqual({ type: 'feature.delete', id: 's1' });
  });
});
