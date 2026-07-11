import { describe, expect, it } from 'vitest';
import { parseCadCommand } from './commands.js';
import type { CadEntity, ExtrudeFeature, SketchFeature } from './types.js';

function boxEntity(id: string): CadEntity {
  return {
    id,
    name: 'box',
    primitive: { kind: 'box', width: 10, height: 20, depth: 30 },
    transform: {
      translation: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    },
    visible: true,
  };
}

function circleSketch(id: string): SketchFeature {
  return {
    id,
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    entities: [
      { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'circ1', kind: 'circle', centerId: 'p1', radius: 5, construction: false },
    ],
    constraints: [{ id: 'c1', kind: 'radius', circleId: 'circ1', value: 5 }],
    visible: true,
  };
}

function extrudeFeature(id: string, sketchId: string): ExtrudeFeature {
  return {
    id,
    kind: 'extrude',
    name: 'Extrude 1',
    sketchId,
    depth: 20,
    direction: 'normal',
    visible: true,
  };
}

describe('parseCadCommand', () => {
  it('accepts a valid entity.create command', () => {
    const command = { type: 'entity.create', entity: boxEntity('entity-1') };

    const result = parseCadCommand(command);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(command);
    }
  });

  it('accepts a valid entity.update command with a partial patch', () => {
    const command = {
      type: 'entity.update',
      id: 'entity-1',
      patch: { name: 'renamed', visible: false },
    };

    const result = parseCadCommand(command);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(command);
    }
  });

  it('accepts an entity.update command with an empty patch', () => {
    const command = { type: 'entity.update', id: 'entity-1', patch: {} };

    const result = parseCadCommand(command);

    expect(result.success).toBe(true);
  });

  it('accepts a valid entity.delete command', () => {
    const command = { type: 'entity.delete', id: 'entity-1' };

    const result = parseCadCommand(command);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(command);
    }
  });

  it('rejects an unknown command type', () => {
    const result = parseCadCommand({ type: 'entity.rename', id: 'entity-1' });

    expect(result.success).toBe(false);
  });

  it('rejects an entity.create command with an invalid entity', () => {
    const command = {
      type: 'entity.create',
      entity: { ...boxEntity('entity-1'), primitive: { kind: 'box', width: -1, height: 20, depth: 30 } },
    };

    const result = parseCadCommand(command);

    expect(result.success).toBe(false);
  });

  it('rejects an entity.update command whose patch tries to change the id', () => {
    const command = { type: 'entity.update', id: 'entity-1', patch: { id: 'entity-2' } };

    const result = parseCadCommand(command);

    expect(result.success).toBe(false);
  });

  it('rejects an entity.update command with an invalid patch primitive', () => {
    const command = {
      type: 'entity.update',
      id: 'entity-1',
      patch: { primitive: { kind: 'cylinder', radius: 0, height: 15, segments: 16 } },
    };

    const result = parseCadCommand(command);

    expect(result.success).toBe(false);
  });

  it('round-trips a command through JSON without data loss', () => {
    const command = { type: 'entity.create', entity: boxEntity('entity-1') };

    const result = parseCadCommand(command);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const roundTripped = JSON.parse(JSON.stringify(result.data));
    expect(roundTripped).toEqual(command);
  });

  describe('feature commands', () => {
    it('accepts a valid feature.create command with a sketch feature', () => {
      const command = { type: 'feature.create', feature: circleSketch('sketch-1') };

      const result = parseCadCommand(command);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(command);
      }
    });

    it('accepts a valid feature.create command with an extrude feature', () => {
      const command = { type: 'feature.create', feature: extrudeFeature('extrude-1', 'sketch-1') };

      const result = parseCadCommand(command);

      expect(result.success).toBe(true);
    });

    it('rejects a feature.create command with a sketch containing dangling references', () => {
      const sketch = circleSketch('sketch-1');
      const command = {
        type: 'feature.create',
        feature: { ...sketch, entities: [{ id: 'circ1', kind: 'circle', centerId: 'missing', radius: 5, construction: false }] },
      };

      expect(parseCadCommand(command).success).toBe(false);
    });

    it('rejects a feature.create command with an invalid extrude depth', () => {
      const command = { type: 'feature.create', feature: extrudeFeature('extrude-1', 'sketch-1') };
      const invalid = { ...command, feature: { ...command.feature, depth: -5 } };

      expect(parseCadCommand(invalid).success).toBe(false);
    });

    it('accepts a valid feature.update command with a sketch patch', () => {
      const command = { type: 'feature.update', id: 'sketch-1', patch: { name: 'Renamed sketch', visible: false } };

      const result = parseCadCommand(command);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(command);
      }
    });

    it('accepts a valid feature.update command with an extrude patch', () => {
      const command = { type: 'feature.update', id: 'extrude-1', patch: { depth: 30, direction: 'symmetric' } };

      expect(parseCadCommand(command).success).toBe(true);
    });

    it('accepts a feature.update command with an empty patch', () => {
      const command = { type: 'feature.update', id: 'feature-1', patch: {} };

      expect(parseCadCommand(command).success).toBe(true);
    });

    it('rejects a feature.update command whose patch tries to change the id', () => {
      const command = { type: 'feature.update', id: 'feature-1', patch: { id: 'feature-2' } };

      expect(parseCadCommand(command).success).toBe(false);
    });

    it('rejects a feature.update command whose patch tries to change the kind', () => {
      const command = { type: 'feature.update', id: 'feature-1', patch: { kind: 'extrude' } };

      expect(parseCadCommand(command).success).toBe(false);
    });

    it('rejects a feature.update command with an invalid patch value', () => {
      const command = { type: 'feature.update', id: 'extrude-1', patch: { depth: -5 } };

      expect(parseCadCommand(command).success).toBe(false);
    });

    it('accepts a valid feature.delete command', () => {
      const command = { type: 'feature.delete', id: 'feature-1' };

      const result = parseCadCommand(command);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(command);
      }
    });

    it('round-trips a feature.create command through JSON without data loss', () => {
      const command = { type: 'feature.create', feature: circleSketch('sketch-1') };

      const result = parseCadCommand(command);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const roundTripped = JSON.parse(JSON.stringify(result.data));
      expect(roundTripped).toEqual(command);
    });
  });
});
