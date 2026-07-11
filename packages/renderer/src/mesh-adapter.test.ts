import { buildBoxMesh, computeMeshBounds, triangleCount, vertexCount } from '@swalha-cad/geometry';
import { describe, expect, it } from 'vitest';
import { createBufferGeometry } from './mesh-adapter.js';

describe('createBufferGeometry', () => {
  it('wires the mesh position/normal arrays into buffer attributes without copying', () => {
    const mesh = buildBoxMesh(10, 20, 30);
    const geometry = createBufferGeometry(mesh);

    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');

    expect(position.array).toBe(mesh.positions);
    expect(normal.array).toBe(mesh.normals);
    expect(position.itemSize).toBe(3);
    expect(normal.itemSize).toBe(3);
    expect(position.count).toBe(vertexCount(mesh));
  });

  it('wires the mesh index buffer into the geometry index without copying', () => {
    const mesh = buildBoxMesh(10, 20, 30);
    const geometry = createBufferGeometry(mesh);

    expect(geometry.index).not.toBeNull();
    expect(geometry.index!.array).toBe(mesh.indices);
    expect(geometry.index!.count).toBe(mesh.indices.length);
    expect(geometry.index!.count / 3).toBe(triangleCount(mesh));
  });

  it('produces a bounding box matching the mesh bounds', () => {
    const mesh = buildBoxMesh(10, 20, 30);
    const geometry = createBufferGeometry(mesh);

    geometry.computeBoundingBox();
    const bounds = computeMeshBounds(mesh);

    expect(geometry.boundingBox).not.toBeNull();
    expect([geometry.boundingBox!.min.x, geometry.boundingBox!.min.y, geometry.boundingBox!.min.z]).toEqual([
      ...bounds.min,
    ]);
    expect([geometry.boundingBox!.max.x, geometry.boundingBox!.max.y, geometry.boundingBox!.max.z]).toEqual([
      ...bounds.max,
    ]);
  });

  it('disposes without throwing', () => {
    const mesh = buildBoxMesh(10, 20, 30);
    const geometry = createBufferGeometry(mesh);

    expect(() => geometry.dispose()).not.toThrow();
  });
});
