import type { CadDocumentV1, CadEntity } from '@swalha-cad/document';
import { createStore } from 'zustand/vanilla';

export type CameraProjection = 'perspective' | 'orthographic';

export interface CadStoreState {
  document: CadDocumentV1;
  selectedEntityId: string | null;
  cameraProjection: CameraProjection;
  selectEntity: (id: string | null) => void;
  setCameraProjection: (projection: CameraProjection) => void;
}

const IDENTITY_TRANSFORM = { rotationDeg: [0, 0, 0], scale: [1, 1, 1] } as const;

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
        transform: { translation: [-60, 0, 0], ...IDENTITY_TRANSFORM },
        visible: true,
      },
      {
        id: 'seed-cylinder',
        name: 'Cylinder',
        primitive: { kind: 'cylinder', radius: 15, height: 40, segments: 32 },
        transform: { translation: [0, 0, 0], ...IDENTITY_TRANSFORM },
        visible: true,
      },
      {
        id: 'seed-l-bracket',
        name: 'L-Bracket',
        primitive: { kind: 'lBracket', width: 50, height: 50, depth: 20, thickness: 8 },
        transform: { translation: [60, 0, 0], ...IDENTITY_TRANSFORM },
        visible: true,
      },
    ],
  };
}

/** Vanilla (framework-agnostic) store factory so tests can create isolated instances. */
export function createCadStore(document: CadDocumentV1 = createSeedDocument()) {
  return createStore<CadStoreState>((set, get) => ({
    document,
    selectedEntityId: null,
    cameraProjection: 'perspective',
    selectEntity: (id) => {
      if (id !== null && !get().document.entities.some((entity) => entity.id === id)) {
        return;
      }
      set({ selectedEntityId: id });
    },
    setCameraProjection: (projection) => set({ cameraProjection: projection }),
  }));
}

export function selectSelectedEntity(state: CadStoreState): CadEntity | undefined {
  return state.document.entities.find((entity) => entity.id === state.selectedEntityId);
}
