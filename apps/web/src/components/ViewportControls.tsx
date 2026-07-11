import { Box, Home, Square } from 'lucide-react';
import type { CameraProjection } from '../store/cad-store.js';
import { IconButton } from './ui/IconButton.js';
import { Separator } from './ui/Separator.js';
import { Tooltip } from './ui/Tooltip.js';

export interface ViewportControlsProps {
  projection: CameraProjection;
  onProjectionChange: (projection: CameraProjection) => void;
  onHome: () => void;
}

/** Compact floating navigation controls docked in a corner of the viewport. */
export function ViewportControls({ projection, onProjectionChange, onHome }: ViewportControlsProps) {
  return (
    <div className="viewport-controls" role="group" aria-label="Viewport navigation">
      <Tooltip content="Perspective projection">
        <IconButton
          aria-label="Perspective"
          aria-pressed={projection === 'perspective'}
          icon={<Box />}
          onClick={() => onProjectionChange('perspective')}
        />
      </Tooltip>
      <Tooltip content="Orthographic projection">
        <IconButton
          aria-label="Orthographic"
          aria-pressed={projection === 'orthographic'}
          icon={<Square />}
          onClick={() => onProjectionChange('orthographic')}
        />
      </Tooltip>
      <Separator orientation="vertical" className="viewport-controls__separator" />
      <Tooltip content="Reset to the home view">
        <IconButton aria-label="Home view" icon={<Home />} onClick={onHome} />
      </Tooltip>
    </div>
  );
}
