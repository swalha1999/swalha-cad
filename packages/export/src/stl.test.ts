import type { CadDocumentV1, CadEntity } from '@swalha-cad/document';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exportDocumentToBinaryStl } from './stl.js';

const HEADER_SIZE = 80;
const TRIANGLE_SIZE = 50;

interface ParsedFacet {
  readonly normal: readonly [number, number, number];
  readonly vertices: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
}

interface ParsedStl {
  readonly header: string;
  readonly triangleCount: number;
  readonly facets: readonly ParsedFacet[];
}

/**
 * Independent binary STL reader, written from the spec rather than reused
 * from `stl.ts`, so it can catch encoding bugs the exporter itself would not
 * notice: 80-byte header, uint32 LE triangle count, then per triangle a
 * float32 LE normal, three float32 LE vertices, and a uint16 attribute byte
 * count, in that exact order.
 */
function parseBinaryStl(bytes: Uint8Array): ParsedStl {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = new TextDecoder().decode(bytes.subarray(0, HEADER_SIZE)).replace(/\0+$/, '');
  const triangleCount = view.getUint32(HEADER_SIZE, true);
  const expectedSize = HEADER_SIZE + 4 + triangleCount * TRIANGLE_SIZE;
  if (bytes.byteLength !== expectedSize) {
    throw new Error(`Binary STL size mismatch: expected ${expectedSize}, got ${bytes.byteLength}`);
  }

  const facets: ParsedFacet[] = [];
  let offset = HEADER_SIZE + 4;
  const readVec3 = (): [number, number, number] => {
    const v: [number, number, number] = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    offset += 12;
    return v;
  };
  for (let i = 0; i < triangleCount; i++) {
    const normal = readVec3();
    const v1 = readVec3();
    const v2 = readVec3();
    const v3 = readVec3();
    offset += 2; // attribute byte count
    facets.push({ normal, vertices: [v1, v2, v3] });
  }

  return { header, triangleCount, facets };
}

function boundsOf(facets: readonly ParsedFacet[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const facet of facets) {
    for (const vertex of facet.vertices) {
      for (let axis = 0; axis < 3; axis++) {
        if (vertex[axis]! < min[axis]!) min[axis] = vertex[axis]!;
        if (vertex[axis]! > max[axis]!) max[axis] = vertex[axis]!;
      }
    }
  }
  return { min, max };
}

function makeEntity(overrides: Partial<CadEntity>): CadEntity {
  return {
    id: 'e1',
    name: 'entity',
    primitive: { kind: 'box', width: 1, height: 1, depth: 1 },
    transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    ...overrides,
  };
}

function makeDocument(entities: readonly CadEntity[]): CadDocumentV1 {
  return { schemaVersion: 1, units: 'mm', entities: [...entities] };
}

