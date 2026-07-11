import type { StandardView } from '../viewport/create-viewport-scene.js';

export interface ViewCubeProps {
  onSelectView: (view: StandardView) => void;
}

/**
 * Compact viewport overlay: a small Onshape-style orientation cube plus an
 * X/Y/Z axis triad. Face buttons snap the camera to a standard view; the
 * triad is purely decorative (a static home-view indicator, not synced to
 * the live camera orientation) and hidden from assistive tech.
 */
export function ViewCube({ onSelectView }: ViewCubeProps) {
  return (
    <div className="view-cube" role="group" aria-label="View orientation">
      <button type="button" className="view-cube__face view-cube__face--top" onClick={() => onSelectView('top')}>
        <span aria-hidden="true">TOP</span>
        <span className="visually-hidden">Top view</span>
      </button>
      <button type="button" className="view-cube__face view-cube__face--front" onClick={() => onSelectView('front')}>
        <span aria-hidden="true">FRONT</span>
        <span className="visually-hidden">Front view</span>
      </button>
      <button type="button" className="view-cube__face view-cube__face--right" onClick={() => onSelectView('right')}>
        <span aria-hidden="true">RIGHT</span>
        <span className="visually-hidden">Right view</span>
      </button>
      <button
        type="button"
        className="view-cube__home"
        onClick={() => onSelectView('home')}
        aria-label="Isometric view"
      >
        <span aria-hidden="true">⌂</span>
      </button>

      <div className="view-cube__axis-triad" aria-hidden="true">
        <span className="view-cube__axis view-cube__axis--x">X</span>
        <span className="view-cube__axis view-cube__axis--y">Y</span>
        <span className="view-cube__axis view-cube__axis--z">Z</span>
      </div>
    </div>
  );
}
