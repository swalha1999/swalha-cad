import { useCadStore } from '../store/cad-store-context.js';
import { selectSelectedEntity } from '../store/cad-store.js';

const PROJECTION_LABEL = { perspective: 'Perspective', orthographic: 'Orthographic' } as const;

/** Bottom Part Studio/status strip: tab, units, selection, and camera projection hints. */
export function StatusBar() {
  const units = useCadStore((state) => state.document.units);
  const bodyCount = useCadStore((state) => state.document.entities.length);
  const selectedEntity = useCadStore(selectSelectedEntity);
  const cameraProjection = useCadStore((state) => state.cameraProjection);

  return (
    <footer className="status-bar">
      <div className="status-bar__tabs" role="tablist" aria-label="Part Studio tabs">
        <button type="button" role="tab" aria-selected="true" className="status-bar__tab">
          Part Studio 1
        </button>
      </div>
      <div className="status-bar__info">
        <span className="status-bar__item">{units}</span>
        <span className="status-bar__item">{bodyCount} bodies</span>
        <span className="status-bar__item">{selectedEntity ? selectedEntity.name : 'No selection'}</span>
        <span className="status-bar__item">{PROJECTION_LABEL[cameraProjection]}</span>
      </div>
    </footer>
  );
}
