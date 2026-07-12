import type { SketchEntity, SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { detectSketchProfile } from './profile.js';

function point(id: string, x: number, y: number, construction = false): SketchEntity {
  return { id, kind: 'point', x, y, construction };
}

function line(id: string, startId: string, endId: string, construction = false): SketchEntity {
  return { id, kind: 'line', startId, endId, construction };
}

function circle(id: string, centerId: string, radius: number, construction = false): SketchEntity {
  return { id, kind: 'circle', centerId, radius, construction };
}

function arc(id: string, centerId: string, construction = false): SketchEntity {
  return { id, kind: 'arc', centerId, radius: 5, startAngle: 0, endAngle: Math.PI / 2, direction: 'ccw', construction };
}

function sketch(entities: SketchEntity[]): SketchFeature {
  return { id: 'sketch1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities, constraints: [], visible: true };
}

/** Counter-clockwise unit rectangle: p0(0,0) -> p1(4,0) -> p2(4,2) -> p3(0,2) -> p0. */
function ccwRectangle(): SketchEntity[] {
  return [
    point('p0', 0, 0),
    point('p1', 4, 0),
    point('p2', 4, 2),
    point('p3', 0, 2),
    line('l0', 'p0', 'p1'),
    line('l1', 'p1', 'p2'),
    line('l2', 'p2', 'p3'),
    line('l3', 'p3', 'p0'),
  ];
}

/** Clockwise winding of the same rectangle shape. */
function cwRectangle(): SketchEntity[] {
  return [
    point('p0', 0, 0),
    point('p1', 0, 2),
    point('p2', 4, 2),
    point('p3', 4, 0),
    line('l0', 'p0', 'p1'),
    line('l1', 'p1', 'p2'),
    line('l2', 'p2', 'p3'),
    line('l3', 'p3', 'p0'),
  ];
}

function signedAreaOf(profile: { pointIds: readonly string[] }, entities: SketchEntity[]): number {
  const points = new Map(entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point').map((p) => [p.id, p]));
  let sum = 0;
  const ids = profile.pointIds;
  for (let i = 0; i < ids.length; i++) {
    const a = points.get(ids[i]!)!;
    const b = points.get(ids[(i + 1) % ids.length]!)!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

describe('detectSketchProfile: valid rectangle profile', () => {
  it('detects a closed rectangle as a line-loop profile', () => {
    const result = detectSketchProfile(sketch(ccwRectangle()));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.profile.kind).toBe('line-loop');
  });

  it('detects the same profile when line entities are shuffled', () => {
    const entities = ccwRectangle();
    const points = entities.filter((e) => e.kind === 'point');
    const lines = entities.filter((e) => e.kind === 'line').reverse();
    const result = detectSketchProfile(sketch([...points, ...lines]));
    expect(result.ok).toBe(true);
  });

  it('detects the same profile when some edges are given in reversed start/end order', () => {
    const result = detectSketchProfile(
      sketch([point('p0', 0, 0), point('p1', 4, 0), point('p2', 4, 2), point('p3', 0, 2), line('l0', 'p1', 'p0'), line('l1', 'p1', 'p2'), line('l2', 'p3', 'p2'), line('l3', 'p3', 'p0')]),
    );
    expect(result.ok).toBe(true);
  });
});

describe('detectSketchProfile: winding normalization', () => {
  it('returns a counter-clockwise (non-negative signed area) loop for a CCW input rectangle', () => {
    const entities = ccwRectangle();
    const result = detectSketchProfile(sketch(entities));
    if (!result.ok || result.profile.kind !== 'line-loop') throw new Error('expected line-loop');
    expect(signedAreaOf(result.profile, entities)).toBeGreaterThan(0);
  });

  it('normalizes a clockwise input rectangle to counter-clockwise winding', () => {
    const entities = cwRectangle();
    const result = detectSketchProfile(sketch(entities));
    if (!result.ok || result.profile.kind !== 'line-loop') throw new Error('expected line-loop');
    expect(signedAreaOf(result.profile, entities)).toBeGreaterThan(0);
  });

  it('produces consistent (equal) winding for the same rectangle shape regardless of stated direction', () => {
    const ccwResult = detectSketchProfile(sketch(ccwRectangle()));
    const cwResult = detectSketchProfile(sketch(cwRectangle()));
    if (!ccwResult.ok || ccwResult.profile.kind !== 'line-loop') throw new Error('expected line-loop');
    if (!cwResult.ok || cwResult.profile.kind !== 'line-loop') throw new Error('expected line-loop');
    expect(signedAreaOf(ccwResult.profile, ccwRectangle())).toBeGreaterThan(0);
    expect(signedAreaOf(cwResult.profile, cwRectangle())).toBeGreaterThan(0);
  });
});

describe('detectSketchProfile: invalid topology passthrough', () => {
  it('surfaces an open-chain issue for an unclosed chain', () => {
    const result = detectSketchProfile(sketch([point('p0', 0, 0), point('p1', 4, 0), point('p2', 4, 2), line('l0', 'p0', 'p1'), line('l1', 'p1', 'p2')]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['open-chain']);
  });

  it('surfaces a branch issue for a chain with three edges at one point', () => {
    const entities = [...ccwRectangle(), point('p4', 2, 5), line('l4', 'p1', 'p4')];
    const result = detectSketchProfile(sketch(entities));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['branch']);
  });

  it('surfaces a disconnected issue for two separate closed loops', () => {
    const second = [point('q0', 10, 10), point('q1', 14, 10), point('q2', 14, 12), point('q3', 10, 12), line('m0', 'q0', 'q1'), line('m1', 'q1', 'q2'), line('m2', 'q2', 'q3'), line('m3', 'q3', 'q0')];
    const result = detectSketchProfile(sketch([...ccwRectangle(), ...second]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['disconnected']);
  });

  it('surfaces a duplicate-edge issue for a repeated edge', () => {
    const result = detectSketchProfile(sketch([...ccwRectangle(), line('l0dup', 'p0', 'p1')]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['duplicate-edge']);
  });

  it('surfaces a zero-length-edge issue for a degenerate edge', () => {
    const result = detectSketchProfile(sketch([point('p0', 0, 0), line('degenerate', 'p0', 'p0')]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['zero-length-edge']);
  });

  it('surfaces a missing-reference issue for a line pointing at a nonexistent point', () => {
    const result = detectSketchProfile(sketch([point('p0', 0, 0), line('l0', 'p0', 'ghost')]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['missing-reference']);
  });
});

describe('detectSketchProfile: self-intersection', () => {
  it('rejects a bowtie quadrilateral where opposite edges cross', () => {
    const entities: SketchEntity[] = [
      point('p0', 0, 0),
      point('p1', 4, 4),
      point('p2', 4, 0),
      point('p3', 0, 4),
      line('l0', 'p0', 'p1'),
      line('l1', 'p1', 'p2'),
      line('l2', 'p2', 'p3'),
      line('l3', 'p3', 'p0'),
    ];
    const result = detectSketchProfile(sketch(entities));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['self-intersection']);
  });
});

describe('detectSketchProfile: construction exclusion', () => {
  it('ignores a construction diagonal and still detects the outer rectangle', () => {
    const result = detectSketchProfile(sketch([...ccwRectangle(), line('diag', 'p0', 'p2', true)]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    if (result.profile.kind !== 'line-loop') throw new Error('expected line-loop');
    expect(result.profile.lineIds).not.toContain('diag');
  });

  it('ignores a construction point that is not referenced by any non-construction edge', () => {
    const result = detectSketchProfile(sketch([...ccwRectangle(), point('helper', 2, 1, true)]));
    expect(result.ok).toBe(true);
  });

  it('ignores a construction circle when a valid non-construction line loop is present', () => {
    const result = detectSketchProfile(sketch([...ccwRectangle(), point('center', 2, 1, true), circle('c0', 'center', 1, true)]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.profile.kind).toBe('line-loop');
  });
});

describe('detectSketchProfile: circle profile', () => {
  it('detects a standalone circle as a circle profile', () => {
    const result = detectSketchProfile(sketch([point('center', 0, 0), circle('c0', 'center', 5)]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.profile).toEqual({ kind: 'circle', circleId: 'c0', centerId: 'center', radius: 5 });
  });

  it('rejects multiple standalone circles as ambiguous', () => {
    const result = detectSketchProfile(sketch([point('c1', 0, 0), point('c2', 10, 0), circle('circleA', 'c1', 5), circle('circleB', 'c2', 3)]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['disconnected']);
  });

  it('rejects a circle whose center point reference is missing', () => {
    const result = detectSketchProfile(sketch([circle('c0', 'ghost', 5)]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['missing-reference']);
  });

  it('rejects a sketch mixing a line loop with a standalone circle as ambiguous', () => {
    const result = detectSketchProfile(sketch([...ccwRectangle(), point('center', 2, 1), circle('c0', 'center', 1)]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['disconnected']);
  });
});

describe('detectSketchProfile: unsupported arc geometry', () => {
  it('returns a structured unsupported-arc diagnostic for a standalone arc rather than misclassifying it', () => {
    const result = detectSketchProfile(sketch([point('center', 0, 0), arc('a0', 'center')]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['unsupported-arc']);
    expect(result.issues[0]!.entityIds).toContain('a0');
  });

  it('flags an arc even when an otherwise-valid line loop is present (never silently omitted)', () => {
    const result = detectSketchProfile(sketch([...ccwRectangle(), point('center', 2, 1), arc('a0', 'center')]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['unsupported-arc']);
  });

  it('excludes construction arcs, so a construction arc does not block a valid profile', () => {
    const result = detectSketchProfile(sketch([...ccwRectangle(), point('center', 2, 1, true), arc('a0', 'center', true)]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.profile.kind).toBe('line-loop');
  });
});

describe('detectSketchProfile: deterministic repeated output', () => {
  it('returns a deep-equal profile across repeated calls with the same rectangle sketch', () => {
    const s = sketch(ccwRectangle());
    expect(detectSketchProfile(s)).toEqual(detectSketchProfile(s));
  });

  it('returns a deep-equal profile across repeated calls with the same circle sketch', () => {
    const s = sketch([point('center', 0, 0), circle('c0', 'center', 5)]);
    expect(detectSketchProfile(s)).toEqual(detectSketchProfile(s));
  });
});
