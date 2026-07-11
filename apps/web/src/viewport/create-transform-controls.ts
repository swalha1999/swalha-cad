import type { Camera } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

/** Isolated so tests can substitute a spy without driving real DOM pointer capture. */
export function createTransformControls(camera: Camera, domElement: HTMLElement): TransformControls {
  const controls = new TransformControls(camera, domElement);
  controls.setSize(0.8);
  return controls;
}
