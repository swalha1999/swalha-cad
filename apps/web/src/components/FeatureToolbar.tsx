import { Move3d } from 'lucide-react';
import type { SketchPlane } from '@swalha-cad/document';
import { useCadStore } from '../store/cad-store-context.js';
import { AddPrimitiveMenu } from './AddPrimitiveMenu.js';
import { DropdownMenu } from './ui/DropdownMenu.js';
import { IconButton } from './ui/IconButton.js';
import { Separator } from './ui/Separator.js';
import { Tooltip } from './ui/Tooltip.js';

const SKETCH_PLANES: { plane: SketchPlane; label: string }[] = [
  { plane: 'XY', label: 'Top Plane (XY)' },
  { plane: 'XZ', label: 'Front Plane (XZ)' },
  { plane: 'YZ', label: 'Right Plane (YZ)' },
];

/**
 * Second, icon-first bar beneath the document bar. The Sketch action opens an
 * origin-plane picker (XY/XZ/YZ) that creates a sketch feature and enters the
 * focused 2D sketch workspace; Extrude remains reserved for a later milestone
 * task. Primitive creation stays available alongside.
 */
export function FeatureToolbar() {
  const enterSketch = useCadStore((state) => state.enterSketch);
  const inSketch = useCadStore((state) => state.sketch !== null);
  const startExtrude = useCadStore((state) => state.startExtrude);
  const extruding = useCadStore((state) => state.extrude !== null);
  const hasSketch = useCadStore((state) => state.document.features.some((feature) => feature.kind === 'sketch'));

  // Extrude is a Part Studio operation: available once a sketch exists, never while
  // sketching, and pressed while its contextual task panel is open.
  const extrudeDisabled = inSketch || !hasSketch;

  return (
    <div className="feature-toolbar" role="toolbar" aria-label="Feature toolbar">
      <DropdownMenu
        label="Sketch"
        className="feature-toolbar__sketch"
        items={SKETCH_PLANES.map(({ plane, label }) => ({
          id: plane,
          label,
          disabled: inSketch,
          onSelect: () => enterSketch(plane),
        }))}
      />
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

      <AddPrimitiveMenu />
    </div>
  );
}
