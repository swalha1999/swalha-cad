import { describe, expect, it } from 'vitest';
import { parseCadDocument } from './schema.js';
import type { CadEntity, ExtrudeFeature, Primitive, SketchFeature } from './types.js';

function entityWith(primitive: Primitive): CadEntity {
  return {
    id: `entity-${primitive.kind}`,
    name: primitive.kind,
    primitive,
    transform: {
      translation: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    },
    visible: true,
  };
}

function rectangleSketch(overrides: Partial<SketchFeature> = {}): SketchFeature {
  return {
    id: 'sketch-1',
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    entities: [
      { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'p2', kind: 'point', x: 10, y: 0, construction: false },
      { id: 'p3', kind: 'point', x: 10, y: 10, construction: false },
      { id: 'p4', kind: 'point', x: 0, y: 10, construction: false },
      { id: 'l1', kind: 'line', startId: 'p1', endId: 'p2', construction: false },
      { id: 'l2', kind: 'line', startId: 'p2', endId: 'p3', construction: false },
      { id: 'l3', kind: 'line', startId: 'p3', endId: 'p4', construction: false },
      { id: 'l4', kind: 'line', startId: 'p4', endId: 'p1', construction: false },
    ],
    constraints: [
      { id: 'c1', kind: 'horizontal', lineId: 'l1' },
      { id: 'c2', kind: 'vertical', lineId: 'l2' },
      { id: 'c3', kind: 'distance', pointA: 'p1', pointB: 'p2', value: 10 },
      { id: 'c4', kind: 'angle', lineA: 'l1', lineB: 'l2', valueDeg: 90 },
      { id: 'c5', kind: 'coincident', pointA: 'p4', pointB: 'p1' },
    ],
    visible: true,
    ...overrides,
  };
}

function circleSketch(overrides: Partial<SketchFeature> = {}): SketchFeature {
  return {
    id: 'sketch-circle',
    kind: 'sketch',
    name: 'Sketch Circle',
    plane: 'XZ',
    entities: [
      { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'circ1', kind: 'circle', centerId: 'p1', radius: 5, construction: false },
    ],
    constraints: [{ id: 'c1', kind: 'radius', circleId: 'circ1', value: 5 }],
    visible: true,
    ...overrides,
  };
}

function extrudeOf(sketchId: string, overrides: Partial<ExtrudeFeature> = {}): ExtrudeFeature {
  return {
    id: 'extrude-1',
    kind: 'extrude',
    name: 'Extrude 1',
    sketchId,
    depth: 20,
    direction: 'normal',
    visible: true,
    ...overrides,
  };
}

describe('parseCadDocument — V1 documents (legacy)', () => {
  it('accepts a valid empty V1 document', () => {
    const doc = {
      schemaVersion: 1,
      units: 'mm',
      entities: [],
    };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ schemaVersion: 2, units: 'mm', entities: [], features: [] });
    }
  });

  it('accepts each primitive type', () => {
    const entities = [
      entityWith({ kind: 'box', width: 10, height: 20, depth: 30 }),
      entityWith({ kind: 'cylinder', radius: 5, height: 15, segments: 16 }),
      entityWith({ kind: 'lBracket', width: 40, height: 40, depth: 10, thickness: 5 }),
    ];
    const doc = { schemaVersion: 1, units: 'mm', entities };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ schemaVersion: 2, units: 'mm', entities, features: [] });
    }
  });

  it.each([
    { kind: 'box', width: 0, height: 20, depth: 30 },
    { kind: 'box', width: -10, height: 20, depth: 30 },
    { kind: 'cylinder', radius: 0, height: 15, segments: 16 },
    { kind: 'cylinder', radius: 5, height: -15, segments: 16 },
    { kind: 'lBracket', width: 40, height: 40, depth: 0, thickness: 5 },
    { kind: 'lBracket', width: 40, height: 40, depth: 10, thickness: -5 },
  ] as const)('rejects non-positive dimensions for %o', (primitive) => {
    const doc = { schemaVersion: 1, units: 'mm', entities: [entityWith(primitive)] };

    expect(parseCadDocument(doc).success).toBe(false);
  });

  it('rejects an l-bracket whose thickness is not strictly less than width/height', () => {
    const doc = {
      schemaVersion: 1,
      units: 'mm',
      entities: [entityWith({ kind: 'lBracket', width: 40, height: 40, depth: 10, thickness: 40 })],
    };

    expect(parseCadDocument(doc).success).toBe(false);
  });

  it('migrates a V1 document to canonical V2 by adding an empty features array', () => {
    const doc = { schemaVersion: 1, units: 'mm', entities: [entityWith({ kind: 'box', width: 1, height: 1, depth: 1 })] };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(2);
      expect(result.data.features).toEqual([]);
      expect(result.data.entities).toEqual(doc.entities);
    }
  });
});

