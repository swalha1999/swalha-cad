import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConstraintGlyphs, computeGlyphs } from './ConstraintGlyphs.js';

function sketch(entities: SketchEntity[], constraints: SketchConstraint[]): SketchFeature {
  return { id: 's', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities, constraints, visible: true };
}

const RECT: SketchEntity[] = [
  { id: 'p0', kind: 'point', x: 0, y: 0, construction: false },
  { id: 'p1', kind: 'point', x: 40, y: 0, construction: false },
  { id: 'p2', kind: 'point', x: 40, y: 30, construction: false },
  { id: 'l0', kind: 'line', startId: 'p0', endId: 'p1', construction: false },
  { id: 'l1', kind: 'line', startId: 'p1', endId: 'p2', construction: false },
];

describe('computeGlyphs', () => {
  it('places a horizontal glyph at the line midpoint', () => {
    const glyphs = computeGlyphs(sketch(RECT, [{ id: 'h', kind: 'horizontal', lineId: 'l0' }]));
    expect(glyphs).toEqual([{ id: 'h', kind: 'horizontal', x: 20, y: 0, text: 'H', label: 'Horizontal' }]);
  });

  it('labels a distance glyph with the measured value at the midpoint', () => {
    const glyphs = computeGlyphs(sketch(RECT, [{ id: 'd', kind: 'distance', pointA: 'p0', pointB: 'p1', value: 40 }]));
    expect(glyphs[0]).toMatchObject({ kind: 'distance', x: 20, y: 0, text: '40' });
  });

  it('labels a radius glyph with an R prefix at the circle center', () => {
    const entities: SketchEntity[] = [
      { id: 'c0', kind: 'point', x: 5, y: 6, construction: false },
      { id: 'circ', kind: 'circle', centerId: 'c0', radius: 12.5, construction: false },
    ];
    const glyphs = computeGlyphs(sketch(entities, [{ id: 'r', kind: 'radius', circleId: 'circ', value: 12.5 }]));
    expect(glyphs[0]).toMatchObject({ kind: 'radius', x: 5, y: 6, text: 'R12.5' });
  });

  it('labels an angle glyph with degrees at the shared vertex', () => {
    const glyphs = computeGlyphs(sketch(RECT, [{ id: 'a', kind: 'angle', lineA: 'l0', lineB: 'l1', valueDeg: 90 }]));
    expect(glyphs[0]).toMatchObject({ kind: 'angle', x: 40, y: 0, text: '90°' });
  });

  it('skips constraints whose geometry cannot be resolved', () => {
    const glyphs = computeGlyphs(sketch(RECT, [{ id: 'h', kind: 'horizontal', lineId: 'missing' }]));
    expect(glyphs).toEqual([]);
  });
});

describe('ConstraintGlyphs rendering', () => {
  it('renders one badge per resolvable constraint with a kind data attribute', () => {
    const constraints: SketchConstraint[] = [
      { id: 'h', kind: 'horizontal', lineId: 'l0' },
      { id: 'v', kind: 'vertical', lineId: 'l1' },
      { id: 'd', kind: 'distance', pointA: 'p0', pointB: 'p1', value: 40 },
    ];
    const { container } = render(
      <svg>
        <ConstraintGlyphs sketch={sketch(RECT, constraints)} />
      </svg>,
    );
    expect(container.querySelectorAll('.sketch-glyph')).toHaveLength(3);
    expect(container.querySelector('[data-constraint-kind="distance"]')).not.toBeNull();
  });
});
