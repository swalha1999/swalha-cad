import type { Camera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Isolated so tests can substitute a spy without driving real DOM pointer capture. */
export function createOrbitControls(camera: Camera, domElement: HTMLElement): OrbitControls {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  controls.update();
  return controls;
}
