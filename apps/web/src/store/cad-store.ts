import type {
  CadCommand,
  CadDocumentV1,
  CadEntity,
  CadEntityPatch,
  CommandHistory,
  Primitive,
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

export type CameraProjection = 'perspective' | 'orthographic';

export interface CadStoreState {
  document: CadDocumentV1;
  history: CommandHistory;
  selectedEntityId: string | null;
  cameraProjection: CameraProjection;
  canUndo: boolean;
  canRedo: boolean;
  selectEntity: (id: string | null) => void;
  setCameraProjection: (projection: CameraProjection) => void;
  createEntity: (kind: Primitive['kind']) => string;
  updateEntity: (id: string, patch: CadEntityPatch) => boolean;
  undo: () => void;
  redo: () => void;
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

/** Drops a selection that no longer refers to an entity in the document, e.g. after an undo. */
function reconcileSelection(document: CadDocumentV1, selectedEntityId: string | null): string | null {
  if (selectedEntityId === null) return null;
  return document.entities.some((entity) => entity.id === selectedEntityId) ? selectedEntityId : null;
}

/**
 * Task 10 ships no primitive-creation UI (that is Task 11), so the shell
 * needs a small non-empty document to exercise the scene tree, viewport,
 * and properties panel without an empty-state dead end.
 */
function createSeedDocument(): CadDocumentV1 {
  return {
    schemaVersion: 1,
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
  };
}

export interface CadStoreOptions {
  /** Injectable so tests can assert on deterministic ids instead of random UUIDs. */
  createId?: () => string;
}

/** Vanilla (framework-agnostic) store factory so tests can create isolated instances. */
export function createCadStore(document: CadDocumentV1 = createSeedDocument(), options: CadStoreOptions = {}) {
  const createId = options.createId ?? (() => crypto.randomUUID());

  return createStore<CadStoreState>((set, get) => ({
    document,
    history: createHistory(document),
    selectedEntityId: null,
    cameraProjection: 'perspective',
    canUndo: false,
    canRedo: false,

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
  }));
}

export function selectSelectedEntity(state: CadStoreState): CadEntity | undefined {
  return state.document.entities.find((entity) => entity.id === state.selectedEntityId);
}
