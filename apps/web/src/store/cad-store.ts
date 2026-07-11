import type {
  CadCommand,
  CadDocumentV2,
  CadEntity,
  CadEntityPatch,
  CadFeature,
  CommandHistory,
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
  redo as historyRedo,
  undo as historyUndo,
} from '@swalha-cad/document';
import type { SolveDiagnostic, SolveStatus } from '@swalha-cad/geometry';
import { solveSketch } from '@swalha-cad/geometry';
import { createStore } from 'zustand/vanilla';
import { buildSketchUpdateCommand } from '../sketch/commit.js';
import type { NewConstraint } from '../sketch/constraint-actions.js';
import { advanceTool, initialToolState } from '../sketch/tools/index.js';
import type { SketchToolKind, SnapKind, ToolEvent, ToolState, Vec2 } from '../sketch/tools/types.js';

export type CameraProjection = 'perspective' | 'orthographic';

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
  cursor: Vec2 | null;
  cursorSnap: SnapKind | null;
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

export interface CadStoreState {
  document: CadDocumentV2;
  history: CommandHistory;
  selectedEntityId: string | null;
  cameraProjection: CameraProjection;
  canUndo: boolean;
  canRedo: boolean;
  /** Non-null while the focused 2D sketch workspace is active. */
  sketch: SketchSession | null;
  /** Selected sketch entity ids (points/lines/circles) driving constraint availability; empty outside sketch mode. */
  sketchSelection: string[];
  /** The constraint whose dimension the properties panel is editing, or `null`. */
  selectedConstraintId: string | null;
  /** Live solver status/diagnostics for the active sketch, or `null` outside sketch mode. */
  sketchSolve: SketchSolveState | null;
  selectEntity: (id: string | null) => void;
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
  /** Adds a constraint via a `feature.update` command, re-solving and updating geometry/status deterministically. */
  applyConstraint: (constraint: NewConstraint) => ConstraintOutcome;
  /** Edits a dimensional constraint's value, validating it and re-solving through history. */
  editConstraintValue: (id: string, value: number) => ConstraintOutcome;
  /** Removes a constraint via a `feature.update` command and relaxes the solve status. */
  deleteConstraint: (id: string) => void;
  /** Leaves the sketch workspace back to the Part Studio, preserving the feature. */
  finishSketch: () => void;
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

  return createStore<CadStoreState>((set, get) => ({
    document,
    history: createHistory(document),
    selectedEntityId: null,
    cameraProjection: 'perspective',
    canUndo: false,
    canRedo: false,
    sketch: null,
    sketchSelection: [],
    selectedConstraintId: null,
    sketchSolve: null,

    selectEntity: (id) => {
      if (id !== null && !get().document.entities.some((entity) => entity.id === id)) {
        return;
      }
      set({ selectedEntityId: id });
    },

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
        sketch: null,
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
        ...reconcileSketchAfterHistory(state, nextHistory.present),
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
        ...reconcileSketchAfterHistory(state, nextHistory.present),
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
        sketch: { featureId, plane, tool: null, toolState: null, construction: false, cursor: null, cursorSnap: null },
        sketchSelection: [],
        selectedConstraintId: null,
        sketchSolve: computeSketchSolve(feature),
      });
      return featureId;
    },

    setSketchTool: (tool) => {
      const session = get().sketch;
      if (!session) return;
      // Activating a drawing tool leaves constraint-selection mode, so clear the selection.
      set({
        sketch: { ...session, tool, toolState: tool ? initialToolState(tool) : null },
        ...(tool ? { sketchSelection: [], selectedConstraintId: null } : {}),
      });
    },

    setSketchConstruction: (construction) => {
      const session = get().sketch;
      if (!session) return;
      set({ sketch: { ...session, construction } });
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
          toolState: result.exitTool ? null : result.state,
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
  }));
}

export function selectSelectedEntity(state: CadStoreState): CadEntity | undefined {
  return state.document.entities.find((entity) => entity.id === state.selectedEntityId);
}

/** The `SketchFeature` currently being edited, or `null` when not in sketch mode. */
export function selectActiveSketch(state: CadStoreState): SketchFeature | null {
  if (!state.sketch) return null;
  const feature = state.document.features.find((candidate) => candidate.id === state.sketch?.featureId);
  return feature && feature.kind === 'sketch' ? feature : null;
}
