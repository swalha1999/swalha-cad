import type { CadDocumentV2, ExtrudeFeature, SketchFeature } from '@swalha-cad/document';
import { extrudeSketch } from '@swalha-cad/geometry';

/**
 * The transient state of the contextual Extrude task while its panel owns the
 * workspace. Purely interaction state: nothing here touches the document until
 * the task is confirmed, so cancelling restores the exact prior state and a
 * confirm commits exactly one feature command. `editingFeatureId` is the id of
 * the extrude feature being edited (double-click / context Edit), or `null` for
 * a brand-new extrusion; `sketchId` is the source collector's chosen sketch.
 */
export interface ExtrudeSession {
  readonly editingFeatureId: string | null;
  readonly sketchId: string | null;
  readonly depth: number;
  readonly direction: 'normal' | 'symmetric';
  readonly reverse: boolean;
}

/** Depth bounds the numeric field and the in-canvas manipulator share (mm). */
export const MIN_EXTRUDE_DEPTH = 0.1;
export const MAX_EXTRUDE_DEPTH = 1000;
export const DEFAULT_EXTRUDE_DEPTH = 25;

/**
 * The id carried by the candidate feature while previewing a brand-new
 * extrusion. It never reaches the committed document — it exists only so the
 * live preview renders through the same evaluate → scene-sync pipeline as a real
 * feature, keyed distinctly from the id the confirmed feature will receive.
 */
export const PREVIEW_EXTRUDE_ID = '__extrude_preview__';

/** All sketch features in a document, the candidate sources the collector offers. */
export function listSketchFeatures(document: CadDocumentV2): SketchFeature[] {
  return document.features.filter((feature): feature is SketchFeature => feature.kind === 'sketch');
}

function findSketch(document: CadDocumentV2, sketchId: string | null): SketchFeature | null {
  if (!sketchId) return null;
  const feature = document.features.find((candidate) => candidate.id === sketchId);
  return feature && feature.kind === 'sketch' ? feature : null;
}

function findExtrude(document: CadDocumentV2, featureId: string | null): ExtrudeFeature | null {
  if (!featureId) return null;
  const feature = document.features.find((candidate) => candidate.id === featureId);
  return feature && feature.kind === 'extrude' ? feature : null;
}

function depthIsValid(depth: number): boolean {
  return Number.isFinite(depth) && depth > 0;
}

/**
 * The extrude feature a session currently describes, or `null` when it is not
 * yet buildable (no source sketch, or a non-positive depth). Editing keeps the
 * existing feature's id and name; a new extrusion uses the transient preview id.
 */
export function candidateExtrudeFeature(document: CadDocumentV2, session: ExtrudeSession): ExtrudeFeature | null {
  if (!session.sketchId || !depthIsValid(session.depth)) return null;
  const editing = findExtrude(document, session.editingFeatureId);
  return {
    id: session.editingFeatureId ?? PREVIEW_EXTRUDE_ID,
    kind: 'extrude',
    name: editing?.name ?? 'Extrude',
    sketchId: session.sketchId,
    depth: session.depth,
    direction: session.direction,
    reverse: session.reverse,
    visible: true,
  };
}

/**
 * The document a viewport should render while an extrude task is active: the
 * committed document augmented with the candidate solid so the preview flows
 * through the normal evaluate/scene-sync path. Editing replaces the feature in
 * place (same id → no double geometry); a new extrusion appends the transient
 * preview feature. Returns the input document unchanged (same reference) when
 * there is no session or the candidate is not yet buildable, so callers that
 * memoize on identity never re-sync needlessly.
 */
export function buildExtrudePreviewDocument(document: CadDocumentV2, session: ExtrudeSession | null): CadDocumentV2 {
  if (!session) return document;
  const candidate = candidateExtrudeFeature(document, session);
  if (!candidate) return document;
  if (session.editingFeatureId) {
    return { ...document, features: document.features.map((feature) => (feature.id === candidate.id ? candidate : feature)) };
  }
  return { ...document, features: [...document.features, candidate] };
}

export type ExtrudeValidationStatus = 'ok' | 'no-source' | 'error';

/** Whether a session can be confirmed, with a human diagnostic when it cannot. */
export interface ExtrudeValidation {
  readonly status: ExtrudeValidationStatus;
  readonly message: string | null;
}

/**
 * Validates a session against its source sketch: reports a missing source, an
 * out-of-range depth, or a structured profile error (open / self-intersecting /
 * ambiguous / degenerate) as the reason confirmation is blocked, or `ok` when
 * the extrusion would produce a solid.
 */
export function validateExtrudeSession(document: CadDocumentV2, session: ExtrudeSession): ExtrudeValidation {
  if (!session.sketchId) return { status: 'no-source', message: 'Select a source sketch region to extrude.' };
  const sketch = findSketch(document, session.sketchId);
  if (!sketch) return { status: 'error', message: 'The selected sketch no longer exists.' };
  if (!depthIsValid(session.depth)) {
    return { status: 'error', message: 'Depth must be a positive length in millimetres.' };
  }
  const result = extrudeSketch(sketch, { depth: session.depth, direction: session.direction, reverse: session.reverse });
  if (!result.ok) return { status: 'error', message: result.error.message };
  return { status: 'ok', message: null };
}
