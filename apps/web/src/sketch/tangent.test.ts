import type { SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { lineTangentAtPoint } from './tangent.js';

function sketch(entities: SketchFeature['entities']): SketchFeature {
  return { id: 's', kind: 'sketch', name: 'Sketch', plane: 'XY', entities, constraints: [], visible: true };
}

describe('lineTangentAtPoint', () => {
  it('continues along a line at its end point (end − start)', () => {
    const s = sketch([
      { id: 'a', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'b', kind: 'point', x: 4, y: 0, construction: false },
      { id: 'l', kind: 'line', startId: 'a', endId: 'b', construction: false },
    ]);
    expect(lineTangentAtPoint(s, 'b')).toEqual({ x: 1, y: 0 });
  });

  it('points outward from a line at its start point (start − end)', () => {
    const s = sketch([
      { id: 'a', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'b', kind: 'point', x: 0, y: 4, construction: false },
      { id: 'l', kind: 'line', startId: 'a', endId: 'b', construction: false },
    ]);
    expect(lineTangentAtPoint(s, 'a')).toEqual({ x: 0, y: -1 });
  });

  it('ignores construction lines and returns null when no real line touches the point', () => {
    const s = sketch([
      { id: 'a', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'b', kind: 'point', x: 4, y: 0, construction: false },
      { id: 'l', kind: 'line', startId: 'a', endId: 'b', construction: true },
    ]);
    expect(lineTangentAtPoint(s, 'b')).toBeNull();
    expect(lineTangentAtPoint(s, 'missing')).toBeNull();
  });
});
