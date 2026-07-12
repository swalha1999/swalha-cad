import { describe, expect, it } from 'vitest';
import type { SketchFeature } from '@swalha-cad/document';
import { applyConstructionToggle } from './construction.js';

function sketch(): SketchFeature {
  return {
    id: 'sk',
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    entities: [
      { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'p2', kind: 'point', x: 10, y: 0, construction: false },
      { id: 'l1', kind: 'line', startId: 'p1', endId: 'p2', construction: false },
      { id: 'c1', kind: 'circle', centerId: 'p1', radius: 5, construction: true },
    ],
    constraints: [],
    visible: true,
  };
}

describe('applyConstructionToggle', () => {
  it('promotes non-construction geometry to construction', () => {
    const entities = applyConstructionToggle(sketch(), ['l1']);
    expect(entities.find((e) => e.id === 'l1')?.construction).toBe(true);
    // Untouched entities are unchanged.
    expect(entities.find((e) => e.id === 'p1')?.construction).toBe(false);
  });

  it('demotes construction geometry back to real when all selected are construction', () => {
    const entities = applyConstructionToggle(sketch(), ['c1']);
    expect(entities.find((e) => e.id === 'c1')?.construction).toBe(false);
  });

  it('promotes a mixed selection to all-construction (target = true unless every one is already construction)', () => {
    const entities = applyConstructionToggle(sketch(), ['l1', 'c1']);
    expect(entities.find((e) => e.id === 'l1')?.construction).toBe(true);
    expect(entities.find((e) => e.id === 'c1')?.construction).toBe(true);
  });

  it('returns the original array (no-op) when no selected id exists in the sketch', () => {
    const original = sketch();
    expect(applyConstructionToggle(original, ['missing'])).toBe(original.entities);
    expect(applyConstructionToggle(original, [])).toBe(original.entities);
  });
});
