import { Info, X } from 'lucide-react';
import { useCadStore } from '../store/cad-store-context.js';
import { IconButton } from '../components/ui/IconButton.js';

/**
 * The top-center "Select a sketch plane or planar face" banner shown while the
 * Sketch support-selection command is active (matching the reference). It reads
 * as a status region so assistive tech announces the prompt, and offers an
 * inline dismiss that cancels the command without mutating the document.
 */
export function SketchSupportBanner() {
  const inSupport = useCadStore((state) => state.sketchSupport !== null);
  const error = useCadStore((state) => state.sketchSupport?.error ?? null);
  const cancelSketchSupport = useCadStore((state) => state.cancelSketchSupport);

  if (!inSupport) return null;

  return (
    <div className="sketch-support-banner" role="status" aria-label="Select a sketch plane or planar face">
      <Info className="sketch-support-banner__icon" aria-hidden="true" />
      <span className="sketch-support-banner__label">
        {error ?? 'Select a sketch plane or planar face'}
      </span>
      <IconButton
        aria-label="Dismiss sketch prompt"
        variant="ghost"
        icon={<X />}
        onClick={() => cancelSketchSupport()}
      />
    </div>
  );
}
