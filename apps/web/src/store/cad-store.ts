import type {
  CadCommand,
  CadDocumentV2,
  CadEntity,
  CadEntityPatch,
  CadFeature,
  CommandHistory,
  Primitive,
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
import { createStore } from 'zustand/vanilla';
import { buildSketchUpdateCommand } from '../sketch/commit.js';
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

export interface CadStoreState {
  document: CadDocumentV2;
  history: CommandHistory;
  selectedEntityId: string | null;
  cameraProjection: CameraProjection;
  canUndo: boolean;
  canRedo: boolean;
  /** Non-null while the focused 2D sketch workspace is active. */
  sketch: SketchSession | null;
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
      });
      return featureId;
    },

    setSketchTool: (tool) => {
      const session = get().sketch;
      if (!session) return;
      set({ sketch: { ...session, tool, toolState: tool ? initialToolState(tool) : null } });
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
      if (result.commit) {
        const command = buildSketchUpdateCommand(document, session.featureId, result.commit, createId, session.construction);
        if (command) {
          history = applyCommandToHistory(history, command);
          document = history.present;
        }
      }

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
      });
    },

    finishSketch: () => {
      if (!get().sketch) return;
      set({ sketch: null, cameraProjection: 'perspective' });
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
