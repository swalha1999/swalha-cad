import { describe, expect, it } from 'vitest';
import { add, cross, dot, length, normalize, scale, subtract } from './vec3.js';

describe('vec3', () => {
  it('adds two vectors component-wise', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
  });

  it('subtracts two vectors component-wise', () => {
    expect(subtract([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
  });

  it('scales a vector by a scalar', () => {
    expect(scale([1, -2, 3], 2)).toEqual([2, -4, 6]);
  });

  it('computes the dot product', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('computes the cross product of orthonormal basis vectors', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });

  it('computes the cross product of arbitrary vectors', () => {
    expect(cross([2, 3, 4], [5, 6, 7])).toEqual([-3, 6, -3]);
  });

  it('computes the euclidean length (norm) of a vector', () => {
    expect(length([3, 4, 0])).toBe(5);
  });

  it('normalizes a vector to unit length', () => {
    const result = normalize([3, 4, 0]);
    expect(result[0]).toBeCloseTo(0.6, 6);
    expect(result[1]).toBeCloseTo(0.8, 6);
    expect(result[2]).toBeCloseTo(0, 6);
    expect(length(result)).toBeCloseTo(1, 6);
  });

  it('normalizes a zero-length vector to the zero vector rather than NaN', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
