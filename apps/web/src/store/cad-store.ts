import type {
  CadCommand,
  CadDocumentV2,
  CadEntity,
  CadEntityPatch,
  CadFeature,
  CommandHistory,
  DeletionPlan,
  DeletionTarget,
  ExtrudeFeature,
  Primitive,
  SketchConstraint,
  SketchFeature,
  SketchPlane,
  Transform,
} from '@swalha-cad/document';
import {
  applyCommandToHistory,
  canRedo as computeCanRedo,
  canUndo as computeCanUndo,
  createHistory,
  parseCadCommand,
  planDeletion,
  redo as historyRedo,
  undo as historyUndo,
} from '@swalha-cad/document';
import type { SolveDiagnostic, SolveStatus } from '@swalha-cad/geometry';
import { solveSketch } from '@swalha-cad/geometry';
import { createStore } from 'zustand/vanilla';
import { buildSketchUpdateCommand } from '../sketch/commit.js';
import { applyConstructionToggle } from '../sketch/construction.js';
import { removeSketchEntities } from '../sketch/delete.js';
import type { NewConstraint } from '../sketch/constraint-actions.js';
import { pickForDimension, resolveFromSelection } from '../sketch/dimension.js';
import { lineTangentAtPoint } from '../sketch/tangent.js';
import { DEFAULT_SNAP_SETTINGS } from '../sketch/snap-settings.js';
import type { SnapSettings, SnapTarget } from '../sketch/snap-settings.js';
import {
  DEFAULT_EXTRUDE_DEPTH,
  MAX_EXTRUDE_DEPTH,
  MIN_EXTRUDE_DEPTH,
  listSketchFeatures,
  validateExtrudeSession,
} from '../features/extrude-session.js';
import type { ExtrudeSession, ExtrudeValidation } from '../features/extrude-session.js';
import { advanceTool, initialToolState } from '../sketch/tools/index.js';
import { DEFAULT_POLYGON_SIDES } from '../sketch/tools/types.js';
import type { SketchToolKind, SnapKind, ToolEvent, ToolState, Vec2 } from '../sketch/tools/types.js';

export type CameraProjection = 'perspective' | 'orthographic';

/**
 * The transient state of the Onshape-style Distance/Dimension tool while it owns
 * the sketch. `picking` is the command-first phase collecting geometry (a line,
 * or the first of two points); `awaiting` holds a resolved point pair and its
 * current measured length (mm) while the inline numeric editor is open. Purely
 * interaction state — a value is only committed (through history) on Enter.
 */
export type DimensionState =
  | { phase: 'picking'; points: string[] }
  | { phase: 'awaiting'; pointA: string; pointB: string; measured: number };

/** The result of committing a dimension value, so the inline editor can react (apply and close, or show why it was rejected). */
export interface DimensionOutcome {
  applied: boolean;
  reason: 'applied' | 'invalid' | 'conflict' | 'redundant' | 'not-ready';
  status: SolveStatus | null;
  message: string | null;
}

/**
 * The live state of an in-progress sketch on an origin plane. `featureId` names
 * the `SketchFeature` (already created in the document/history) whose geometry
 * the workspace edits; `tool`/`toolState` drive the deterministic interaction
 * state machine; `cursor`/`cursorSnap` back the overlay's snap indicator. Every
 * committed action still flows through the feature-command history — this slice
 * only holds transient interaction state, never geometry.
 */
export interface SketchSession {
  featureId: string;
  plane: SketchPlane;
  tool: SketchToolKind | null;
  toolState: ToolState | null;
  construction: boolean;
  /** Desired side count for the regular-polygon tool; seeds each new polygon tool state. */
  polygonSides: number;
  cursor: Vec2 | null;
  cursorSnap: SnapKind | null;
  /** Non-null while the Distance/Dimension tool owns the sketch (see {@link DimensionState}). */
  dimension: DimensionState | null;
}

/**
 * The live constraint state of the active sketch, recomputed from the committed
 * geometry after every mutating action. `status` drives the blue/dark/red visual
 * convention; `diagnostics` identify the conflicting constraints when a solve
 * fails to converge.
 */
export interface SketchSolveState {
  status: SolveStatus;
  remainingDof: number;
  diagnostics: readonly SolveDiagnostic[];
}

/** The result of applying or editing a constraint, for callers that surface a message. */
export interface ConstraintOutcome {
  /** True when the change reached the document (including a committed conflict); false when validation rejected it outright. */
  applied: boolean;
  status: SolveStatus | 'invalid' | null;
  message: string | null;
}

/** The result of confirming an extrude task, for callers that surface a message. */
export interface ExtrudeOutcome {
  /** True when exactly one feature command reached history; false when validation rejected it. */
  committed: boolean;
  /** The created or edited extrude feature's id when committed, else `null`. */
  featureId: string | null;
  message: string | null;
}

