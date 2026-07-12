import type { SolveStatus } from '@swalha-cad/geometry';
import { useCadStore } from '../store/cad-store-context.js';
import { selectSelectedEntity } from '../store/cad-store.js';

const PROJECTION_LABEL = { perspective: 'Perspective', orthographic: 'Orthographic' } as const;

const SOLVE_LABEL: Record<SolveStatus, string> = {
  'under-constrained': 'Under-constrained',
  'fully-constrained': 'Fully constrained',
  conflicting: 'Conflicting',
};

/** Bottom Part Studio/status strip: tab, units, selection, camera projection, and — while sketching — solver state. */
export function StatusBar() {
  const units = useCadStore((state) => state.document.units);
  const bodyCount = useCadStore((state) => state.document.entities.length);
  const selectedEntity = useCadStore(selectSelectedEntity);
  const cameraProjection = useCadStore((state) => state.cameraProjection);
  const sketchSolve = useCadStore((state) => state.sketchSolve);
  const faceSketchArmed = useCadStore((state) => state.faceSketchArmed);
  const faceSketchError = useCadStore((state) => state.faceSketchError);

  return (
    <footer className="status-bar">
      <div className="status-bar__tabs" role="tablist" aria-label="Part Studio tabs">
        <button type="button" role="tab" aria-selected="true" className="status-bar__tab">
          Part Studio 1
        </button>
      </div>
      <div className="status-bar__info">
        {faceSketchError ? (
          <span className="status-bar__item status-bar__item--error" role="alert">
            {faceSketchError}
          </span>
        ) : faceSketchArmed ? (
          <span className="status-bar__item status-bar__item--hint" role="status">
            Select a planar face to sketch on
          </span>
        ) : null}
        <span className="status-bar__item">{units}</span>
        <span className="status-bar__item">{bodyCount} bodies</span>
        {sketchSolve ? (
          <span className={`status-bar__item status-bar__solve status-bar__solve--${sketchSolve.status}`}>{SOLVE_LABEL[sketchSolve.status]}</span>
        ) : (
          <span className="status-bar__item">{selectedEntity ? selectedEntity.name : 'No selection'}</span>
        )}
        <span className="status-bar__item">{PROJECTION_LABEL[cameraProjection]}</span>
      </div>
    </footer>
  );
}
