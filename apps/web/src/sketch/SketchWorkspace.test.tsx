import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { SketchWorkspace } from './SketchWorkspace.js';

function renderWorkspace() {
  const store = createCadStore();
  store.getState().enterSketch('XY');
  render(
    <CadStoreProvider store={store}>
      <SketchWorkspace />
    </CadStoreProvider>,
  );
  return store;
}

describe('SketchWorkspace', () => {
  it('exposes an accessible sketch-tools toolbar with each tool and the plane label', () => {
    renderWorkspace();

    expect(screen.getByRole('region', { name: 'Sketch workspace' })).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: 'Sketch tools' });
    expect(toolbar).toBeInTheDocument();
    for (const name of ['Point', 'Line', 'Rectangle', 'Circle', 'Construction']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Top Plane (XY)')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sketch canvas' })).toBeInTheDocument();
  });

  it('activates a tool and reflects it with aria-pressed', () => {
    const store = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));

    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
    expect(store.getState().sketch?.tool).toBe('rectangle');
  });

  it('toggles a tool off when its pressed button is clicked again', () => {
    const store = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }));

    expect(store.getState().sketch?.tool).toBeNull();
  });

  it('toggles construction mode', () => {
    const store = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Construction' }));

    expect(screen.getByRole('button', { name: 'Construction' })).toHaveAttribute('aria-pressed', 'true');
    expect(store.getState().sketch?.construction).toBe(true);
  });

  it('finishes the sketch and returns to the Part Studio, preserving the feature', () => {
    const store = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Finish Sketch' }));

    expect(store.getState().sketch).toBeNull();
    expect(store.getState().document.features).toHaveLength(1);
  });
});
