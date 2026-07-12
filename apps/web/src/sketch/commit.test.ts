import type { CadDocumentV2, SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { buildSketchUpdateCommand } from './commit.js';
import type { SketchCommit } from './tools/types.js';

function documentWithSketch(entities: SketchFeature['entities'] = []): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [],
    features: [{ id: 'sketch-1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities, constraints: [], visible: true }],
  };
}

/** Deterministic id generator for assertions. */
function counterIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe('buildSketchUpdateCommand', () => {
  it('appends new points, lines, and circles as a feature.update patch', () => {
    const commit: SketchCommit = {
      points: [
        { kind: 'new', x: 0, y: 0 },
        { kind: 'new', x: 10, y: 0 },
      ],
      lines: [{ start: 0, end: 1 }],
      circles: [],
    };

    const command = buildSketchUpdateCommand(documentWithSketch(), 'sketch-1', commit, counterIds(), false);

    expect(command).toEqual({
      type: 'feature.update',
      id: 'sketch-1',
      patch: {
        entities: [
          { id: 'id-1', kind: 'point', x: 0, y: 0, construction: false },
          { id: 'id-2', kind: 'point', x: 10, y: 0, construction: false },
          { id: 'id-3', kind: 'line', startId: 'id-1', endId: 'id-2', construction: false },
        ],
      },
    });
  });

  it('merges a new point that coincides with an existing sketch point', () => {
    const document = documentWithSketch([{ id: 'p0', kind: 'point', x: 0, y: 0, construction: false }]);
    const commit: SketchCommit = {
      points: [
        { kind: 'new', x: 0, y: 0 },
        { kind: 'new', x: 20, y: 0 },
      ],
      lines: [{ start: 0, end: 1 }],
      circles: [],
    };

    const command = buildSketchUpdateCommand(document, 'sketch-1', commit, counterIds(), false);
    const patch = command?.type === 'feature.update' ? (command.patch as { entities: SketchFeature['entities'] }) : null;

    // The coincident corner reuses p0 rather than adding a duplicate point.
    expect(patch?.entities.filter((entity) => entity.kind === 'point')).toHaveLength(2);
    const line = patch?.entities.find((entity) => entity.kind === 'line');
    expect(line).toMatchObject({ startId: 'p0' });
  });

  it('materialises an arc referencing its resolved center point id', () => {
    const document = documentWithSketch([{ id: 'p0', kind: 'point', x: 0, y: 0, construction: false }]);
    const commit: SketchCommit = {
      points: [{ kind: 'existing', id: 'p0' }],
      lines: [],
      circles: [],
      arcs: [{ center: 0, radius: 5, startAngle: 0, endAngle: Math.PI / 2, direction: 'ccw' }],
    };

    const command = buildSketchUpdateCommand(document, 'sketch-1', commit, counterIds(), false);
    const entities = command?.type === 'feature.update' ? (command.patch as { entities: SketchFeature['entities'] }).entities : [];
    const arc = entities.find((entity) => entity.kind === 'arc');
    expect(arc).toMatchObject({ kind: 'arc', centerId: 'p0', radius: 5, startAngle: 0, direction: 'ccw', construction: false });
  });

  it('tags a committed arc as construction when requested', () => {
    const command = buildSketchUpdateCommand(
      documentWithSketch(),
      'sketch-1',
      { points: [{ kind: 'new', x: 1, y: 1 }], lines: [], circles: [], arcs: [{ center: 0, radius: 3, startAngle: 0, endAngle: 1, direction: 'cw' }] },
      counterIds(),
      true,
    );
    const entities = command?.type === 'feature.update' ? (command.patch as { entities: SketchFeature['entities'] }).entities : [];
    expect(entities.every((entity) => entity.construction)).toBe(true);
    expect(entities.some((entity) => entity.kind === 'arc')).toBe(true);
  });

  it('tags created geometry as construction when requested', () => {
    const command = buildSketchUpdateCommand(
      documentWithSketch(),
      'sketch-1',
      { points: [{ kind: 'new', x: 1, y: 1 }], lines: [], circles: [{ center: 0, radius: 5 }] },
      counterIds(),
      true,
    );
    const entities = command?.type === 'feature.update' ? (command.patch as { entities: SketchFeature['entities'] }).entities : [];
    expect(entities.every((entity) => entity.construction)).toBe(true);
  });

  it('drops zero-length lines whose endpoints resolve to the same point', () => {
    const document = documentWithSketch([{ id: 'p0', kind: 'point', x: 0, y: 0, construction: false }]);
    const commit: SketchCommit = {
      points: [{ kind: 'existing', id: 'p0' }, { kind: 'new', x: 0, y: 0 }],
      lines: [{ start: 0, end: 1 }],
      circles: [],
    };

    const command = buildSketchUpdateCommand(document, 'sketch-1', commit, counterIds(), false);
    expect(command).toBeNull();
  });

  it('returns null when the target feature is missing or not a sketch', () => {
    expect(
      buildSketchUpdateCommand(documentWithSketch(), 'missing', { points: [], lines: [], circles: [] }, counterIds(), false),
    ).toBeNull();
  });
});
