import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CadDocumentV1 } from '@swalha-cad/document';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { DocumentBar } from './DocumentBar.js';

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

function renderDocumentBar(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <DocumentBar />
    </CadStoreProvider>,
  );
  return store;
}

describe('DocumentBar', () => {
  it('shows the SWALHA CAD mark', () => {
    renderDocumentBar();

    expect(screen.getByText('SWALHA CAD')).toBeInTheDocument();
  });

  it('disables undo and redo when there is no history', () => {
    renderDocumentBar();

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('enables undo after a store mutation and undoes it on click', () => {
    const store = renderDocumentBar();
    act(() => {
      store.getState().createEntity('box');
    });
    const before = store.getState().document.entities.length;

    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(store.getState().document.entities).toHaveLength(before - 1);
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
  });

  it('downloads the current document as JSON when Save is clicked', () => {
    const store = renderDocumentBar();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(downloadState.downloadCadDocument).toHaveBeenCalledWith(store.getState().document);
  });

  it('exports the current document to binary STL when Export STL is clicked', () => {
    const store = renderDocumentBar();

    fireEvent.click(screen.getByRole('button', { name: 'Export STL' }));

    expect(exportState.exportDocumentToBinaryStl).toHaveBeenCalledWith(store.getState().document);
    expect(downloadState.downloadStl).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it('loads a successfully opened document into the store and shows no error', async () => {
    const store = renderDocumentBar();
    const loaded: CadDocumentV1 = { schemaVersion: 1, units: 'mm', entities: [] };
    openDocumentState.openCadDocumentFile.mockResolvedValueOnce({ success: true, document: loaded });
    const file = new File(['{}'], 'design.swcad.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Open'), { target: { files: [file] } });

    await waitFor(() => expect(store.getState().document).toEqual(loaded));
    expect(store.getState().canUndo).toBe(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a visible error and leaves the document unchanged when the opened file is invalid', async () => {
    const store = renderDocumentBar();
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

  it('offers accessible Help and Settings entry points', () => {
    renderDocumentBar();

    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});
