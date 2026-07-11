import { describe, expect, it } from 'vitest';
import { isClick } from './is-click.js';

describe('isClick', () => {
  it('is a click when the pointer did not move', () => {
    expect(isClick({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
  });

  it('is a click when movement is within the default threshold', () => {
    expect(isClick({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(true);
  });

  it('is not a click once movement exceeds the default threshold', () => {
    expect(isClick({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(false);
  });

  it('honors a custom threshold', () => {
    expect(isClick({ x: 0, y: 0 }, { x: 5, y: 0 }, 10)).toBe(true);
    expect(isClick({ x: 0, y: 0 }, { x: 5, y: 0 }, 2)).toBe(false);
  });
});
