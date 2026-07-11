import { useEffect, useState } from 'react';
import { PropertiesPanel } from './components/PropertiesPanel.js';
import { SceneTree } from './components/SceneTree.js';
import { Toolbar } from './components/Toolbar.js';
import { Viewport } from './components/Viewport.js';
import { CadStoreProvider } from './store/cad-store-context.js';
import { createCadStore } from './store/cad-store.js';

/** True for the "undo" chord (Ctrl/Cmd+Z) and "redo" chords (Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y). */
function undoRedoDirection(event: KeyboardEvent): 'undo' | 'redo' | null {
  const isModified = event.ctrlKey || event.metaKey;
  if (!isModified) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y') return 'redo';
  return null;
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
      <div className="app">
        <Toolbar />
        <div className="app__columns">
          <SceneTree />
          <Viewport />
          <PropertiesPanel />
        </div>
      </div>
    </CadStoreProvider>
  );
}
