import type { CadDocumentV2 } from '@swalha-cad/document';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { SketchSupportBanner } from './SketchSupportBanner.js';
import { SketchSupportPanel } from './SketchSupportPanel.js';

const IDENTITY = { rotationDeg: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };

function documentWithBox(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    features: [],
    entities: [
      { id: 'box', name: 'Box', primitive: { kind: 'box', width: 40, height: 40, depth: 40 }, transform: { translation: [0, 0, 0], ...IDENTITY }, visible: true },
    ],
  };
}

function renderPanel(store = createCadStore(documentWithBox())) {
  render(
    <CadStoreProvider store={store}>
      <SketchSupportBanner />
      <SketchSupportPanel />
    </CadStoreProvider>,
  );
  return store;
}

describe('SketchSupportPanel + banner', () => {
  it('renders nothing when no support command is active', () => {
    renderPanel();
    expect(screen.queryByRole('form', { name: 'Sketch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Select a sketch plane or planar face' })).not.toBeInTheDocument();
  });

  it('shows the banner, the draft heading, and a required empty collector when the command opens', () => {
    const store = createCadStore(documentWithBox());
    store.getState().startSketch();
    renderPanel(store);

    expect(screen.getByRole('status', { name: 'Select a sketch plane or planar face' })).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Sketch' });
    expect(form).toBeInTheDocument();
    expect(screen.getByText('Sketch 1')).toBeInTheDocument();
    expect(screen.getByText('Select a plane or planar face')).toBeInTheDocument();
    // Creation stays blocked until a support is chosen.
    expect(screen.getByRole('button', { name: 'Create sketch' })).toBeDisabled();
  });

  it('fills the collector and enables Create sketch once a plane is chosen', () => {
    const store = createCadStore(documentWithBox());
    store.getState().startSketch();
    store.getState().chooseSketchPlane('XY');
    renderPanel(store);

    expect(screen.getByText('Top plane')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Create sketch' });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(store.getState().sketch?.plane).toBe('XY');
    expect(store.getState().sketchSupport).toBeNull();
  });

  it('describes a collected planar face', () => {
    const store = createCadStore(documentWithBox());
    store.getState().startSketch();
    store.getState().chooseSketchFace({ bodyId: 'box', faceId: '+z' });
    renderPanel(store);

    expect(screen.getByText('Planar face')).toBeInTheDocument();
  });

  it('surfaces a diagnostic for an invalid target and keeps the collector empty', () => {
    const store = createCadStore(documentWithBox());
    store.getState().startSketch();
    store.getState().confirmSketchSupport(); // empty confirm -> diagnostic
    renderPanel(store);

    expect(screen.getByRole('alert')).toHaveTextContent(/select a sketch plane/i);
  });

  it('cancel from the panel restores the prior state without mutation', () => {
    const store = createCadStore(documentWithBox());
    store.getState().startSketch();
    renderPanel(store);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel sketch' }));
    expect(store.getState().sketchSupport).toBeNull();
    expect(store.getState().document.features).toHaveLength(0);
  });

  it('cancel from the banner dismisses the command', () => {
    const store = createCadStore(documentWithBox());
    store.getState().startSketch();
    renderPanel(store);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss sketch prompt' }));
    expect(store.getState().sketchSupport).toBeNull();
  });
});
