import type { CameraProjection } from '../store/cad-store.js';
import { useCadStore } from '../store/cad-store-context.js';
import { AddPrimitiveMenu } from './AddPrimitiveMenu.js';

const PROJECTIONS: { mode: CameraProjection; label: string }[] = [
  { mode: 'perspective', label: 'Perspective' },
  { mode: 'orthographic', label: 'Orthographic' },
];

export function Toolbar() {
  const cameraProjection = useCadStore((state) => state.cameraProjection);
  const setCameraProjection = useCadStore((state) => state.setCameraProjection);
  const canUndo = useCadStore((state) => state.canUndo);
  const canRedo = useCadStore((state) => state.canRedo);
  const undo = useCadStore((state) => state.undo);
  const redo = useCadStore((state) => state.redo);

  return (
    <header className="toolbar">
      <span className="toolbar__title">SWALHA CAD</span>
      <AddPrimitiveMenu />
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
  );
}
