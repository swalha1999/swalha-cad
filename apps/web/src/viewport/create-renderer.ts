import { WebGLRenderer } from 'three';

/**
 * Isolated so tests can mock WebGL context creation, which jsdom cannot
 * provide, without mocking the rest of three.js. `alpha: true` with a
 * transparent clear color lets the viewport's CSS gradient show through
 * behind the rendered geometry instead of duplicating that color in WebGL.
 * `preserveDrawingBuffer: true` keeps the canvas's backbuffer readable
 * outside the render loop (screenshots, pixel probes, future thumbnailing).
 */
export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  return renderer;
}
