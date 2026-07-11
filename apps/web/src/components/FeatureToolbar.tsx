import { Move3d, PencilRuler } from 'lucide-react';
import { AddPrimitiveMenu } from './AddPrimitiveMenu.js';
import { IconButton } from './ui/IconButton.js';
import { Separator } from './ui/Separator.js';
import { Tooltip } from './ui/Tooltip.js';

/**
 * Second, icon-first bar beneath the document bar. Sketch/Extrude are shown
 * (and disabled) to establish the Part Studio's feature-based information
 * architecture ahead of the sketch/extrude milestone task; primitive creation
 * is the only feature-creation path M2 Task 2 ships.
 */
export function FeatureToolbar() {
  return (
    <div className="feature-toolbar" role="toolbar" aria-label="Feature toolbar">
      <Tooltip content="Sketch (coming in a later milestone)">
        <IconButton aria-label="Sketch" icon={<PencilRuler />} disabled aria-pressed={false} />
      </Tooltip>
      <Tooltip content="Extrude (coming in a later milestone)">
        <IconButton aria-label="Extrude" icon={<Move3d />} disabled aria-pressed={false} />
      </Tooltip>

      <Separator orientation="vertical" className="feature-toolbar__separator" />

      <AddPrimitiveMenu />
    </div>
  );
}
