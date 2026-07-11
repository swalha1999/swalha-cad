import { WebGLRenderer } from 'three';

/**
 * Isolated so tests can mock WebGL context creation, which jsdom cannot
 * provide, without mocking the rest of three.js.
 */
export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  return new WebGLRenderer({ canvas, antialias: true });
}
