import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CadDocumentV1 } from '@swalha-cad/document';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { Toolbar } from './Toolbar.js';

const downloadState = vi.hoisted(() => ({
  downloadCadDocument: vi.fn(),
  downloadStl: vi.fn(),
}));
vi.mock('../io/download.js', () => downloadState);

const openDocumentState = vi.hoisted(() => ({
  openCadDocumentFile: vi.fn(),
}));
vi.mock('../io/open-document.js', () => openDocumentState);

const exportState = vi.hoisted(() => ({
  exportDocumentToBinaryStl: vi.fn(() => new Uint8Array([1, 2, 3])),
}));
vi.mock('@swalha-cad/export', () => exportState);

function renderToolbar(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <Toolbar />
    </CadStoreProvider>,
  );
  return store;
}

describe('Toolbar', () => {
  it('shows the SWALHA CAD title', () => {
    renderToolbar();

    expect(screen.getByText('SWALHA CAD')).toBeInTheDocument();
  });

  it('marks perspective as the active projection by default', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Perspective' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Orthographic' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches the store camera projection to orthographic', () => {
    const store = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Orthographic' }));

    expect(store.getState().cameraProjection).toBe('orthographic');
  });

  it('switches back to perspective', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().setCameraProjection('orthographic');
    renderToolbar(store);

    fireEvent.click(screen.getByRole('button', { name: 'Perspective' }));

    expect(store.getState().cameraProjection).toBe('perspective');
  });

  it('offers buttons to add each primitive kind', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: /add box/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add cylinder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add l-bracket/i })).toBeInTheDocument();
  });

  it('disables undo and redo when there is no history', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('undoes and redoes a create through the toolbar buttons', () => {
    const store = renderToolbar();
    const before = store.getState().document.entities.length;

    fireEvent.click(screen.getByRole('button', { name: /add box/i }));
    expect(store.getState().document.entities).toHaveLength(before + 1);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.getState().document.entities).toHaveLength(before);
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(store.getState().document.entities).toHaveLength(before + 1);
  });

  it('downloads the current document as JSON when Save is clicked', () => {
    const store = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(downloadState.downloadCadDocument).toHaveBeenCalledWith(store.getState().document);
  });

  it('exports the current document to binary STL when Export STL is clicked', () => {
    const store = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Export STL' }));

    expect(exportState.exportDocumentToBinaryStl).toHaveBeenCalledWith(store.getState().document);
    expect(downloadState.downloadStl).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it('loads a successfully opened document into the store and shows no error', async () => {
    const store = renderToolbar();
    const loaded: CadDocumentV1 = { schemaVersion: 1, units: 'mm', entities: [] };
    openDocumentState.openCadDocumentFile.mockResolvedValueOnce({ success: true, document: loaded });
    const file = new File(['{}'], 'design.swcad.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Open'), { target: { files: [file] } });

    await waitFor(() => expect(store.getState().document).toEqual(loaded));
    expect(store.getState().canUndo).toBe(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a visible error and leaves the document unchanged when the opened file is invalid', async () => {
    const store = renderToolbar();
    const before = store.getState().document;
    openDocumentState.openCadDocumentFile.mockResolvedValueOnce({
      success: false,
      error: 'not a valid document',
    });
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Open'), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid document');
    expect(store.getState().document).toBe(before);
  });

  it('clears a previous open error once a later file opens successfully', async () => {
    const store = renderToolbar();
    openDocumentState.openCadDocumentFile.mockResolvedValueOnce({ success: false, error: 'bad file' });
    const badFile = new File(['not json'], 'bad.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Open'), { target: { files: [badFile] } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    const loaded: CadDocumentV1 = { schemaVersion: 1, units: 'mm', entities: [] };
    openDocumentState.openCadDocumentFile.mockResolvedValueOnce({ success: true, document: loaded });
    const goodFile = new File(['{}'], 'good.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Open'), { target: { files: [goodFile] } });

    await waitFor(() => expect(store.getState().document).toEqual(loaded));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