export interface CadStoreState {
  document: CadDocumentV2;
  history: CommandHistory;
  selectedEntityId: string | null;
  /** Selected feature id (a sketch or a derived solid's owning feature); mutually exclusive with {@link selectedEntityId}. */
  selectedFeatureId: string | null;
  /**
   * Body/feature id under hover, synchronized between the viewport and the
   * feature tree so pointing at one visibly highlights the other. Purely
   * transient feedback — never routed through history.
   */
  hoveredId: string | null;
  /**
   * A resolved deletion awaiting confirmation because it would cascade to
   * downstream dependents; `null` when no impact dialog is open. Independent
   * deletions never populate this — they apply immediately.
   */
  pendingDeletion: DeletionPlan | null;
  cameraProjection: CameraProjection;
  canUndo: boolean;
  canRedo: boolean;
  /** Non-null while the focused 2D sketch workspace is active. */
  sketch: SketchSession | null;
  /**
   * Non-null while the contextual Extrude task panel is open (creating or
   * editing an extrusion). Purely transient: the document is not mutated until
   * {@link confirmExtrude}, so {@link cancelExtrude} restores the exact prior
   * state and a live preview is derived, never committed.
   */
  extrude: ExtrudeSession | null;
  /** Selected sketch entity ids (points/lines/circles) driving constraint availability; empty outside sketch mode. */
  sketchSelection: string[];
  /** The constraint whose dimension the properties panel is editing, or `null`. */
  selectedConstraintId: string | null;
  /** Live solver status/diagnostics for the active sketch, or `null` outside sketch mode. */
  sketchSolve: SketchSolveState | null;
  /**
   * Independent, opt-in snap aids for the free-coordinate canvas. Held at the
   * store top level so a toggle persists across leaving and re-entering sketch
   * mode (and across document loads) for the whole app session.
   */
  snapSettings: SnapSettings;
  /** Whether the sketch grid is drawn. Purely a visual aid — independent of grid snapping. */
  gridVisible: boolean;
  selectEntity: (id: string | null) => void;
  /** Selects (or clears with `null`) a feature; validates the id and clears any entity selection. */
  selectFeature: (id: string | null) => void;
  /** Selects whichever object a body id names — an entity, or the feature that owns a derived solid — clearing selection when `null`. */
  selectBody: (bodyId: string | null) => void;
  /** Clears both entity and feature selection (e.g. a click on empty viewport). */
  clearSelection: () => void;
  /** Sets (or clears) the hovered body/feature id shared by the viewport and tree. */
  setHovered: (id: string | null) => void;
  /**
   * Deletes the current selection, resolving downstream dependents: independent
   * objects delete immediately; a feature with dependents opens an impact
   * confirmation instead. No-op when nothing is selected.
   */
  deleteSelected: () => void;
  /** Requests deletion of a specific target (used by the tree context menu / trash action). */
  requestDelete: (target: DeletionTarget) => void;
  /** Applies the pending cascade deletion as one atomic transaction. */
  confirmDeletion: () => void;
  /** Dismisses the pending deletion without changing the document. */
  cancelDeletion: () => void;
  setCameraProjection: (projection: CameraProjection) => void;
  createEntity: (kind: Primitive['kind']) => string;
  updateEntity: (id: string, patch: CadEntityPatch) => boolean;
  loadDocument: (document: CadDocumentV2) => void;
  undo: () => void;
  redo: () => void;
  /** Creates a `SketchFeature` on `plane` through history and enters sketch mode; returns its id. */
  enterSketch: (plane: SketchPlane) => string;
  /** Selects (or clears with `null`) the active drawing tool, resetting its pending step. */
  setSketchTool: (tool: SketchToolKind | null) => void;
  /** Toggles whether newly drawn geometry is construction geometry. */
  setSketchConstruction: (construction: boolean) => void;
  /**
   * The construction toggle's combined behaviour: with sketch entities selected,
   * flips their construction flag through history (a mixed selection all becomes
   * construction); with nothing selected, flips the mode for newly drawn geometry.
   */
  toggleConstruction: () => void;
  /** Sets the regular-polygon side count (clamped to at least 3), updating any active polygon tool. */
  setSketchPolygonSides: (sides: number) => void;
  /** Feeds one interaction event to the active tool, committing any produced geometry through history. */
  dispatchSketchEvent: (event: ToolEvent) => void;
  /** Toggles a sketch entity's membership in the constraint selection; no-op for ids outside the active sketch. */
  toggleSketchEntitySelection: (id: string) => void;
  /** Replaces the sketch selection with the given ids (those present in the active sketch). */
  setSketchSelection: (ids: string[]) => void;
  /** Clears the sketch entity selection. */
  clearSketchSelection: () => void;
  /** Selects (or clears) the constraint whose dimension the properties panel edits. */
  selectConstraint: (id: string | null) => void;
  /**
   * Activates the Distance/Dimension tool (the D shortcut). A distance-eligible
   * selection (one line or two points) jumps straight to the inline value
   * editor; otherwise the tool waits to pick geometry. Toggles off if already
   * active. Deactivates any drawing tool. No-op outside sketch mode.
   */
  startDimension: () => void;
  /** Feeds a clicked entity id to the dimension tool's picking phase (a line, or one of two points). No-op unless picking. */
  dimensionPick: (id: string) => void;
  /**
   * Commits the awaiting dimension's typed value as a driving distance
   * constraint through a `feature.update` command, re-solving and updating
   * geometry/history. Rejects (without mutating) a non-finite/non-positive,
   * conflicting, or already-constrained (redundant) value, leaving the editor
   * open so the value can be corrected.
   */
  commitDimension: (value: number) => DimensionOutcome;
  /** Cancels the active dimension operation without mutating the document, returning to selection. */
  cancelDimension: () => void;
  /** Adds a constraint via a `feature.update` command, re-solving and updating geometry/status deterministically. */
  applyConstraint: (constraint: NewConstraint) => ConstraintOutcome;
  /** Edits a dimensional constraint's value, validating it and re-solving through history. */
  editConstraintValue: (id: string, value: number) => ConstraintOutcome;
  /** Removes a constraint via a `feature.update` command and relaxes the solve status. */
  deleteConstraint: (id: string) => void;
  /**
   * Deletes the active sketch's current selection through one undoable
   * `feature.update`: selected entities (cascading to dependent geometry and
   * cleaning constraints that reference removed geometry) when any are selected,
   * otherwise the selected constraint. No-op when nothing is selected.
   */
  deleteSketchSelection: () => void;
  /** Leaves the sketch workspace back to the Part Studio, preserving the feature. */
  finishSketch: () => void;
  /** Sets one snap toggle to a specific value. */
  setSnapTarget: (target: SnapTarget, enabled: boolean) => void;
  /** Flips one snap toggle. */
  toggleSnapTarget: (target: SnapTarget) => void;
  /** Shows or hides the sketch grid (visual only; does not affect grid snapping). */
  setGridVisible: (visible: boolean) => void;
  /**
   * Opens the contextual Extrude task for a new extrusion, seeding the source
   * collector from a selected sketch (or the only sketch present) and a default
   * depth/direction. No-op while sketching or when the document has no sketch.
   */
  startExtrude: () => void;
  /** Opens the Extrude task to edit an existing extrude feature, loading its current depth/direction/reverse. */
  editExtrude: (featureId: string) => void;
  /** Sets the source sketch the active extrude task will consume (validated against the document). */
  setExtrudeSource: (sketchId: string) => void;
  /** Sets the active extrude task's sweep depth in mm (clamped to the shared manipulator range). */
  setExtrudeDepth: (depth: number) => void;
  /** Sets the active extrude task's operation direction (normal or symmetric). */
  setExtrudeDirection: (direction: 'normal' | 'symmetric') => void;
  /** Sets whether a normal extrusion sweeps to the far side of the plane; ignored while symmetric. */
  setExtrudeReverse: (reverse: boolean) => void;
  /**
   * Commits the active extrude task as exactly one feature command — a
   * `feature.create` for a new extrusion or a `feature.update` when editing —
   * closing the panel and selecting the resulting solid. Rejects (mutating
   * nothing, leaving the panel open) when the profile/depth is invalid.
   */
  confirmExtrude: () => ExtrudeOutcome;
  /** Closes the Extrude task without mutating the document, restoring the exact prior state and removing the preview. */
  cancelExtrude: () => void;
}

