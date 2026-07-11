import { describe, expect, it } from 'vitest';
import { parseCadCommand } from './commands.js';
import type { CadEntity } from './types.js';

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
});
