import type {
  CadDocumentV2,
  CadEntity,
  ExtrudeFeature,
  Primitive,
  SketchEntity,
  SketchFeature,
  SketchPlane,
} from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { computeMeshBounds } from '../mesh-validation.js';
import { triangleCount } from '../mesh.js';
import { evaluateDocument, evaluatedWorldBounds, type EvaluatedBody } from './evaluate-document.js';

const IDENTITY = { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] } as const;

function entity(id: string, primitive: Primitive, overrides: Partial<CadEntity> = {}): CadEntity {
  return { id, name: id, primitive, transform: IDENTITY, visible: true, ...overrides };
}

function point(id: string, x: number, y: number, construction = false): SketchEntity {
  return { id, kind: 'point', x, y, construction };
}

function line(id: string, startId: string, endId: string): SketchEntity {
  return { id, kind: 'line', startId, endId, construction: false };
}

/** Counter-clockwise 4x2 rectangle at the origin corner. */
function rectangleEntities(): SketchEntity[] {
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

function sketch(
  id: string,
  entities: SketchEntity[],
  overrides: Partial<SketchFeature> = {},
): SketchFeature {
  return {
    id,
    kind: 'sketch',
    name: id,
    plane: 'XY' as SketchPlane,
    entities,
    constraints: [],
    visible: true,
    ...overrides,
  };
}

function extrude(id: string, sketchId: string, overrides: Partial<ExtrudeFeature> = {}): ExtrudeFeature {
  return {
    id,
    kind: 'extrude',
    name: id,
    sketchId,
    depth: 5,
    direction: 'normal',
    visible: true,
    ...overrides,
  };
}

function documentOf(
  entities: CadEntity[],
  features: CadDocumentV2['features'] = [],
): CadDocumentV2 {
  return { schemaVersion: 2, units: 'mm', entities, features };
}

const BOX: Primitive = { kind: 'box', width: 10, height: 20, depth: 30 };
const CYLINDER: Primitive = { kind: 'cylinder', radius: 5, height: 12, segments: 16 };

function meshBody(body: EvaluatedBody | undefined): EvaluatedBody & { geometry: { kind: 'mesh' } } {
  expect(body).toBeDefined();
  expect(body!.geometry.kind).toBe('mesh');
  return body as EvaluatedBody & { geometry: { kind: 'mesh' } };
}

describe('evaluateDocument — primitives retained', () => {
  it('produces one primitive body per M1 entity, preserving id/name/visibility/transform', () => {
    const transform = { translation: [1, 2, 3] as const, rotationDeg: [0, 0, 0] as const, scale: [1, 1, 1] as const };
    const doc = documentOf([
      entity('a', BOX, { name: 'Box A', transform }),
      entity('b', CYLINDER, { visible: false }),
    ]);
    const { bodies, diagnostics } = evaluateDocument(doc);

    expect(diagnostics).toEqual([]);
    expect(bodies).toHaveLength(2);
    const a = bodies.find((body) => body.id === 'a')!;
    expect(a.name).toBe('Box A');
    expect(a.visible).toBe(true);
    expect(a.geometry).toEqual({ kind: 'primitive', primitive: BOX, transform });
    const b = bodies.find((body) => body.id === 'b')!;
    expect(b.visible).toBe(false);
  });

  it('gives a primitive body a build key independent of its transform', () => {
    const moved = { translation: [9, 9, 9] as const, rotationDeg: [0, 0, 0] as const, scale: [1, 1, 1] as const };
    const still = evaluateDocument(documentOf([entity('a', BOX)])).bodies[0]!;
    const shifted = evaluateDocument(documentOf([entity('a', BOX, { transform: moved })])).bodies[0]!;
    expect(shifted.buildKey).toBe(still.buildKey);
  });
});

describe('evaluateDocument — feature ordering and mixing', () => {
  it('emits primitive bodies first, then extrude bodies in document feature order', () => {
    const doc = documentOf(
      [entity('prim', BOX)],
      [
        sketch('s1', rectangleEntities()),
        extrude('e1', 's1', { name: 'First' }),
        sketch('s2', rectangleEntities(), { plane: 'YZ' }),
        extrude('e2', 's2', { name: 'Second' }),
      ],
    );
    const { bodies } = evaluateDocument(doc);
    expect(bodies.map((b) => b.id)).toEqual(['prim', 'e1', 'e2']);
  });

  it('does not emit a body for a standalone sketch — sketches are non-solid', () => {
    const doc = documentOf([], [sketch('s1', rectangleEntities())]);
    const { bodies, diagnostics } = evaluateDocument(doc);
    expect(bodies).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('produces a valid mesh body for a visible extrude of a valid profile', () => {
    const doc = documentOf([], [sketch('s1', rectangleEntities()), extrude('e1', 's1')]);
    const body = meshBody(evaluateDocument(doc).bodies.find((b) => b.id === 'e1'));
    expect(body.visible).toBe(true);
    // A rectangular prism: 12 triangles.
    expect(triangleCount(body.geometry.mesh)).toBe(12);
    const { min, max } = computeMeshBounds(body.geometry.mesh);
    expect(min).toEqual([0, 0, 0]);
    expect(max).toEqual([4, 2, 5]);
  });
});

describe('evaluateDocument — deterministic rebuild', () => {
  it('produces byte-identical mesh and build key on repeated evaluation', () => {
    const doc = documentOf([], [sketch('s1', rectangleEntities()), extrude('e1', 's1')]);
    const a = meshBody(evaluateDocument(doc).bodies.find((b) => b.id === 'e1'));
    const b = meshBody(evaluateDocument(doc).bodies.find((b) => b.id === 'e1'));
    expect(a.buildKey).toBe(b.buildKey);
    expect(Array.from(a.geometry.mesh.positions)).toEqual(Array.from(b.geometry.mesh.positions));
    expect(Array.from(a.geometry.mesh.indices)).toEqual(Array.from(b.geometry.mesh.indices));
  });

  it('rebuilds a different mesh and key when the extrusion depth changes', () => {
    const shallow = documentOf([], [sketch('s1', rectangleEntities()), extrude('e1', 's1', { depth: 5 })]);
    const deep = documentOf([], [sketch('s1', rectangleEntities()), extrude('e1', 's1', { depth: 9 })]);
    const a = meshBody(evaluateDocument(shallow).bodies.find((b) => b.id === 'e1'));
    const b = meshBody(evaluateDocument(deep).bodies.find((b) => b.id === 'e1'));
    expect(a.buildKey).not.toBe(b.buildKey);
    expect(computeMeshBounds(a.geometry.mesh).max[2]).toBeCloseTo(5, 5);
    expect(computeMeshBounds(b.geometry.mesh).max[2]).toBeCloseTo(9, 5);
  });

  it('rebuilds a different mesh and key when the source sketch geometry changes', () => {
    const wider = rectangleEntities().map((e) => (e.id === 'p1' ? point('p1', 8, 0) : e));
    const widerWithP2 = wider.map((e) => (e.id === 'p2' ? point('p2', 8, 2) : e));
    const base = documentOf([], [sketch('s1', rectangleEntities()), extrude('e1', 's1')]);
    const edited = documentOf([], [sketch('s1', widerWithP2), extrude('e1', 's1')]);
    const a = meshBody(evaluateDocument(base).bodies.find((b) => b.id === 'e1'));
    const b = meshBody(evaluateDocument(edited).bodies.find((b) => b.id === 'e1'));
    expect(a.buildKey).not.toBe(b.buildKey);
    expect(computeMeshBounds(a.geometry.mesh).max[0]).toBeCloseTo(4, 5);
    expect(computeMeshBounds(b.geometry.mesh).max[0]).toBeCloseTo(8, 5);
  });
});

describe('evaluateDocument — all planes', () => {
  const cases: Array<{ plane: SketchPlane; axis: 0 | 1 | 2 }> = [
    { plane: 'XY', axis: 2 },
    { plane: 'XZ', axis: 1 },
    { plane: 'YZ', axis: 0 },
  ];
  for (const { plane, axis } of cases) {
    it(`extrudes along the ${plane} plane normal`, () => {
      const doc = documentOf([], [sketch('s1', rectangleEntities(), { plane }), extrude('e1', 's1', { depth: 5 })]);
      const body = meshBody(evaluateDocument(doc).bodies.find((b) => b.id === 'e1'));
      const { min, max } = computeMeshBounds(body.geometry.mesh);
      expect(Math.abs(max[axis] - min[axis])).toBeCloseTo(5, 5);
    });
  }
});

describe('evaluateDocument — visibility semantics', () => {
  it('omits a hidden extrude entirely, without a body or diagnostic', () => {
    const doc = documentOf([], [sketch('s1', rectangleEntities()), extrude('e1', 's1', { visible: false })]);
    const { bodies, diagnostics } = evaluateDocument(doc);
    expect(bodies).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('still drives a visible extrude from a hidden source sketch', () => {
    const doc = documentOf(
      [],
      [sketch('s1', rectangleEntities(), { visible: false }), extrude('e1', 's1', { visible: true })],
    );
    const { bodies, diagnostics } = evaluateDocument(doc);
    expect(diagnostics).toEqual([]);
    const body = meshBody(bodies.find((b) => b.id === 'e1'));
    expect(body.visible).toBe(true);
  });
});

describe('evaluateDocument — broken references and invalid features', () => {
  it('reports a missing sketch reference and emits no body', () => {
    const doc = documentOf([], [extrude('e1', 'does-not-exist')]);
    const { bodies, diagnostics } = evaluateDocument(doc);
    expect(bodies).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('missing-sketch');
    expect(diagnostics[0]!.featureId).toBe('e1');
  });

  it('reports a reference that resolves to a non-sketch feature as a missing sketch', () => {
    const doc = documentOf(
      [],
      [sketch('s1', rectangleEntities()), extrude('base', 's1'), extrude('e1', 'base')],
    );
    const { diagnostics } = evaluateDocument(doc);
    expect(diagnostics.some((d) => d.featureId === 'e1' && d.code === 'missing-sketch')).toBe(true);
  });

  it('reports an open profile as an invalid-profile diagnostic with topology issues, not stale geometry', () => {
    const open = rectangleEntities().filter((e) => e.id !== 'l3');
    const doc = documentOf([], [sketch('s1', open), extrude('e1', 's1')]);
    const { bodies, diagnostics } = evaluateDocument(doc);
    expect(bodies.some((b) => b.id === 'e1')).toBe(false);
    const diag = diagnostics.find((d) => d.featureId === 'e1')!;
    expect(diag.code).toBe('invalid-profile');
    expect(diag.issues.some((i) => i.kind === 'open-chain')).toBe(true);
  });

  it('reports an invalid depth diagnostic', () => {
    const doc = documentOf([], [sketch('s1', rectangleEntities()), extrude('e1', 's1', { depth: 0 })]);
    const { bodies, diagnostics } = evaluateDocument(doc);
    expect(bodies.some((b) => b.id === 'e1')).toBe(false);
    expect(diagnostics.find((d) => d.featureId === 'e1')!.code).toBe('invalid-depth');
  });

  it('keeps valid bodies alongside a broken feature', () => {
    const doc = documentOf(
      [entity('prim', BOX)],
      [sketch('s1', rectangleEntities()), extrude('good', 's1'), extrude('bad', 'missing')],
    );
    const { bodies, diagnostics } = evaluateDocument(doc);
    expect(bodies.map((b) => b.id).sort()).toEqual(['good', 'prim']);
    expect(diagnostics.map((d) => d.featureId)).toEqual(['bad']);
  });
});

describe('evaluatedWorldBounds', () => {
  it('returns null when there is no visible geometry', () => {
    expect(evaluatedWorldBounds(evaluateDocument(documentOf([])))).toBeNull();
    const hidden = documentOf([entity('a', BOX, { visible: false })]);
    expect(evaluatedWorldBounds(evaluateDocument(hidden))).toBeNull();
  });

  it('unions a translated primitive and a derived extrude in world space', () => {
    const doc = documentOf(
      [
        entity('a', { kind: 'box', width: 2, height: 2, depth: 2 }, {
          transform: { translation: [10, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        }),
      ],
      [sketch('s1', rectangleEntities()), extrude('e1', 's1', { depth: 5 })],
    );
    const bounds = evaluatedWorldBounds(evaluateDocument(doc))!;
    // Box centered at (10,0,0) spans x[9,11], y[-1,1], z[-1,1]; rectangle prism spans x[0,4], y[0,2], z[0,5].
    expect(bounds.min[0]).toBeCloseTo(0, 5);
    expect(bounds.max[0]).toBeCloseTo(11, 5);
    expect(bounds.min[1]).toBeCloseTo(-1, 5);
    expect(bounds.max[1]).toBeCloseTo(2, 5);
    expect(bounds.min[2]).toBeCloseTo(-1, 5);
    expect(bounds.max[2]).toBeCloseTo(5, 5);
  });

  it('excludes hidden primitives from the world bounds', () => {
    const doc = documentOf([
      entity('a', { kind: 'box', width: 2, height: 2, depth: 2 }),
      entity('big', { kind: 'box', width: 100, height: 100, depth: 100 }, { visible: false }),
    ]);
    const bounds = evaluatedWorldBounds(evaluateDocument(doc))!;
    expect(bounds.min).toEqual([-1, -1, -1]);
    expect(bounds.max).toEqual([1, 1, 1]);
  });
});