const IDENTITY_ROTATION_SCALE = { rotationDeg: [0, 0, 0], scale: [1, 1, 1] } as const;
const IDENTITY_TRANSFORM: Transform = { translation: [0, 0, 0], ...IDENTITY_ROTATION_SCALE };

const DEFAULT_PRIMITIVES: Record<Primitive['kind'], Primitive> = {
  box: { kind: 'box', width: 40, height: 40, depth: 40 },
  cylinder: { kind: 'cylinder', radius: 20, height: 40, segments: 32 },
  lBracket: { kind: 'lBracket', width: 50, height: 50, depth: 20, thickness: 8 },
};

const DEFAULT_NAMES: Record<Primitive['kind'], string> = {
  box: 'Box',
  cylinder: 'Cylinder',
  lBracket: 'L-Bracket',
};

/** Appends a numeric suffix (`"Box 2"`, `"Box 3"`, ...) only when the plain name is already taken. */
function nextEntityName(entities: readonly CadEntity[], base: string): string {
  const used = new Set(entities.map((entity) => entity.name));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}

/** Appends a numeric suffix (`"Sketch 1"`, `"Sketch 2"`, ...) so each feature name is unique. */
function nextFeatureName(features: readonly CadFeature[], base: string): string {
  const used = new Set(features.map((feature) => feature.name));
  let suffix = 1;
  while (used.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}

/** Drops a selection that no longer refers to an entity in the document, e.g. after an undo. */
function reconcileSelection(document: CadDocumentV2, selectedEntityId: string | null): string | null {
  if (selectedEntityId === null) return null;
  return document.entities.some((entity) => entity.id === selectedEntityId) ? selectedEntityId : null;
}

/** Drops a feature selection that no longer refers to a feature in the document, e.g. after an undo. */
function reconcileFeatureSelection(document: CadDocumentV2, selectedFeatureId: string | null): string | null {
  if (selectedFeatureId === null) return null;
  return document.features.some((feature) => feature.id === selectedFeatureId) ? selectedFeatureId : null;
}

/** Drops a hover that no longer refers to any entity or feature in the document. */
function reconcileHover(document: CadDocumentV2, hoveredId: string | null): string | null {
  if (hoveredId === null) return null;
  const present =
    document.entities.some((entity) => entity.id === hoveredId) || document.features.some((feature) => feature.id === hoveredId);
  return present ? hoveredId : null;
}

/** The first point in a sketch, held fixed by the solver so an otherwise mobile sketch can become fully constrained. */
function firstAnchorPointId(sketch: SketchFeature): string | null {
  for (const entity of sketch.entities) {
    if (entity.kind === 'point') return entity.id;
  }
  return null;
}

/**
 * Solves a sketch (grounded on its first point) and reduces the result to the
 * status the UI displays. A sketch with no points is reported under-constrained
 * rather than trivially fully-constrained; a validation failure is surfaced as a
 * conflict so it renders red with its diagnostics.
 */
function computeSketchSolve(sketch: SketchFeature): SketchSolveState {
  if (!sketch.entities.some((entity) => entity.kind === 'point')) {
    return { status: 'under-constrained', remainingDof: 0, diagnostics: [] };
  }
  const anchor = firstAnchorPointId(sketch);
  const result = solveSketch(sketch, anchor ? { anchoredPointIds: [anchor] } : {});
  if (!result.ok) {
    return { status: 'conflicting', remainingDof: 0, diagnostics: result.diagnostics };
  }
  return { status: result.status, remainingDof: result.remainingDof, diagnostics: result.diagnostics };
}

/** The active sketch feature in a document, or `null` when the id is missing/not a sketch. */
function findSketch(document: CadDocumentV2, featureId: string): SketchFeature | null {
  const feature = document.features.find((candidate) => candidate.id === featureId);
  return feature && feature.kind === 'sketch' ? feature : null;
}

/** First human-readable diagnostic message, if any. */
function firstDiagnosticMessage(diagnostics: readonly SolveDiagnostic[]): string | null {
  return diagnostics[0]?.message ?? null;
}

/** Validates a dimensional constraint's edited value against the schema's accepted range. */
function isValidDimensionValue(kind: SketchConstraint['kind'], value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (kind === 'angle') return value > 0 && value < 180;
  if (kind === 'distance' || kind === 'radius') return value > 0;
  return false;
}

/**
 * Recomputes the sketch selection, edited-constraint reference, and solve status
 * after an undo/redo may have removed entities/constraints or the whole sketch.
 * Returns an empty patch when not in sketch mode so unrelated undos are untouched.
 */
function reconcileSketchAfterHistory(
  state: CadStoreState,
  document: CadDocumentV2,
): Partial<Pick<CadStoreState, 'sketchSelection' | 'selectedConstraintId' | 'sketchSolve'>> {
  if (!state.sketch) return {};
  const sketch = findSketch(document, state.sketch.featureId);
  if (!sketch) return { sketchSelection: [], selectedConstraintId: null, sketchSolve: null };
  const entityIds = new Set(sketch.entities.map((entity) => entity.id));
  const constraintIds = new Set(sketch.constraints.map((constraint) => constraint.id));
  return {
    sketchSelection: state.sketchSelection.filter((id) => entityIds.has(id)),
    selectedConstraintId: state.selectedConstraintId && constraintIds.has(state.selectedConstraintId) ? state.selectedConstraintId : null,
    sketchSolve: computeSketchSolve(sketch),
  };
}

/** Clamps a requested extrude depth into the shared numeric-field / manipulator range. */
function clampExtrudeDepth(depth: number): number {
  if (!Number.isFinite(depth)) return MIN_EXTRUDE_DEPTH;
  return Math.min(MAX_EXTRUDE_DEPTH, Math.max(MIN_EXTRUDE_DEPTH, depth));
}

/**
 * Drops an active extrude task whose editing target or source sketch vanished
 * from the document (e.g. after an undo). Returns an empty patch when the
 * session is unaffected so unrelated history steps leave it untouched.
 */
function reconcileExtrudeAfterHistory(state: CadStoreState, document: CadDocumentV2): Partial<Pick<CadStoreState, 'extrude'>> {
  if (!state.extrude) return {};
  const editingGone =
    state.extrude.editingFeatureId !== null &&
    !document.features.some((feature) => feature.id === state.extrude?.editingFeatureId && feature.kind === 'extrude');
  const sourceGone =
    state.extrude.sketchId !== null &&
    !document.features.some((feature) => feature.id === state.extrude?.sketchId && feature.kind === 'sketch');
  if (editingGone) return { extrude: null };
  if (sourceGone) return { extrude: { ...state.extrude, sketchId: null } };
  return {};
}

/**
 * Task 10 ships no primitive-creation UI (that is Task 11), so the shell
 * needs a small non-empty document to exercise the scene tree, viewport,
 * and properties panel without an empty-state dead end.
 */
function createSeedDocument(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [
      {
        id: 'seed-box',
        name: 'Box',
        primitive: { kind: 'box', width: 40, height: 30, depth: 20 },
        transform: { translation: [-60, 0, 0], ...IDENTITY_ROTATION_SCALE },
        visible: true,
      },
      {
        id: 'seed-cylinder',
        name: 'Cylinder',
        primitive: { kind: 'cylinder', radius: 15, height: 40, segments: 32 },
        transform: { translation: [0, 0, 0], ...IDENTITY_ROTATION_SCALE },
        visible: true,
      },
      {
        id: 'seed-l-bracket',
        name: 'L-Bracket',
        primitive: { kind: 'lBracket', width: 50, height: 50, depth: 20, thickness: 8 },
        transform: { translation: [60, 0, 0], ...IDENTITY_ROTATION_SCALE },
        visible: true,
      },
    ],
    features: [],
  };
}

