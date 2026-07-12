import { fireEvent, render, screen } from '@testing-library/react';
import { act, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';

const sceneState = vi.hoisted(() => ({ instances: [] as ReturnType<typeof buildFakeScene>[] }));

function buildFakeScene(onSelectArg: (id: string | null) => void) {
  return {
    scene: {},
    onSelectArg,
    updateDocument: vi.fn(),
    setSelection: vi.fn(),
    setHover: vi.fn(),
    setFacePickMode: vi.fn(),
    setSelectedFace: vi.fn(),
    setSelectedPlane: vi.fn(),
    setModelDimmed: vi.fn(),
    alignCameraToFace: vi.fn(),
    snapshotCamera: vi.fn(),
    restoreCamera: vi.fn(),
    setProjection: vi.fn(),
    setStandardView: vi.fn(),
    resize: vi.fn(),
    getActiveCamera: vi.fn(),
    dispose: vi.fn(),
  };
}

vi.mock('../viewport/create-viewport-scene.js', () => ({
  createViewportScene: vi.fn((options: { canvas: HTMLCanvasElement; onSelect: (id: string | null) => void }) => {
    const instance = buildFakeScene(options.onSelect);
    sceneState.instances.push(instance);
    return instance;
  }),
}));

const { createViewportScene } = await import('../viewport/create-viewport-scene.js');
const { Viewport } = await import('./Viewport.js');

function renderViewport(store = createCadStore(buildTestDocument())) {
  const utils = render(
    <CadStoreProvider store={store}>
      <Viewport />
    </CadStoreProvider>,
  );
  return { store, ...utils };
}

describe('Viewport', () => {
  it('creates exactly one viewport scene on mount, targeting a canvas element', () => {
    sceneState.instances = [];
    renderViewport();

    expect(createViewportScene).toHaveBeenCalledTimes(1);
    const options = vi.mocked(createViewportScene).mock.calls[0]![0];
    expect(options.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(options.projection).toBe('perspective');
    expect(options.selectedEntityId).toBeNull();
  });

  it('disposes every intermediate scene created by StrictMode double-invocation, leaving exactly one live', () => {
    sceneState.instances = [];
    render(
      <StrictMode>
        <CadStoreProvider store={createCadStore(buildTestDocument())}>
          <Viewport />
        </CadStoreProvider>
      </StrictMode>,
    );

    expect(sceneState.instances.length).toBeGreaterThan(0);
    const disposedCount = sceneState.instances.filter((instance) => instance.dispose.mock.calls.length > 0).length;
    expect(disposedCount).toBe(sceneState.instances.length - 1);
  });

  it('disposes the scene on unmount', () => {
    sceneState.instances = [];
    const { unmount } = renderViewport();

    unmount();

    expect(sceneState.instances[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('pushes store document changes into the scene', () => {
    sceneState.instances = [];
    const { store } = renderViewport();
    const nextDocument = buildTestDocument();
    nextDocument.entities = nextDocument.entities.slice(0, 1);

    act(() => {
      store.setState({ document: nextDocument });
    });

    expect(sceneState.instances[0]!.updateDocument).toHaveBeenCalledWith(nextDocument);
  });

  it('pushes store selection changes into the scene', () => {
    sceneState.instances = [];
    const { store } = renderViewport();

    act(() => {
      store.getState().selectEntity('box-1');
    });

    expect(sceneState.instances[0]!.setSelection).toHaveBeenCalledWith('box-1');
  });

  it('pushes store camera projection changes into the scene', () => {
    sceneState.instances = [];
    const { store } = renderViewport();

    act(() => {
      store.getState().setCameraProjection('orthographic');
    });

    expect(sceneState.instances[0]!.setProjection).toHaveBeenCalledWith('orthographic');
  });

  it("wires the scene's onSelect callback back into the store", () => {
    sceneState.instances = [];
    const { store } = renderViewport();

    act(() => {
      sceneState.instances[0]!.onSelectArg('cylinder-1');
    });

    expect(store.getState().selectedEntityId).toBe('cylinder-1');
  });

  it('pushes store hover changes into the scene', () => {
    sceneState.instances = [];
    const { store } = renderViewport();

    act(() => {
      store.getState().setHovered('box-1');
    });

    expect(sceneState.instances[0]!.setHover).toHaveBeenCalledWith('box-1');
  });

  it("wires the scene's onTransformChange callback into the store's updateEntity", () => {
    sceneState.instances = [];
    const { store } = renderViewport();
    const id = store.getState().document.entities[0]!.id;
    const options = vi.mocked(createViewportScene).mock.calls.at(-1)![0];
    const transform = { translation: [9, 8, 7] as const, rotationDeg: [0, 0, 0] as const, scale: [1, 1, 1] as const };

    act(() => {
      options.onTransformChange(id, transform);
    });

    const updated = store.getState().document.entities.find((entity) => entity.id === id);
    expect(updated?.transform).toEqual(transform);
  });

  it('renders the view cube and viewport navigation controls as overlays', () => {
    sceneState.instances = [];
    renderViewport();

    expect(screen.getByRole('group', { name: 'View orientation' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Viewport navigation' })).toBeInTheDocument();
  });

  it('sets a standard view on the scene when a view cube face is clicked', () => {
    sceneState.instances = [];
    renderViewport();

    fireEvent.click(screen.getByRole('button', { name: 'Front view' }));

    expect(sceneState.instances[0]!.setStandardView).toHaveBeenCalledWith('front');
  });

  it('sets the home view on the scene when the viewport controls home button is clicked', () => {
    sceneState.instances = [];
    renderViewport();

    fireEvent.click(screen.getByRole('button', { name: 'Home view' }));

    expect(sceneState.instances[0]!.setStandardView).toHaveBeenCalledWith('home');
  });

  it('changes the store camera projection from the viewport controls', () => {
    sceneState.instances = [];
    const { store } = renderViewport();

    fireEvent.click(screen.getByRole('button', { name: 'Orthographic' }));

    expect(store.getState().cameraProjection).toBe('orthographic');
  });
});
