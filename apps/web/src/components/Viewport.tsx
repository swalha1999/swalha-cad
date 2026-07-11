import { useEffect, useRef } from 'react';
import { useCadStore, useCadStoreApi } from '../store/cad-store-context.js';
import { createViewportScene } from '../viewport/create-viewport-scene.js';
import type { StandardView, ViewportScene } from '../viewport/create-viewport-scene.js';
import { ViewCube } from './ViewCube.js';
import { ViewportControls } from './ViewportControls.js';

function clampToAtLeastOnePixel(value: number): number {
  return Math.max(1, value);
}

export function Viewport() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<ViewportScene | null>(null);

  const cadDocument = useCadStore((state) => state.document);
  const projection = useCadStore((state) => state.cameraProjection);
  const selectedEntityId = useCadStore((state) => state.selectedEntityId);
  const storeApi = useCadStoreApi();

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const initial = storeApi.getState();
    const rect = container.getBoundingClientRect();
    const scene = createViewportScene({
      canvas,
      document: initial.document,
      projection: initial.cameraProjection,
      selectedEntityId: initial.selectedEntityId,
      viewport: {
        width: clampToAtLeastOnePixel(rect.width),
        height: clampToAtLeastOnePixel(rect.height),
      },
      onSelect: (entityId) => storeApi.getState().selectEntity(entityId),
      onTransformChange: (entityId, transform) => storeApi.getState().updateEntity(entityId, { transform }),
    });
    sceneRef.current = scene;

    function handleResize(): void {
      if (!container) return;
      const nextRect = container.getBoundingClientRect();
      scene.resize({
        width: clampToAtLeastOnePixel(nextRect.width),
        height: clampToAtLeastOnePixel(nextRect.height),
      });
    }
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      scene.dispose();
      sceneRef.current = null;
    };
    // Runs once per mount: subsequent store changes are pushed by the effects below.
    // storeApi is stable for the provider's lifetime, so it is intentionally left out of the deps.
  }, []);

  useEffect(() => {
    sceneRef.current?.updateDocument(cadDocument);
  }, [cadDocument]);

  useEffect(() => {
    sceneRef.current?.setSelection(selectedEntityId);
  }, [selectedEntityId]);

  useEffect(() => {
    sceneRef.current?.setProjection(projection);
  }, [projection]);

  function handleSelectView(view: StandardView): void {
    sceneRef.current?.setStandardView(view);
  }

  return (
    <div className="viewport" ref={containerRef}>
      <canvas ref={canvasRef} className="viewport__canvas" />
      <div className="viewport__overlay viewport__overlay--top-right">
        <ViewCube onSelectView={handleSelectView} />
      </div>
      <div className="viewport__overlay viewport__overlay--bottom-left">
        <ViewportControls
          projection={projection}
          onProjectionChange={(next) => storeApi.getState().setCameraProjection(next)}
          onHome={() => handleSelectView('home')}
        />
      </div>
    </div>
  );
}
