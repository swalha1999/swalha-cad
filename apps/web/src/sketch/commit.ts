import type { CadCommand, CadDocumentV2, SketchEntity } from '@swalha-cad/document';
import type { PointRef, SketchCommit } from './tools/types.js';

const COINCIDENT_EPSILON = 1e-6;

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= COINCIDENT_EPSILON;
}

/**
 * Translates a plane-local {@link SketchCommit} into a `feature.update` command
 * that appends new entities to the named sketch feature. New points that
 * coincide with an existing sketch point (or one created earlier in the same
 * commit) are merged so shared corners and chain joints become coincident by
 * id; zero-length lines are dropped. Returns `null` when the target feature is
 * missing/not a sketch, or when the commit produces no new geometry — the store
 * then skips the history entry entirely.
 */
export function buildSketchUpdateCommand(
  document: CadDocumentV2,
  featureId: string,
  commit: SketchCommit,
  createId: () => string,
  construction: boolean,
): CadCommand | null {
  const feature = document.features.find((candidate) => candidate.id === featureId);
  if (!feature || feature.kind !== 'sketch') return null;

  const existing = feature.entities;
  const created: SketchEntity[] = [];

  const findPoint = (x: number, y: number): string | null => {
    for (const entity of [...existing, ...created]) {
      if (entity.kind === 'point' && approxEqual(entity.x, x) && approxEqual(entity.y, y)) {
        return entity.id;
      }
    }
    return null;
  };

  const resolvePoint = (ref: PointRef): string => {
    if (ref.kind === 'existing') return ref.id;
    const reused = findPoint(ref.x, ref.y);
    if (reused) return reused;
    const id = createId();
    created.push({ id, kind: 'point', x: ref.x, y: ref.y, construction });
    return id;
  };

  const pointIds = commit.points.map(resolvePoint);

  for (const line of commit.lines) {
    const startId = pointIds[line.start];
    const endId = pointIds[line.end];
    if (startId === undefined || endId === undefined || startId === endId) continue;
    created.push({ id: createId(), kind: 'line', startId, endId, construction });
  }

  for (const circle of commit.circles) {
    const centerId = pointIds[circle.center];
    if (centerId === undefined) continue;
    created.push({ id: createId(), kind: 'circle', centerId, radius: circle.radius, construction });
  }

  if (created.length === 0) return null;

  return { type: 'feature.update', id: featureId, patch: { entities: [...existing, ...created] } };
}
