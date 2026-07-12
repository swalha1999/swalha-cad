import type { SketchFeature } from '@swalha-cad/document';
import { pickCurve, type Point } from './curves.js';
import { applyTrim, computeTrim } from './trim.js';
import type { SketchEdit } from './trim.js';
import { applySplit, computeSplit } from './split.js';
import { applyExtend, computeExtend } from './extend.js';

/**
 * The store/overlay-facing surface of the sketch Modify tools. Given the active
 * tool and a plane-local cursor/click point it resolves the curve under the
 * cursor, previews the exact portion the tool would affect, and (on click)
 * produces one deterministic `{entities, constraints}` edit for the store to apply
 * through a single history command. All heavy geometry lives in the pure
 * trim/split/curves modules; this file only routes and shapes results.
 */

export type ModifyTool = 'trim' | 'split' | 'extend';

/** How near (mm) the cursor must be to a line/arc for it to be the modify target. */
export const MODIFY_PICK_DISTANCE = 5;

/** The hover feedback a modify tool renders for the curve under the cursor. */
export interface ModifyPreview {
  readonly tool: ModifyTool;
  readonly targetId: string;
  /** Trim: the sampled polyline of the piece a click would remove. */
  readonly removedPolyline?: readonly Point[];
  /** Split: the point a click would split the curve at. */
  readonly splitPoint?: Point;
  /** Extend: the sampled polyline of the added extension a click would commit. */
  readonly extensionPolyline?: readonly Point[];
  /** Extend: the boundary point the extension reaches. */
  readonly hitPoint?: Point;
  /** True when a click would mutate; false shows `message` as a cursor-local diagnostic. */
  readonly valid: boolean;
  readonly message?: string;
}

/** The result of applying a modify tool at a click point. */
export type ModifyOutcome =
  | { readonly ok: true; readonly targetId: string; readonly edit: SketchEdit; readonly note?: string }
  | { readonly ok: false; readonly message: string };

/** Previews what the active modify tool would do at the cursor, or `null` when no curve is under it. */
export function modifyPreview(sketch: SketchFeature, tool: ModifyTool, cursor: Point): ModifyPreview | null {
  const target = pickCurve(sketch, cursor, MODIFY_PICK_DISTANCE);
  if (!target) return null;
  if (tool === 'trim') {
    const result = computeTrim(sketch, target, cursor);
    return result.ok
      ? { tool, targetId: target.id, removedPolyline: result.plan.removedPolyline, valid: true }
      : { tool, targetId: target.id, valid: false, message: result.message };
  }
  if (tool === 'extend') {
    const result = computeExtend(sketch, target, cursor);
    return result.ok
      ? {
          tool,
          targetId: target.id,
          extensionPolyline: result.plan.extensionPolyline,
          hitPoint: result.plan.hitPoint,
          valid: true,
        }
      : { tool, targetId: target.id, valid: false, message: result.message };
  }
  const result = computeSplit(sketch, target, cursor);
  return result.ok
    ? { tool, targetId: target.id, splitPoint: result.plan.point, valid: true }
    : { tool, targetId: target.id, valid: false, message: result.message };
}

/** Applies the active modify tool at a click point, producing an edit or a diagnostic. */
export function applyModify(
  sketch: SketchFeature,
  tool: ModifyTool,
  clickPoint: Point,
  createId: () => string,
): ModifyOutcome {
  const target = pickCurve(sketch, clickPoint, MODIFY_PICK_DISTANCE);
  if (!target) return { ok: false, message: 'Hover a line or arc to modify.' };
  if (tool === 'trim') {
    const result = computeTrim(sketch, target, clickPoint);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, targetId: target.id, edit: applyTrim(sketch, result.plan, createId) };
  }
  if (tool === 'extend') {
    const result = computeExtend(sketch, target, clickPoint);
    if (!result.ok) return { ok: false, message: result.message };
    const edit = applyExtend(sketch, result.plan, createId);
    const removed = edit.removedConstraintIds.length;
    const outcome: ModifyOutcome = {
      ok: true,
      targetId: target.id,
      edit: { entities: edit.entities, constraints: edit.constraints },
    };
    return removed > 0
      ? { ...outcome, note: `Removed ${removed} constraint${removed === 1 ? '' : 's'} invalidated by the extension.` }
      : outcome;
  }
  const result = computeSplit(sketch, target, clickPoint);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, targetId: target.id, edit: applySplit(sketch, result.plan, createId) };
}

export type { SketchEdit } from './trim.js';
export type { Point } from './curves.js';