describe('exportDocumentToBinaryStl', () => {
  it('writes a valid 80-byte header and a triangle count matching the mesh', () => {
    const doc = makeDocument([makeEntity({ primitive: { kind: 'box', width: 2, height: 2, depth: 2 } })]);
    const bytes = exportDocumentToBinaryStl(doc);
    const parsed = parseBinaryStl(bytes);
    expect(parsed.header.length).toBeLessThanOrEqual(HEADER_SIZE);
    expect(parsed.triangleCount).toBe(12);
    expect(bytes.byteLength).toBe(HEADER_SIZE + 4 + 12 * TRIANGLE_SIZE);
  });

  it('sums triangle counts across multiple visible entities', () => {
    const doc = makeDocument([
      makeEntity({ id: 'e1', primitive: { kind: 'box', width: 1, height: 1, depth: 1 } }),
      makeEntity({ id: 'e2', primitive: { kind: 'cylinder', radius: 1, height: 2, segments: 8 } }),
    ]);
    const bytes = exportDocumentToBinaryStl(doc);
    const parsed = parseBinaryStl(bytes);
    // box: 12 triangles. cylinder(segments=8): 16 side + 8 + 8 caps = 32.
    expect(parsed.triangleCount).toBe(12 + 32);
  });

  it('bakes translation into exported vertices', () => {
    const doc = makeDocument([
      makeEntity({
        primitive: { kind: 'box', width: 2, height: 2, depth: 2 },
        transform: { translation: [10, 20, 30], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      }),
    ]);
    const parsed = parseBinaryStl(exportDocumentToBinaryStl(doc));
    const bounds = boundsOf(parsed.facets);
    expect(bounds.min[0]).toBeCloseTo(9);
    expect(bounds.min[1]).toBeCloseTo(19);
    expect(bounds.min[2]).toBeCloseTo(29);
    expect(bounds.max[0]).toBeCloseTo(11);
    expect(bounds.max[1]).toBeCloseTo(21);
    expect(bounds.max[2]).toBeCloseTo(31);
  });

  it('bakes non-uniform scale and rotation into exported vertices', () => {
    const doc = makeDocument([
      makeEntity({
        primitive: { kind: 'box', width: 2, height: 4, depth: 6 },
        transform: { translation: [0, 0, 0], rotationDeg: [0, 90, 0], scale: [2, 1, 1] },
      }),
    ]);
    const parsed = parseBinaryStl(exportDocumentToBinaryStl(doc));
    const bounds = boundsOf(parsed.facets);
    // Local bounds [-1,-2,-3]..[1,2,3] scaled by [2,1,1] to [-2,-2,-3]..[2,2,3],
    // then a 90deg yaw around Y maps (x, z) -> (z, -x), swapping the X and Z extents.
    expect(bounds.min[0]).toBeCloseTo(-3);
    expect(bounds.max[0]).toBeCloseTo(3);
    expect(bounds.min[1]).toBeCloseTo(-2);
    expect(bounds.max[1]).toBeCloseTo(2);
    expect(bounds.min[2]).toBeCloseTo(-2);
    expect(bounds.max[2]).toBeCloseTo(2);
  });

  it('writes finite vertex coordinates only', () => {
    const doc = makeDocument([makeEntity({ primitive: { kind: 'cylinder', radius: 3, height: 5, segments: 16 } })]);
    const parsed = parseBinaryStl(exportDocumentToBinaryStl(doc));
    for (const facet of parsed.facets) {
      for (const vertex of facet.vertices) {
        for (const coordinate of vertex) {
          expect(Number.isFinite(coordinate)).toBe(true);
        }
      }
      for (const coordinate of facet.normal) {
        expect(Number.isFinite(coordinate)).toBe(true);
      }
    }
  });

  it('writes a per-facet normal recomputed from the transformed triangle, not the stored per-vertex normal', () => {
    // A cylinder side wall has smooth per-vertex normals that differ from its
    // flat per-triangle face normal, so this only passes if the exporter
    // derives the STL normal from the transformed triangle geometry.
    const doc = makeDocument([makeEntity({ primitive: { kind: 'cylinder', radius: 3, height: 5, segments: 16 } })]);
    const parsed = parseBinaryStl(exportDocumentToBinaryStl(doc));
    for (const facet of parsed.facets) {
      const [a, b, c] = facet.vertices;
      const u: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross: [number, number, number] = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const len = Math.hypot(cross[0], cross[1], cross[2]);
      const expected: [number, number, number] = [cross[0] / len, cross[1] / len, cross[2] / len];
      expect(facet.normal[0]).toBeCloseTo(expected[0], 4);
      expect(facet.normal[1]).toBeCloseTo(expected[1], 4);
      expect(facet.normal[2]).toBeCloseTo(expected[2], 4);
    }
  });

  it('excludes hidden entities from the export', () => {
    const doc = makeDocument([
      makeEntity({ id: 'visible', visible: true, primitive: { kind: 'box', width: 1, height: 1, depth: 1 } }),
      makeEntity({
        id: 'hidden',
        visible: false,
        primitive: { kind: 'box', width: 100, height: 100, depth: 100 },
      }),
    ]);
    const parsed = parseBinaryStl(exportDocumentToBinaryStl(doc));
    expect(parsed.triangleCount).toBe(12);
    const bounds = boundsOf(parsed.facets);
    expect(bounds.min).toEqual([-0.5, -0.5, -0.5]);
    expect(bounds.max).toEqual([0.5, 0.5, 0.5]);
  });

  it('exports an empty document as zero triangles', () => {
    const bytes = exportDocumentToBinaryStl(makeDocument([]));
    const parsed = parseBinaryStl(bytes);
    expect(parsed.triangleCount).toBe(0);
    expect(bytes.byteLength).toBe(HEADER_SIZE + 4);
  });

  it('matches the unit-box golden fixture on triangle count and world bounds', () => {
    const fixturePath = fileURLToPath(new URL('../../../tests/fixtures/unit-box.stl', import.meta.url));
    const fixtureBytes = new Uint8Array(readFileSync(fixturePath));
    const fixture = parseBinaryStl(fixtureBytes);

    const doc = makeDocument([makeEntity({ primitive: { kind: 'box', width: 1, height: 1, depth: 1 } })]);
    const actual = parseBinaryStl(exportDocumentToBinaryStl(doc));

    expect(actual.triangleCount).toBe(fixture.triangleCount);
    expect(boundsOf(actual.facets)).toEqual(boundsOf(fixture.facets));

    const sortedNormals = (facets: readonly ParsedFacet[]) =>
      facets
        .map((f) => f.normal.map((n) => Math.round(n)).join(','))
        .sort();
    expect(sortedNormals(actual.facets)).toEqual(sortedNormals(fixture.facets));
  });
});
