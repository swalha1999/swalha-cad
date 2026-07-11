import type { CameraProjection } from '../store/cad-store.js';
import { useCadStore } from '../store/cad-store-context.js';

const PROJECTIONS: { mode: CameraProjection; label: string }[] = [
  { mode: 'perspective', label: 'Perspective' },
  { mode: 'orthographic', label: 'Orthographic' },
];

export function Toolbar() {
  const cameraProjection = useCadStore((state) => state.cameraProjection);
  const setCameraProjection = useCadStore((state) => state.setCameraProjection);

  return (
    <header className="toolbar">
      <span className="toolbar__title">SWALHA CAD</span>
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
