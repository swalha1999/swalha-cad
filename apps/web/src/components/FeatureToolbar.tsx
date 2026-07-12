import { Move3d, PencilRuler } from 'lucide-react';
import { useCadStore } from '../store/cad-store-context.js';
import { AddPrimitiveMenu } from './AddPrimitiveMenu.js';
import { Button } from './ui/Button.js';
import { IconButton } from './ui/IconButton.js';
import { Separator } from './ui/Separator.js';
import { Tooltip } from './ui/Tooltip.js';

/**
 * Second, icon-first bar beneath the document bar. The single Sketch action is
 * the unified entry point: with an origin plane or planar face already
 * preselected it enters the sketch immediately; otherwise it opens the
 * nonblocking support-selection command (banner + task panel) so the user can
 * choose a support. Extrude and primitive creation stay available at rest but
 * are disabled while a support is being chosen or a sketch is active.
 */
export function FeatureToolbar() {
  const startSketch = useCadStore((state) => state.startSketch);
  const inSketch = useCadStore((state) => state.sketch !== null);
  const inSupport = useCadStore((state) => state.sketchSupport !== null);
  const startExtrude = useCadStore((state) => state.startExtrude);
  const extruding = useCadStore((state) => state.extrude !== null);
  const hasSketch = useCadStore((state) => state.document.features.some((feature) => feature.kind === 'sketch'));

  // Extrude is a Part Studio operation: available once a sketch exists, never while
  // sketching or choosing a sketch support, and pressed while its task panel is open.
  const extrudeDisabled = inSketch || inSupport || !hasSketch;

  return (
    <div className="feature-toolbar" role="toolbar" aria-label="Feature toolbar">
      <Tooltip content="Sketch — select a plane or planar face">
        <Button
          variant="secondary"
          size="sm"
          className="feature-toolbar__sketch"
          aria-label="Sketch"
          aria-pressed={inSketch || inSupport}
          disabled={inSketch || extruding}
          onClick={() => startSketch()}
        >
          <PencilRuler aria-hidden="true" />
          Sketch
        </Button>
      </Tooltip>
      <Tooltip content={extrudeDisabled ? 'Create a sketch profile to extrude' : 'Extrude a sketch profile into a solid'}>
        <IconButton
          aria-label="Extrude"
          icon={<Move3d />}
          disabled={extrudeDisabled}
          aria-pressed={extruding}
          onClick={() => startExtrude()}
        />
      </Tooltip>

      <Separator orientation="vertical" className="feature-toolbar__separator" />

      <AddPrimitiveMenu disabled={inSupport} />
    </div>
  );
}
