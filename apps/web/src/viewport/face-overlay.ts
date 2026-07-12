/**
 * Builds a flat, non-indexed position buffer for the triangles of one semantic
 * face, ready to drop into a lightweight highlight mesh. `index` is the owning
 * body geometry's triangle index, `positions` its vertex positions (both in the
 * body's local geometry space), and `triangles` the face's triangle indices
 * (see {@link EvaluatedFace}). Positions are copied — never shared with the body
 * geometry's buffers — so the resulting overlay geometry can be disposed
 * independently without freeing the body's GPU resources.
 */
export function faceOverlayPositions(
  index: ArrayLike<number>,
  positions: ArrayLike<number>,
  triangles: readonly number[],
): Float32Array {
  const out = new Float32Array(triangles.length * 9);
  let o = 0;
  for (const triangle of triangles) {
    for (let k = 0; k < 3; k++) {
      const vertex = index[triangle * 3 + k]!;
      out[o++] = positions[vertex * 3]!;
      out[o++] = positions[vertex * 3 + 1]!;
      out[o++] = positions[vertex * 3 + 2]!;
    }
  }
  return out;
}
