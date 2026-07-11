import { useEffect, useState } from 'react';
import { ContextPanel } from './components/ContextPanel.js';
import { DocumentBar } from './components/DocumentBar.js';
import { FeatureToolbar } from './components/FeatureToolbar.js';
import { FeatureTree } from './components/FeatureTree.js';
import { ResizablePanel } from './components/ResizablePanel.js';
import { StatusBar } from './components/StatusBar.js';
import { Viewport } from './components/Viewport.js';
import { SketchWorkspace } from './sketch/SketchWorkspace.js';
import { CadStoreProvider } from './store/cad-store-context.js';
import { createCadStore } from './store/cad-store.js';
import { useCadStore } from './store/cad-store-context.js';

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
    </div>
  );
}

export function App() {
  const [store] = useState(() => createCadStore());

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const direction = undoRedoDirection(event);
      if (!direction) return;
      event.preventDefault();
      store.getState()[direction]();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store]);

  return (
    <CadStoreProvider store={store}>
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
      </div>
    </CadStoreProvider>
  );
}
