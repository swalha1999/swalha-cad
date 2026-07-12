import { useEffect, useState } from 'react';
import { ContextPanel } from './components/ContextPanel.js';
import { DeleteConfirmDialog } from './components/DeleteConfirmDialog.js';
import { DocumentBar } from './components/DocumentBar.js';
import { FeatureToolbar } from './components/FeatureToolbar.js';
import { FeatureTree } from './components/FeatureTree.js';
import { ResizablePanel } from './components/ResizablePanel.js';
import { StatusBar } from './components/StatusBar.js';
import { Viewport } from './components/Viewport.js';
import { ExtrudePreview } from './features/ExtrudePreview.js';
import { SketchSupportBanner } from './features/SketchSupportBanner.js';
import { handleGlobalDelete } from './interactions/delete-keys.js';
import { handleSketchSupportKey } from './interactions/sketch-support-keys.js';
import { SketchWorkspace } from './sketch/SketchWorkspace.js';
import { CadStoreProvider } from './store/cad-store-context.js';
import { createCadStore } from './store/cad-store.js';
import { useCadStore, useCadStoreApi } from './store/cad-store-context.js';

/** True for the "undo" chord (Ctrl/Cmd+Z) and "redo" chords (Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y). */
function undoRedoDirection(event: KeyboardEvent): 'undo' | 'redo' | null {
  const isModified = event.ctrlKey || event.metaKey;
  if (!isModified) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y') return 'redo';
  return null;
}

/** Center column: the 3D viewport with the focused 2D sketch workspace layered on top when active. */
function WorkspaceCenter() {
  const inSketch = useCadStore((state) => state.sketch !== null);
  return (
    <div className="part-studio__center">
      <Viewport />
      {inSketch ? <SketchWorkspace /> : null}
      <SketchSupportBanner />
      <ExtrudePreview />
    </div>
  );
}

/** Renders the dependency-impact confirmation while a cascade deletion is pending. */
function PendingDeletionDialog() {
  const plan = useCadStore((state) => state.pendingDeletion);
  const confirmDeletion = useCadStore((state) => state.confirmDeletion);
  const cancelDeletion = useCadStore((state) => state.cancelDeletion);
  if (!plan) return null;
  return <DeleteConfirmDialog plan={plan} onConfirm={confirmDeletion} onCancel={cancelDeletion} />;
}

/** Window-level keyboard: undo/redo chords and Onshape-style Delete/Backspace deletion with focus guards. */
function useGlobalKeyboard(): void {
  const storeApi = useCadStoreApi();
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      // The sketch support-selection command claims Enter (confirm) / Escape (cancel)
      // first, but only when text editing does not own focus (its own guard).
      if (handleSketchSupportKey(storeApi, event)) {
        event.preventDefault();
        return;
      }
      // Deletion first: preventDefault only when a CAD deletion is actually handled,
      // so typing Backspace in a field never both deletes geometry and navigates back.
      if (handleGlobalDelete(storeApi, event)) {
        event.preventDefault();
        return;
      }
      const direction = undoRedoDirection(event);
      if (!direction) return;
      event.preventDefault();
      storeApi.getState()[direction]();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [storeApi]);
}

function PartStudio() {
  useGlobalKeyboard();
  return (
    <div className="part-studio">
      <DocumentBar />
      <FeatureToolbar />
      <div className="part-studio__body">
        <ResizablePanel side="left" label="Feature Tree" defaultWidth={260} minWidth={200} maxWidth={420}>
          <FeatureTree />
        </ResizablePanel>
        <WorkspaceCenter />
        <ResizablePanel side="right" label="Properties" defaultWidth={288} minWidth={240} maxWidth={440}>
          <ContextPanel />
        </ResizablePanel>
      </div>
      <StatusBar />
      <PendingDeletionDialog />
    </div>
  );
}

export function App() {
  const [store] = useState(() => createCadStore());

  return (
    <CadStoreProvider store={store}>
      <PartStudio />
    </CadStoreProvider>
  );
}
