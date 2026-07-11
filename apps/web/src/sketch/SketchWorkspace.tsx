import { Grid3x3 } from 'lucide-react';
import { useCadStore } from '../store/cad-store-context.js';
import { IconButton } from '../components/ui/IconButton.js';
import { Separator } from '../components/ui/Separator.js';
import { Tooltip } from '../components/ui/Tooltip.js';
import { ConstraintToolbar } from './ConstraintToolbar.js';
import { SketchOverlay } from './SketchOverlay.js';
import { SketchToolGroups } from './SketchToolGroups.js';
import { SnapSettings } from './SnapSettings.js';

const PLANE_LABEL = { XY: 'Top Plane (XY)', XZ: 'Front Plane (XZ)', YZ: 'Right Plane (YZ)' } as const;

/**
 * The focused sketch workspace: a dense, icon-first toolbar of grouped
 * creation/constraint tools (with shortcuts, tooltips, and overflow
 * infrastructure via {@link SketchToolGroups}) plus independent snap settings and
 * a grid-visibility toggle, over the free-coordinate 2D {@link SketchOverlay}.
 * Tool selection, snapping, and finishing route through the store so the
 * underlying feature is created/edited entirely through commands/history.
 */
export function SketchWorkspace() {
  const session = useCadStore((state) => state.sketch);
  const gridVisible = useCadStore((state) => state.gridVisible);
  const setGridVisible = useCadStore((state) => state.setGridVisible);
  const finishSketch = useCadStore((state) => state.finishSketch);

  if (!session) return null;

  return (
    <section className="sketch-workspace" aria-label="Sketch workspace">
      <div className="sketch-workspace__toolbar" role="toolbar" aria-label="Sketch tools">
        <span className="sketch-workspace__plane">{PLANE_LABEL[session.plane]}</span>
        <Separator orientation="vertical" className="sketch-workspace__separator" />
        <SketchToolGroups />
        <Separator orientation="vertical" className="sketch-workspace__separator" />
        <ConstraintToolbar />
        <Separator orientation="vertical" className="sketch-workspace__separator" />
        <div className="sketch-tool-group" role="group" aria-label="View aids">
          <Tooltip content="Show grid (G)">
            <IconButton
              aria-label="Show grid"
              aria-pressed={gridVisible}
              aria-keyshortcuts="G"
              icon={<Grid3x3 />}
              onClick={() => setGridVisible(!gridVisible)}
            />
          </Tooltip>
          <SnapSettings />
        </div>
        <button type="button" className="btn btn--default btn--sm sketch-workspace__finish" onClick={() => finishSketch()}>
          Finish Sketch
        </button>
      </div>
      <div className="sketch-workspace__canvas">
        <SketchOverlay />
      </div>
    </section>
  );
}
