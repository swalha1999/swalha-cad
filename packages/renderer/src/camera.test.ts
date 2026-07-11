import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera } from 'three';
import {
  createOrthographicCamera,
  createPerspectiveCamera,
  resizeOrthographicCamera,
  resizePerspectiveCamera,
} from './camera.js';

describe('createPerspectiveCamera', () => {
  it('derives aspect from the viewport and applies default fov/near/far', () => {
    const camera = createPerspectiveCamera({ width: 800, height: 600 });

    expect(camera).toBeInstanceOf(PerspectiveCamera);
    expect(camera.aspect).toBeCloseTo(800 / 600, 10);
    expect(camera.fov).toBe(50);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(10000);
  });

  it('accepts fov/near/far overrides', () => {
    const camera = createPerspectiveCamera({ width: 400, height: 400 }, { fovDeg: 35, near: 1, far: 500 });

    expect(camera.fov).toBe(35);
    expect(camera.near).toBe(1);
    expect(camera.far).toBe(500);
  });

  it('computes a perspective projection matrix (row 3 encodes the w-divide)', () => {
    const camera = createPerspectiveCamera({ width: 800, height: 600 });
    const elements = camera.projectionMatrix.elements;

    expect(elements.every(Number.isFinite)).toBe(true);
    expect(elements[15]).toBe(0);
    expect(elements[11]).toBe(-1);
  });
});

describe('resizePerspectiveCamera', () => {
  it('updates aspect and recomputes the projection matrix', () => {
    const camera = createPerspectiveCamera({ width: 800, height: 600 });
    const before = camera.projectionMatrix.elements.slice();

    resizePerspectiveCamera(camera, { width: 400, height: 800 });

    expect(camera.aspect).toBeCloseTo(400 / 800, 10);
    expect(camera.projectionMatrix.elements).not.toEqual(before);
  });
});

describe('createOrthographicCamera', () => {
  it('derives a symmetric frustum from viewport aspect and view height', () => {
    const camera = createOrthographicCamera({ width: 800, height: 600 }, { viewHeight: 100 });
    const aspect = 800 / 600;

    expect(camera).toBeInstanceOf(OrthographicCamera);
    expect(camera.top).toBe(50);
    expect(camera.bottom).toBe(-50);
    expect(camera.right).toBeCloseTo(50 * aspect, 10);
    expect(camera.left).toBeCloseTo(-50 * aspect, 10);
  });

  it('computes an orthographic projection matrix (row 3 is affine, no w-divide)', () => {
    const camera = createOrthographicCamera({ width: 800, height: 600 }, { viewHeight: 100 });
    const elements = camera.projectionMatrix.elements;

    expect(elements.every(Number.isFinite)).toBe(true);
    expect(elements[15]).toBe(1);
    expect(elements[11]).toBe(0);
  });
});

describe('resizeOrthographicCamera', () => {
  it('recomputes the frustum for a new viewport and view height', () => {
    const camera = createOrthographicCamera({ width: 800, height: 600 }, { viewHeight: 100 });

    resizeOrthographicCamera(camera, { width: 200, height: 400 }, 40);

    expect(camera.top).toBe(20);
    expect(camera.bottom).toBe(-20);
    expect(camera.right).toBeCloseTo(20 * (200 / 400), 10);
    expect(camera.left).toBeCloseTo(-20 * (200 / 400), 10);
  });
});
