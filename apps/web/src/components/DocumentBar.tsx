import type { ChangeEvent } from 'react';
import { useId, useState } from 'react';
import { CircleHelp, Download, FolderOpen, Redo2, Save, Settings, Undo2 } from 'lucide-react';
import { exportDocumentToBinaryStl } from '@swalha-cad/export';
import { useCadStore } from '../store/cad-store-context.js';
import { downloadCadDocument, downloadStl } from '../io/download.js';
import { openCadDocumentFile } from '../io/open-document.js';
import { IconButton } from './ui/IconButton.js';
import { Separator } from './ui/Separator.js';
import { Tooltip } from './ui/Tooltip.js';

/**
 * Top-level document bar: the SWALHA CAD mark, document status, file actions,
 * and undo/redo. Preserves every M1 file/history behavior and accessible name
 * (`Save`, `Open`, `Export STL`, `Undo`, `Redo`) so existing browser workflows
 * and their e2e coverage keep working unchanged.
 */
export function DocumentBar() {
  const document = useCadStore((state) => state.document);
  const loadDocument = useCadStore((state) => state.loadDocument);
  const canUndo = useCadStore((state) => state.canUndo);
  const canRedo = useCadStore((state) => state.canRedo);
  const undo = useCadStore((state) => state.undo);
  const redo = useCadStore((state) => state.redo);
  const [openError, setOpenError] = useState<string | null>(null);
  const openFileInputId = useId();

  async function handleOpenFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const result = await openCadDocumentFile(file);
    if (!result.success) {
      setOpenError(result.error);
      return;
    }
    setOpenError(null);
    loadDocument(result.document);
  }

  return (
    <>
      <header className="document-bar">
        <div className="document-bar__brand">
          <span className="document-bar__mark">SWALHA CAD</span>
          <span className="document-bar__doc-name">Untitled Part Studio</span>
        </div>

        <div className="document-bar__actions" role="group" aria-label="Document">
          <Tooltip content="Save document (JSON)">
            <IconButton aria-label="Save" icon={<Save />} onClick={() => downloadCadDocument(document)} />
          </Tooltip>
          <Tooltip content="Open a saved document">
            <label htmlFor={openFileInputId} className="document-bar__open-label">
              <FolderOpen aria-hidden="true" />
              Open
            </label>
          </Tooltip>
          <input
            id={openFileInputId}
            type="file"
            accept=".json,.swcad.json,application/json"
            className="document-bar__file-input"
            onChange={(event) => void handleOpenFileChange(event)}
          />
          <Tooltip content="Export STL for 3D printing">
            <IconButton
              aria-label="Export STL"
              icon={<Download />}
              onClick={() => downloadStl(exportDocumentToBinaryStl(document))}
            />
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="document-bar__separator" />

        <div className="document-bar__history" role="group" aria-label="History">
          <Tooltip content="Undo (Ctrl+Z)">
            <IconButton aria-label="Undo" icon={<Undo2 />} disabled={!canUndo} onClick={() => undo()} />
          </Tooltip>
          <Tooltip content="Redo (Ctrl+Shift+Z)">
            <IconButton aria-label="Redo" icon={<Redo2 />} disabled={!canRedo} onClick={() => redo()} />
          </Tooltip>
        </div>

        <div className="document-bar__meta">
          <Tooltip content="Help">
            <IconButton aria-label="Help" icon={<CircleHelp />} />
          </Tooltip>
          <Tooltip content="Settings">
            <IconButton aria-label="Settings" icon={<Settings />} />
          </Tooltip>
        </div>
      </header>
      {openError !== null && (
        <p role="alert" className="document-bar__error">
          {openError}
        </p>
      )}
    </>
  );
}