export interface CadStoreOptions {
  /** Injectable so tests can assert on deterministic ids instead of random UUIDs. */
  createId?: () => string;
}

/** Vanilla (framework-agnostic) store factory so tests can create isolated instances. */
export function createCadStore(document: CadDocumentV2 = createSeedDocument(), options: CadStoreOptions = {}) {
  const createId = options.createId ?? (() => crypto.randomUUID());

  return createStore<CadStoreState>((set, get) => {
    /**
     * Applies a resolved deletion plan (single command or atomic batch) through
     * history as one undoable entry, then reconciles selection/hover/pending
     * state against the resulting document. Never mutates renderer state.
     */
    function commitDeletion(plan: DeletionPlan): void {
      const state = get();
      const nextHistory = applyCommandToHistory(state.history, plan.command);
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        selectedEntityId: reconcileSelection(nextHistory.present, state.selectedEntityId),
        selectedFeatureId: reconcileFeatureSelection(nextHistory.present, state.selectedFeatureId),
        hoveredId: reconcileHover(nextHistory.present, state.hoveredId),
        pendingDeletion: null,
      });
    }

    return {
    document,
    history: createHistory(document),
    selectedEntityId: null,
    selectedFeatureId: null,
    hoveredId: null,
    pendingDeletion: null,
    cameraProjection: 'perspective',
    canUndo: false,
    canRedo: false,
    sketch: null,
    extrude: null,
    sketchSelection: [],
    selectedConstraintId: null,
    sketchSolve: null,
    snapSettings: { ...DEFAULT_SNAP_SETTINGS },
    gridVisible: true,

    selectEntity: (id) => {
      if (id !== null && !get().document.entities.some((entity) => entity.id === id)) {
        return;
      }
      set({ selectedEntityId: id, selectedFeatureId: null });
    },

    selectFeature: (id) => {
      if (id !== null && !get().document.features.some((feature) => feature.id === id)) {
        return;
      }
      set({ selectedFeatureId: id, selectedEntityId: null });
    },

    selectBody: (bodyId) => {
      if (bodyId === null) {
        set({ selectedEntityId: null, selectedFeatureId: null });
        return;
      }
      const state = get();
      if (state.document.entities.some((entity) => entity.id === bodyId)) {
        set({ selectedEntityId: bodyId, selectedFeatureId: null });
      } else if (state.document.features.some((feature) => feature.id === bodyId)) {
        // A picked derived body carries its owning feature's id: select the feature.
        set({ selectedFeatureId: bodyId, selectedEntityId: null });
      }
    },

    clearSelection: () => set({ selectedEntityId: null, selectedFeatureId: null }),

    setHovered: (id) => set({ hoveredId: id }),

    deleteSelected: () => {
      const state = get();
      if (state.selectedFeatureId) {
        get().requestDelete({ kind: 'feature', id: state.selectedFeatureId });
      } else if (state.selectedEntityId) {
        get().requestDelete({ kind: 'entity', id: state.selectedEntityId });
      }
    },

    requestDelete: (target) => {
      const state = get();
      const plan = planDeletion(state.document, target);
      if (!plan) return;
      if (plan.dependents.length === 0) {
        commitDeletion(plan);
      } else {
        set({ pendingDeletion: plan });
      }
    },

    confirmDeletion: () => {
      const plan = get().pendingDeletion;
      if (plan) commitDeletion(plan);
    },

    cancelDeletion: () => set({ pendingDeletion: null }),

    setCameraProjection: (projection) => set({ cameraProjection: projection }),

    createEntity: (kind) => {
      const state = get();
      const entity: CadEntity = {
        id: createId(),
        name: nextEntityName(state.document.entities, DEFAULT_NAMES[kind]),
        primitive: DEFAULT_PRIMITIVES[kind],
        transform: IDENTITY_TRANSFORM,
        visible: true,
      };
      const nextHistory = applyCommandToHistory(state.history, { type: 'entity.create', entity });
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        selectedEntityId: entity.id,
      });
      return entity.id;
    },

    updateEntity: (id, patch) => {
      const command: CadCommand = { type: 'entity.update', id, patch };
      if (!parseCadCommand(command).success) return false;

      const state = get();
      if (!state.document.entities.some((entity) => entity.id === id)) return false;

      const nextHistory = applyCommandToHistory(state.history, command);
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
      });
      return true;
    },

    /** Replaces the document with a freshly loaded one, discarding prior undo/redo history and selection. */
    loadDocument: (document) => {
      set({
        document,
        history: createHistory(document),
        canUndo: false,
        canRedo: false,
        selectedEntityId: null,
        selectedFeatureId: null,
        hoveredId: null,
        pendingDeletion: null,
        sketch: null,
        extrude: null,
        sketchSelection: [],
        selectedConstraintId: null,
        sketchSolve: null,
      });
    },

    undo: () => {
      const state = get();
      if (!computeCanUndo(state.history)) return;
      const nextHistory = historyUndo(state.history);
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        selectedEntityId: reconcileSelection(nextHistory.present, state.selectedEntityId),
        selectedFeatureId: reconcileFeatureSelection(nextHistory.present, state.selectedFeatureId),
        hoveredId: reconcileHover(nextHistory.present, state.hoveredId),
        pendingDeletion: null,
        ...reconcileSketchAfterHistory(state, nextHistory.present),
        ...reconcileExtrudeAfterHistory(state, nextHistory.present),
      });
    },

    redo: () => {
      const state = get();
      if (!computeCanRedo(state.history)) return;
      const nextHistory = historyRedo(state.history);
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        selectedEntityId: reconcileSelection(nextHistory.present, state.selectedEntityId),
        selectedFeatureId: reconcileFeatureSelection(nextHistory.present, state.selectedFeatureId),
        hoveredId: reconcileHover(nextHistory.present, state.hoveredId),
        pendingDeletion: null,
        ...reconcileSketchAfterHistory(state, nextHistory.present),
        ...reconcileExtrudeAfterHistory(state, nextHistory.present),
      });
    },

    enterSketch: (plane) => {
      const state = get();
      const featureId = createId();
      const feature: SketchFeature = {
        id: featureId,
        kind: 'sketch',
        name: nextFeatureName(state.document.features, 'Sketch'),
        plane,
        entities: [],
        constraints: [],
        visible: true,
      };
      const nextHistory = applyCommandToHistory(state.history, { type: 'feature.create', feature });
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        selectedEntityId: null,
        // Look orthographically straight down the plane normal for a true 2D workspace.
        cameraProjection: 'orthographic',
        sketch: {
          featureId,
          plane,
          tool: null,
          toolState: null,
          construction: false,
          polygonSides: DEFAULT_POLYGON_SIDES,
          cursor: null,
          cursorSnap: null,
          dimension: null,
        },
        extrude: null,
        sketchSelection: [],
        selectedConstraintId: null,
        sketchSolve: computeSketchSolve(feature),
      });
      return featureId;
    },

    setSketchTool: (tool) => {
      const session = get().sketch;
      if (!session) return;
      // The polygon tool starts from the session's chosen side count.
      let toolState = tool ? initialToolState(tool) : null;
      if (toolState && toolState.tool === 'polygon') {
        toolState = { ...toolState, sides: session.polygonSides };
      }
      // Activating a drawing tool leaves constraint-selection mode, so clear the selection.
      // Either way the Distance/Dimension tool no longer owns the sketch.
      set({
        sketch: { ...session, tool, toolState, dimension: null },
        ...(tool ? { sketchSelection: [], selectedConstraintId: null } : {}),
      });
    },

    setSketchConstruction: (construction) => {
      const session = get().sketch;
      if (!session) return;
      set({ sketch: { ...session, construction } });
    },

    toggleConstruction: () => {
      const state = get();
      const session = state.sketch;
      if (!session) return;
      // No selection: the toggle just flips the mode for newly drawn geometry.
      if (state.sketchSelection.length === 0) {
        set({ sketch: { ...session, construction: !session.construction } });
        return;
      }
      const sketch = selectActiveSketch(state);
      if (!sketch) return;
      const entities = applyConstructionToggle(sketch, state.sketchSelection);
      if (entities === sketch.entities) return; // nothing valid selected
      const nextHistory = applyCommandToHistory(state.history, {
        type: 'feature.update',
        id: sketch.id,
        patch: { entities },
      });
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        sketchSolve: computeSketchSolve(findSketch(nextHistory.present, sketch.id) ?? sketch),
      });
    },

    setSketchPolygonSides: (sides) => {
      const session = get().sketch;
      if (!session) return;
      const clamped = Math.max(3, Math.round(sides));
      const toolState =
        session.toolState && session.toolState.tool === 'polygon'
          ? { ...session.toolState, sides: clamped }
          : session.toolState;
      set({ sketch: { ...session, polygonSides: clamped, toolState } });
    },

    dispatchSketchEvent: (event) => {
      const state = get();
      const session = state.sketch;
      if (!session) return;

      const cursorPatch =
        event.type === 'move'
          ? { cursor: event.snap.point, cursorSnap: event.snap.kind }
          : { cursor: session.cursor, cursorSnap: session.cursorSnap };

      if (!session.tool || !session.toolState) {
        if (event.type === 'move') set({ sketch: { ...session, ...cursorPatch } });
        return;
      }

      const result = advanceTool(session.toolState, event);

      // Tangent arc continuity: when the first click lands on an existing point,
      // seed the tool's tangent from a line incident to that point so the arc
      // continues smoothly from it. Kept out of the pure reducer (which cannot
      // see committed geometry) but flowing through the same state update.
      let nextToolState = result.state;
      if (
        nextToolState.tool === 'arc-tangent' &&
        nextToolState.start &&
        nextToolState.tangent === null &&
        event.type === 'click' &&
        event.snap.ref.kind === 'existing'
      ) {
        const activeSketch = selectActiveSketch(state);
        const tangent = activeSketch ? lineTangentAtPoint(activeSketch, event.snap.ref.id) : null;
        if (tangent) nextToolState = { ...nextToolState, tangent };
      }

      let history = state.history;
      let document = state.document;
      let committed = false;
      if (result.commit) {
        const command = buildSketchUpdateCommand(document, session.featureId, result.commit, createId, session.construction);
        if (command) {
          history = applyCommandToHistory(history, command);
          document = history.present;
          committed = true;
        }
      }

      const committedSketch = committed ? findSketch(document, session.featureId) : null;

      set({
        document,
        history,
        canUndo: computeCanUndo(history),
        canRedo: computeCanRedo(history),
        sketch: {
          ...session,
          ...cursorPatch,
          tool: result.exitTool ? null : session.tool,
          toolState: result.exitTool ? null : nextToolState,
        },
        ...(committedSketch ? { sketchSolve: computeSketchSolve(committedSketch) } : {}),
      });
    },

    toggleSketchEntitySelection: (id) => {
      const state = get();
      const sketch = selectActiveSketch(state);
      if (!sketch || !sketch.entities.some((entity) => entity.id === id)) return;
      const selection = state.sketchSelection.includes(id)
        ? state.sketchSelection.filter((existing) => existing !== id)
        : [...state.sketchSelection, id];
      set({ sketchSelection: selection });
    },

    setSketchSelection: (ids) => {
      const state = get();
      const sketch = selectActiveSketch(state);
      if (!sketch) {
        set({ sketchSelection: [] });
        return;
      }
      const valid = new Set(sketch.entities.map((entity) => entity.id));
      set({ sketchSelection: ids.filter((id) => valid.has(id)) });
    },

    clearSketchSelection: () => set({ sketchSelection: [] }),

    selectConstraint: (id) => set({ selectedConstraintId: id }),

    startDimension: () => {
      const state = get();
      const session = state.sketch;
      const sketch = selectActiveSketch(state);
      if (!session || !sketch) return;
      // Pressing D again while active toggles the tool off, back to selection.
      if (session.dimension) {
        set({ sketch: { ...session, dimension: null } });
        return;
      }
      const resolved = resolveFromSelection(sketch, state.sketchSelection);
      const dimension: DimensionState = resolved
        ? { phase: 'awaiting', pointA: resolved.pointA, pointB: resolved.pointB, measured: resolved.measured }
        : { phase: 'picking', points: [] };
      set({
        sketch: { ...session, tool: null, toolState: null, dimension },
        sketchSelection: [],
        selectedConstraintId: null,
      });
    },

    dimensionPick: (id) => {
      const state = get();
      const session = state.sketch;
      const sketch = selectActiveSketch(state);
      if (!session || !sketch || session.dimension?.phase !== 'picking') return;
      const result = pickForDimension(sketch, session.dimension.points, id);
      if (!result) return;
      const dimension: DimensionState =
        result.kind === 'awaiting'
          ? { phase: 'awaiting', pointA: result.dimension.pointA, pointB: result.dimension.pointB, measured: result.dimension.measured }
          : { phase: 'picking', points: result.points };
      set({ sketch: { ...session, dimension } });
    },

    commitDimension: (value) => {
      const state = get();
      const session = state.sketch;
      const sketch = selectActiveSketch(state);
      if (!session || !sketch || session.dimension?.phase !== 'awaiting') {
        return { applied: false, reason: 'not-ready', status: null, message: 'No dimension is awaiting a value.' };
      }
      const { pointA, pointB } = session.dimension;
      if (!Number.isFinite(value) || value <= 0) {
        return { applied: false, reason: 'invalid', status: null, message: 'Enter a positive length in millimetres.' };
      }
      const hasBothPoints =
        sketch.entities.some((entity) => entity.id === pointA) && sketch.entities.some((entity) => entity.id === pointB);
      if (!hasBothPoints) {
        return { applied: false, reason: 'invalid', status: null, message: 'The dimensioned geometry no longer exists.' };
      }

      // Compare degrees of freedom before/after to detect a redundant driving dimension:
      // an independent distance removes one DOF, a redundant one leaves the count unchanged.
      const anchorBefore = firstAnchorPointId(sketch);
      const before = solveSketch(sketch, anchorBefore ? { anchoredPointIds: [anchorBefore] } : {});
      const dofBefore = before.ok ? before.remainingDof : null;

      const constraint: SketchConstraint = { id: createId(), kind: 'distance', pointA, pointB, value };
      const candidate: SketchFeature = { ...sketch, constraints: [...sketch.constraints, constraint] };
      const anchor = firstAnchorPointId(candidate);
      const result = solveSketch(candidate, anchor ? { anchoredPointIds: [anchor] } : {});

      if (!result.ok) {
        return { applied: false, reason: 'invalid', status: null, message: firstDiagnosticMessage(result.diagnostics) ?? 'Value could not be applied.' };
      }
      if (result.status === 'conflicting') {
        return {
          applied: false,
          reason: 'conflict',
          status: 'conflicting',
          message: firstDiagnosticMessage(result.diagnostics) ?? 'This dimension conflicts with the existing constraints.',
        };
      }
      if (dofBefore !== null && result.remainingDof >= dofBefore) {
        return { applied: false, reason: 'redundant', status: result.status, message: 'This distance is already fully constrained.' };
      }

      const patch = { constraints: candidate.constraints, entities: result.sketch.entities };
      const nextHistory = applyCommandToHistory(state.history, { type: 'feature.update', id: sketch.id, patch });
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        sketchSolve: { status: result.status, remainingDof: result.remainingDof, diagnostics: result.diagnostics },
        selectedConstraintId: constraint.id,
        sketch: { ...session, dimension: null },
        sketchSelection: [],
      });
      return { applied: true, reason: 'applied', status: result.status, message: null };
    },

    cancelDimension: () => {
      const session = get().sketch;
      if (!session || !session.dimension) return;
      set({ sketch: { ...session, dimension: null } });
    },

    applyConstraint: (constraint) => {
      const state = get();
      const sketch = selectActiveSketch(state);
      if (!sketch) return { applied: false, status: null, message: 'No active sketch.' };

      const id = createId();
      const fullConstraint = { id, ...constraint } as SketchConstraint;
      const candidate: SketchFeature = { ...sketch, constraints: [...sketch.constraints, fullConstraint] };
      const anchor = firstAnchorPointId(candidate);
      const result = solveSketch(candidate, anchor ? { anchoredPointIds: [anchor] } : {});

      if (!result.ok) {
        // Invalid input (e.g. a dangling reference): reject outright, commit nothing.
        return { applied: false, status: 'invalid', message: firstDiagnosticMessage(result.diagnostics) ?? 'Constraint could not be applied.' };
      }

      // On a conflict keep the prior geometry (rollback) but still record the constraint so the
      // conflicting state is visible and undoable; otherwise adopt the solved geometry.
      const patch =
        result.status === 'conflicting'
          ? { constraints: candidate.constraints }
          : { constraints: candidate.constraints, entities: result.sketch.entities };
      const nextHistory = applyCommandToHistory(state.history, { type: 'feature.update', id: sketch.id, patch });
      const solve: SketchSolveState = { status: result.status, remainingDof: result.remainingDof, diagnostics: result.diagnostics };
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        sketchSolve: solve,
        selectedConstraintId: id,
      });
      return {
        applied: true,
        status: result.status,
        message: result.status === 'conflicting' ? firstDiagnosticMessage(result.diagnostics) : null,
      };
    },

    editConstraintValue: (id, value) => {
      const state = get();
      const sketch = selectActiveSketch(state);
      if (!sketch) return { applied: false, status: null, message: 'No active sketch.' };
      const constraint = sketch.constraints.find((candidate) => candidate.id === id);
      if (!constraint) return { applied: false, status: null, message: 'Unknown constraint.' };
      if (constraint.kind !== 'distance' && constraint.kind !== 'radius' && constraint.kind !== 'angle') {
        return { applied: false, status: null, message: 'This constraint has no editable value.' };
      }
      if (!isValidDimensionValue(constraint.kind, value)) {
        const unit = constraint.kind === 'angle' ? 'be between 0 and 180 degrees' : 'be a positive length in mm';
        return { applied: false, status: null, message: `Value must ${unit}.` };
      }

      const updated =
        constraint.kind === 'angle'
          ? { ...constraint, valueDeg: value }
          : { ...constraint, value };
      const constraints = sketch.constraints.map((candidate) => (candidate.id === id ? updated : candidate));
      const candidate: SketchFeature = { ...sketch, constraints };
      const anchor = firstAnchorPointId(candidate);
      const result = solveSketch(candidate, anchor ? { anchoredPointIds: [anchor] } : {});
      if (!result.ok) {
        return { applied: false, status: 'invalid', message: firstDiagnosticMessage(result.diagnostics) ?? 'Value could not be applied.' };
      }

      const patch =
        result.status === 'conflicting' ? { constraints } : { constraints, entities: result.sketch.entities };
      const nextHistory = applyCommandToHistory(state.history, { type: 'feature.update', id: sketch.id, patch });
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        sketchSolve: { status: result.status, remainingDof: result.remainingDof, diagnostics: result.diagnostics },
      });
      return {
        applied: true,
        status: result.status,
        message: result.status === 'conflicting' ? firstDiagnosticMessage(result.diagnostics) : null,
      };
    },

    deleteConstraint: (id) => {
      const state = get();
      const sketch = selectActiveSketch(state);
      if (!sketch || !sketch.constraints.some((constraint) => constraint.id === id)) return;
      const constraints = sketch.constraints.filter((constraint) => constraint.id !== id);
      const candidate: SketchFeature = { ...sketch, constraints };
      const anchor = firstAnchorPointId(candidate);
      const result = solveSketch(candidate, anchor ? { anchoredPointIds: [anchor] } : {});
      // Removing constraints only relaxes the system, so a converged solve is expected;
      // fall back to keeping geometry if the reduced system somehow fails to validate.
      const patch =
        result.ok && result.status !== 'conflicting' ? { constraints, entities: result.sketch.entities } : { constraints };
      const nextHistory = applyCommandToHistory(state.history, { type: 'feature.update', id: sketch.id, patch });
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        sketchSolve: computeSketchSolve(findSketch(nextHistory.present, sketch.id) ?? candidate),
        selectedConstraintId: state.selectedConstraintId === id ? null : state.selectedConstraintId,
      });
    },

    deleteSketchSelection: () => {
      const state = get();
      const sketch = selectActiveSketch(state);
      if (!sketch) return;

      // Prefer entity deletion; fall back to the selected constraint glyph.
      if (state.sketchSelection.length === 0) {
        if (state.selectedConstraintId) get().deleteConstraint(state.selectedConstraintId);
        return;
      }

      const { entities, constraints } = removeSketchEntities(sketch, state.sketchSelection);
      if (entities.length === sketch.entities.length && constraints.length === sketch.constraints.length) {
        return; // nothing was actually removed
      }

      const candidate: SketchFeature = { ...sketch, entities, constraints };
      const nextHistory = applyCommandToHistory(state.history, {
        type: 'feature.update',
        id: sketch.id,
        patch: { entities, constraints },
      });
      const remainingConstraintIds = new Set(constraints.map((constraint) => constraint.id));
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        sketchSelection: [],
        selectedConstraintId:
          state.selectedConstraintId && remainingConstraintIds.has(state.selectedConstraintId) ? state.selectedConstraintId : null,
        sketchSolve: computeSketchSolve(findSketch(nextHistory.present, sketch.id) ?? candidate),
      });
    },

    finishSketch: () => {
      if (!get().sketch) return;
      set({
        sketch: null,
        cameraProjection: 'perspective',
        sketchSelection: [],
        selectedConstraintId: null,
        sketchSolve: null,
      });
    },

    setSnapTarget: (target, enabled) => {
      set({ snapSettings: { ...get().snapSettings, [target]: enabled } });
    },

    toggleSnapTarget: (target) => {
      const current = get().snapSettings;
      set({ snapSettings: { ...current, [target]: !current[target] } });
    },

    setGridVisible: (visible) => set({ gridVisible: visible }),

    startExtrude: () => {
      const state = get();
      if (state.sketch) return; // extrusion is a Part Studio operation, not a sketch-mode one
      const sketches = listSketchFeatures(state.document);
      if (sketches.length === 0) return;

      // Seed the source collector: a pre-selected sketch, else the sole sketch, else nothing.
      const selected = state.document.features.find((feature) => feature.id === state.selectedFeatureId);
      const sourceId =
        selected && selected.kind === 'sketch'
          ? selected.id
          : sketches.length === 1
            ? sketches[0]!.id
            : null;

      set({
        extrude: { editingFeatureId: null, sketchId: sourceId, depth: DEFAULT_EXTRUDE_DEPTH, direction: 'normal', reverse: false },
        selectedEntityId: null,
        selectedFeatureId: null,
      });
    },

    editExtrude: (featureId) => {
      const state = get();
      if (state.sketch) return;
      const feature = state.document.features.find((candidate) => candidate.id === featureId);
      if (!feature || feature.kind !== 'extrude') return;
      set({
        extrude: {
          editingFeatureId: feature.id,
          sketchId: feature.sketchId,
          depth: feature.depth,
          direction: feature.direction,
          reverse: feature.reverse ?? false,
        },
        selectedEntityId: null,
        selectedFeatureId: feature.id,
      });
    },

    setExtrudeSource: (sketchId) => {
      const state = get();
      if (!state.extrude) return;
      const feature = state.document.features.find((candidate) => candidate.id === sketchId);
      if (!feature || feature.kind !== 'sketch') return;
      set({ extrude: { ...state.extrude, sketchId } });
    },

    setExtrudeDepth: (depth) => {
      const session = get().extrude;
      if (!session) return;
      set({ extrude: { ...session, depth: clampExtrudeDepth(depth) } });
    },

    setExtrudeDirection: (direction) => {
      const session = get().extrude;
      if (!session) return;
      set({ extrude: { ...session, direction } });
    },

    setExtrudeReverse: (reverse) => {
      const session = get().extrude;
      if (!session) return;
      set({ extrude: { ...session, reverse } });
    },

    confirmExtrude: () => {
      const state = get();
      const session = state.extrude;
      if (!session) return { committed: false, featureId: null, message: 'No extrusion in progress.' };

      const validation = validateExtrudeSession(state.document, session);
      if (validation.status !== 'ok' || !session.sketchId) {
        return { committed: false, featureId: null, message: validation.message };
      }

      let featureId: string;
      let command: CadCommand;
      if (session.editingFeatureId) {
        featureId = session.editingFeatureId;
        command = {
          type: 'feature.update',
          id: featureId,
          patch: {
            sketchId: session.sketchId,
            depth: session.depth,
            direction: session.direction,
            reverse: session.reverse,
          },
        };
      } else {
        featureId = createId();
        const feature: ExtrudeFeature = {
          id: featureId,
          kind: 'extrude',
          name: nextFeatureName(state.document.features, 'Extrude'),
          sketchId: session.sketchId,
          depth: session.depth,
          direction: session.direction,
          reverse: session.reverse,
          visible: true,
        };
        command = { type: 'feature.create', feature };
      }

      const nextHistory = applyCommandToHistory(state.history, command);
      set({
        history: nextHistory,
        document: nextHistory.present,
        canUndo: computeCanUndo(nextHistory),
        canRedo: computeCanRedo(nextHistory),
        extrude: null,
        selectedFeatureId: featureId,
        selectedEntityId: null,
      });
      return { committed: true, featureId, message: null };
    },

    cancelExtrude: () => {
      if (!get().extrude) return;
      // The document was never mutated during the task, so clearing the session
      // restores the exact prior state and removes the derived preview.
      set({ extrude: null });
    },
    };
  });
}

export function selectSelectedEntity(state: CadStoreState): CadEntity | undefined {
  return state.document.entities.find((entity) => entity.id === state.selectedEntityId);
}

/** The currently selected feature (sketch or extrude), or `undefined` when none is selected. */
export function selectSelectedFeature(state: CadStoreState): CadFeature | undefined {
  return state.document.features.find((feature) => feature.id === state.selectedFeatureId);
}

/** Confirmation-readiness of the active extrude task (with a diagnostic when blocked), or `null` when no task is open. */
export function selectExtrudeValidation(state: CadStoreState): ExtrudeValidation | null {
  if (!state.extrude) return null;
  return validateExtrudeSession(state.document, state.extrude);
}

/** The `SketchFeature` currently being edited, or `null` when not in sketch mode. */
export function selectActiveSketch(state: CadStoreState): SketchFeature | null {
  if (!state.sketch) return null;
  const feature = state.document.features.find((candidate) => candidate.id === state.sketch?.featureId);
  return feature && feature.kind === 'sketch' ? feature : null;
}
