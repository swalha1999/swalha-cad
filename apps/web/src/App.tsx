import { useState } from 'react';
import { PropertiesPanel } from './components/PropertiesPanel.js';
import { SceneTree } from './components/SceneTree.js';
import { Toolbar } from './components/Toolbar.js';
import { Viewport } from './components/Viewport.js';
import { CadStoreProvider } from './store/cad-store-context.js';
import { createCadStore } from './store/cad-store.js';

export function App() {
  const [store] = useState(() => createCadStore());

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
