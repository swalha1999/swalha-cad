import type { ChangeEvent } from 'react';
import { useId, useState } from 'react';
import { exportDocumentToBinaryStl } from '@swalha-cad/export';
import type { CameraProjection } from '../store/cad-store.js';
import { useCadStore } from '../store/cad-store-context.js';
import { downloadCadDocument, downloadStl } from '../io/download.js';
import { openCadDocumentFile } from '../io/open-document.js';
import { AddPrimitiveMenu } from './AddPrimitiveMenu.js';

const PROJECTIONS: { mode: CameraProjection; label: string }[] = [
  { mode: 'perspective', label: 'Perspective' },
  { mode: 'orthographic', label: 'Orthographic' },
];

export function Toolbar() {
  const document = useCadStore((state) => state.document);
  const loadDocument = useCadStore((state) => state.loadDocument);
  const cameraProjection = useCadStore((state) => state.cameraProjection);
  const setCameraProjection = useCadStore((state) => state.setCameraProjection);
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
      <header className="toolbar">
        <span className="toolbar__title">SWALHA CAD</span>
        <AddPrimitiveMenu />
        <div className="toolbar__group" role="group" aria-label="Document">
          <button type="button" className="toolbar__button" onClick={() => downloadCadDocument(document)}>
            Save
          </button>
          <label htmlFor={openFileInputId} className="toolbar__button toolbar__file-label">
            Open
          </label>
          <input
            id={openFileInputId}
            type="file"
            accept=".json,.swcad.json,application/json"
            className="toolbar__file-input"
            onChange={(event) => void handleOpenFileChange(event)}
          />
          <button
            type="button"
            className="toolbar__button"
            onClick={() => downloadStl(exportDocumentToBinaryStl(document))}
          >
            Export STL
          </button>
        </div>
        <div className="toolbar__group" role="group" aria-label="History">
          <button type="button" className="toolbar__button" disabled={!canUndo} onClick={() => undo()}>
            Undo
          </button>
          <button type="button" className="toolbar__button" disabled={!canRedo} onClick={() => redo()}>
            Redo
          </button>
        </div>
        <div className="toolbar__group" role="group" aria-label="Camera projection">
          {PROJECTIONS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              className="toolbar__button"
              aria-pressed={cameraProjection === mode}
              onClick={() => setCameraProjection(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {openError !== null && (
        <p role="alert" className="toolbar__error">
          {openError}
        </p>
      )}
    </>
  );
}
