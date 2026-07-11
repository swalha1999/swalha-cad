import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { pickEntityId } from './pick-entity.js';

function buildScene() {
  const scene = new Scene();
  const mesh = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
  mesh.userData.entityId = 'entity-1';
  scene.add(mesh);

  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  return { scene, camera, mesh };
}

describe('pickEntityId', () => {
  it('returns the entity id of the mesh hit by a centered ray', () => {
    const { scene, camera } = buildScene();

    const result = pickEntityId({ camera, scene, ndcX: 0, ndcY: 0 });

    expect(result).toBe('entity-1');
  });

  it('returns undefined when the ray misses every object', () => {
    const { scene, camera } = buildScene();

    const result = pickEntityId({ camera, scene, ndcX: 0.99, ndcY: 0.99 });

    expect(result).toBeUndefined();
  });

  it('returns undefined for a hit object without an entityId tag', () => {
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
    scene.add(mesh);
    const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const result = pickEntityId({ camera, scene, ndcX: 0, ndcY: 0 });

    expect(result).toBeUndefined();
  });
});
