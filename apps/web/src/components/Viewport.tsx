import { useEffect, useMemo, useRef } from 'react';
import type { SketchPlane } from '@swalha-cad/document';
import { resolveFaceFrame } from '@swalha-cad/geometry';
import { buildExtrudePreviewDocument } from '../features/extrude-session.js';
import { selectActiveSketch } from '../store/cad-store.js';
import { useCadStore, useCadStoreApi } from '../store/cad-store-context.js';
import { createViewportScene } from '../viewport/create-viewport-scene.js';
import type { FacePickMode, StandardView, ViewportScene } from '../viewport/create-viewport-scene.js';
import { ViewCube } from './ViewCube.js';
import { ViewportControls } from './ViewportControls.js';

function clampToAtLeastOnePixel(value: number): number {
  return Math.max(1, value);
}

/** The standard view that looks orthographically straight down each sketch plane's normal. */
const PLANE_VIEW: Record<SketchPlane, StandardView> = { XY: 'top', XZ: 'front', YZ: 'right' };

export function Viewport() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<ViewportScene | null>(null);

  const committedDocument = useCadStore((state) => state.document);
  const extrudeSession = useCadStore((state) => state.extrude);
  // The rendered document augments the committed one with the active extrude
  // task's candidate solid, so the live 3D preview flows through the normal
  // evaluate/scene-sync pipeline without ever touching the document/history.
  // Falls back to the committed document (same reference) when no task is open.
  const cadDocument = useMemo(
    () => buildExtrudePreviewDocument(committedDocument, extrudeSession),
    [committedDocument, extrudeSession],
  );
  const projection = useCadStore((state) => state.cameraProjection);
  const selectedEntityId = useCadStore((state) => state.selectedEntityId);
  const selectedFeatureId = useCadStore((state) => state.selectedFeatureId);
  const hoveredId = useCadStore((state) => state.hoveredId);
  // Stable primitive slices only — the sketch session object changes on every cursor move.
  const inSketch = useCadStore((state) => state.sketch !== null);
  const sketchPlane = useCadStore((state) => state.sketch?.plane ?? null);
  const sketchFeatureId = useCadStore((state) => state.sketch?.featureId ?? null);
  const faceSketchArmed = useCadStore((state) => state.faceSketchArmed);
  const inSupport = useCadStore((state) => state.sketchSupport !== null);
  const selectedFaceBodyId = useCadStore((state) => state.selectedFace?.bodyId ?? null);
  const selectedFaceId = useCadStore((state) => state.selectedFace?.faceId ?? null);
  const selectedPlane = useCadStore((state) => state.selectedPlane);
  const supportPlane = useCadStore((state) =>
    state.sketchSupport?.support?.kind === 'plane' ? state.sketchSupport.support.plane : null,
  );
  const supportFaceBodyId = useCadStore((state) =>
    state.sketchSupport?.support?.kind === 'face' ? state.sketchSupport.support.face.bodyId : null,
  );
  const supportFaceId = useCadStore((state) =>
    state.sketchSupport?.support?.kind === 'face' ? state.sketchSupport.support.face.faceId : null,
  );
  const sketchFaceBodyId = useCadStore((state) => selectActiveSketch(state)?.face?.bodyId ?? null);
  const sketchFaceId = useCadStore((state) => selectActiveSketch(state)?.face?.faceId ?? null);
  const storeApi = useCadStoreApi();

  // A single highlighted body: the selected feature's derived solid, or the selected primitive.
  const selectedBodyId = selectedFeatureId ?? selectedEntityId;

  // While sketching the opaque 2D overlay owns interaction; the support command
  // enables plane + planar-face picking; armed picking waits for a face click;
  // otherwise face hover/select is available for the preselect workflow.
  const facePickMode: FacePickMode = inSketch ? 'off' : inSupport ? 'support' : faceSketchArmed ? 'armed' : 'hover';
  const modelDimmed = inSketch || faceSketchArmed || inSupport;

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
      selectedEntityId: initial.selectedFeatureId ?? initial.selectedEntityId,
      viewport: {
        width: clampToAtLeastOnePixel(rect.width),
        height: clampToAtLeastOnePixel(rect.height),
      },
      onSelect: (bodyId) => storeApi.getState().selectBody(bodyId),
      onTransformChange: (entityId, transform) => storeApi.getState().updateEntity(entityId, { transform }),
      onHover: (bodyId) => storeApi.getState().setHovered(bodyId),
      onFaceHover: (pick) => storeApi.getState().setHoveredFace(pick),
      onFaceSelect: (pick) => storeApi.getState().selectFace(pick),
      onArmedFaceClick: (pick) => storeApi.getState().enterSketchOnFace(pick),
      onSupportFaceClick: (pick) => storeApi.getState().chooseSketchFace(pick),
      onSupportPlaneClick: (planeId) => storeApi.getState().chooseSketchPlane(planeId),
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
    sceneRef.current?.setSelection(selectedBodyId);
  }, [selectedBodyId]);

  useEffect(() => {
    sceneRef.current?.setHover(hoveredId);
  }, [hoveredId]);

  useEffect(() => {
    sceneRef.current?.setFacePickMode(facePickMode);
  }, [facePickMode]);

  useEffect(() => {
    sceneRef.current?.setModelDimmed(modelDimmed);
  }, [modelDimmed]);

  // The highlighted face is the support command's collected face when active, else the preselected face.
  useEffect(() => {
    const bodyId = supportFaceBodyId ?? selectedFaceBodyId;
    const faceId = supportFaceId ?? selectedFaceId;
    sceneRef.current?.setSelectedFace(bodyId && faceId ? { bodyId, faceId } : null);
  }, [selectedFaceBodyId, selectedFaceId, supportFaceBodyId, supportFaceId]);

  // Highlight the chosen/preselected origin plane so a picked plane support reads distinctly.
  useEffect(() => {
    sceneRef.current?.setSelectedPlane(supportPlane ?? selectedPlane);
  }, [supportPlane, selectedPlane]);

  useEffect(() => {
    sceneRef.current?.setProjection(projection);
  }, [projection]);

  // Entering a sketch snapshots the camera so finishing/cancelling restores it exactly.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !sketchFeatureId) return;
    scene.snapshotCamera();
    return () => scene.restoreCamera();
  }, [sketchFeatureId]);

  // Orient the camera down the support: a face sketch aligns to the face normal,
  // an origin-plane sketch looks straight down that plane's principal normal.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (sketchFaceBodyId && sketchFaceId) {
      const resolved = resolveFaceFrame(storeApi.getState().document, sketchFaceBodyId, sketchFaceId);
      if (resolved.ok) {
        scene.alignCameraToFace({
          origin: resolved.frame.origin,
          normal: resolved.frame.normal,
          yAxis: resolved.frame.yAxis,
        });
      }
    } else if (sketchPlane) {
      scene.setStandardView(PLANE_VIEW[sketchPlane]);
    }
  }, [sketchFeatureId, sketchFaceBodyId, sketchFaceId, sketchPlane, storeApi]);

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