describe('parseCadDocument — V2 documents', () => {
  it('accepts a valid empty V2 document', () => {
    const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [] };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(doc);
    }
  });

  it('accepts a document with a valid sketch feature (rectangle profile)', () => {
    const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [rectangleSketch()] };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(true);
  });

  it('accepts a document with a valid sketch feature (circle profile)', () => {
    const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [circleSketch()] };

    expect(parseCadDocument(doc).success).toBe(true);
  });

  it('accepts a document with a valid extrude feature referencing an existing sketch', () => {
    const sketch = circleSketch();
    const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch, extrudeOf(sketch.id)] };

    expect(parseCadDocument(doc).success).toBe(true);
  });

  it('accepts a document combining M1 primitives and M2 features', () => {
    const sketch = circleSketch();
    const doc = {
      schemaVersion: 2,
      units: 'mm',
      entities: [entityWith({ kind: 'box', width: 10, height: 10, depth: 10 })],
      features: [sketch, extrudeOf(sketch.id)],
    };

    expect(parseCadDocument(doc).success).toBe(true);
  });

  it('rejects unknown fields on a sketch feature (strict schema)', () => {
    const sketch = { ...rectangleSketch(), extra: 'nope' };
    const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

    expect(parseCadDocument(doc).success).toBe(false);
  });

  it('rejects unknown fields on an extrude feature (strict schema)', () => {
    const sketch = circleSketch();
    const extrude = { ...extrudeOf(sketch.id), extra: 'nope' };
    const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch, extrude] };

    expect(parseCadDocument(doc).success).toBe(false);
  });

  describe('dangling and duplicate references', () => {
    it('rejects a line referencing a non-existent start point', () => {
      const sketch = rectangleSketch({
        entities: [
          { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
          { id: 'l1', kind: 'line', startId: 'missing', endId: 'p1', construction: false },
        ],
        constraints: [],
      });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects a line whose start and end are the same point', () => {
      const sketch = rectangleSketch({
        entities: [
          { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
          { id: 'l1', kind: 'line', startId: 'p1', endId: 'p1', construction: false },
        ],
        constraints: [],
      });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects a circle referencing a non-existent center point', () => {
      const sketch = circleSketch({
        entities: [{ id: 'circ1', kind: 'circle', centerId: 'missing', radius: 5, construction: false }],
        constraints: [],
      });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects duplicate sketch entity ids', () => {
      const sketch = rectangleSketch({
        entities: [
          { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
          { id: 'p1', kind: 'point', x: 1, y: 1, construction: false },
        ],
        constraints: [],
      });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects duplicate sketch constraint ids', () => {
      const sketch = rectangleSketch({
        constraints: [
          { id: 'c1', kind: 'horizontal', lineId: 'l1' },
          { id: 'c1', kind: 'vertical', lineId: 'l2' },
        ],
      });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects a coincident constraint referencing an unknown point', () => {
      const sketch = rectangleSketch({ constraints: [{ id: 'c1', kind: 'coincident', pointA: 'p1', pointB: 'missing' }] });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects a horizontal/vertical constraint referencing an unknown line', () => {
      const sketch = rectangleSketch({ constraints: [{ id: 'c1', kind: 'horizontal', lineId: 'missing' }] });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects a radius constraint referencing an unknown circle', () => {
      const sketch = circleSketch({ constraints: [{ id: 'c1', kind: 'radius', circleId: 'missing', value: 5 }] });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects an angle constraint referencing an unknown line', () => {
      const sketch = rectangleSketch({
        constraints: [{ id: 'c1', kind: 'angle', lineA: 'l1', lineB: 'missing', valueDeg: 45 }],
      });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects an angle constraint referencing the same line twice', () => {
      const sketch = rectangleSketch({
        constraints: [{ id: 'c1', kind: 'angle', lineA: 'l1', lineB: 'l1', valueDeg: 45 }],
      });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects an extrude feature referencing a non-existent sketch', () => {
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [extrudeOf('missing-sketch')] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects duplicate feature ids across the document', () => {
      const sketch = circleSketch();
      const otherSketch = circleSketch({ id: sketch.id, entities: [{ id: 'q1', kind: 'point', x: 1, y: 1, construction: false }] });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch, otherSketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });
  });

  describe('positive finite dimension and bound validation', () => {
    it.each([0, -5, Number.POSITIVE_INFINITY, Number.NaN])('rejects a circle entity radius of %s', (radius) => {
      const sketch = circleSketch({
        entities: [
          { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
          { id: 'circ1', kind: 'circle', centerId: 'p1', radius, construction: false },
        ],
      });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it.each([0, -5, Number.POSITIVE_INFINITY, Number.NaN])('rejects a distance constraint value of %s', (value) => {
      const sketch = rectangleSketch({ constraints: [{ id: 'c1', kind: 'distance', pointA: 'p1', pointB: 'p2', value }] });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it.each([0, -5, Number.POSITIVE_INFINITY, Number.NaN])('rejects a radius constraint value of %s', (value) => {
      const sketch = circleSketch({ constraints: [{ id: 'c1', kind: 'radius', circleId: 'circ1', value }] });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it.each([0, -5, 180, 181, 360, Number.NaN, Number.POSITIVE_INFINITY])('rejects an angle constraint of %s degrees', (valueDeg) => {
      const sketch = rectangleSketch({ constraints: [{ id: 'c1', kind: 'angle', lineA: 'l1', lineB: 'l2', valueDeg }] });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it.each([0.5, 45, 90, 179.5])('accepts an angle constraint of %s degrees', (valueDeg) => {
      const sketch = rectangleSketch({ constraints: [{ id: 'c1', kind: 'angle', lineA: 'l1', lineB: 'l2', valueDeg }] });
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(true);
    });

    it.each([0, -10, Number.POSITIVE_INFINITY, Number.NaN])('rejects an extrude depth of %s', (depth) => {
      const sketch = circleSketch();
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch, extrudeOf(sketch.id, { depth })] };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects an invalid extrude direction', () => {
      const sketch = circleSketch();
      const doc = {
        schemaVersion: 2,
        units: 'mm',
        entities: [],
        features: [sketch, { ...extrudeOf(sketch.id), direction: 'sideways' }],
      };

      expect(parseCadDocument(doc).success).toBe(false);
    });

    it('rejects an invalid sketch plane', () => {
      const sketch = { ...circleSketch(), plane: 'ZZ' };
      const doc = { schemaVersion: 2, units: 'mm', entities: [], features: [sketch] };

      expect(parseCadDocument(doc).success).toBe(false);
    });
  });

  it('rejects unknown schema versions', () => {
    const doc = { schemaVersion: 3, units: 'mm', entities: [], features: [] };

    expect(parseCadDocument(doc).success).toBe(false);
  });

  it('rejects a document missing schemaVersion entirely', () => {
    expect(parseCadDocument({ units: 'mm', entities: [] }).success).toBe(false);
  });

  it('round-trips a V2 document with features through JSON without data loss', () => {
    const sketch = rectangleSketch();
    const extrude = extrudeOf(sketch.id);
    const doc = {
      schemaVersion: 2,
      units: 'mm',
      entities: [entityWith({ kind: 'box', width: 10, height: 20, depth: 30 })],
      features: [sketch, extrude],
    };

    const result = parseCadDocument(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const roundTripped = JSON.parse(JSON.stringify(result.data));
    expect(roundTripped).toEqual(doc);

    const reparsed = parseCadDocument(roundTripped);
    expect(reparsed.success).toBe(true);
    if (reparsed.success) {
      expect(reparsed.data).toEqual(doc);
    }
  });
});
