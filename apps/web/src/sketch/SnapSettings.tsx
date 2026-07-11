import { Magnet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../components/ui/IconButton.js';
import { Tooltip } from '../components/ui/Tooltip.js';
import { useCadStore } from '../store/cad-store-context.js';
import { SNAP_TARGETS } from './snap-settings.js';

/**
 * A dense popover of independent snap toggles for the free-coordinate canvas.
 * Each target (endpoints, midpoints, centers, intersections, horizontal/vertical
 * inference, origin, and grid) is its own checkbox writing straight to the
 * session-persisted store settings, so nothing here quantizes geometry — the
 * toggles only decide which optional aids the cursor may snap to. Grid *display*
 * is a separate toolbar control; this panel governs grid *snapping* only.
 */
export function SnapSettings() {
  const snapSettings = useCadStore((state) => state.snapSettings);
  const toggleSnapTarget = useCadStore((state) => state.toggleSnapTarget);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div className="snap-settings" ref={containerRef}>
      <Tooltip content="Snap settings">
        <IconButton
          aria-label="Snap settings"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-pressed={open}
          icon={<Magnet />}
          onClick={() => setOpen((value) => !value)}
        />
      </Tooltip>
      {open && (
        <div className="snap-settings__panel" role="group" aria-label="Snap settings">
          {SNAP_TARGETS.map(({ key, label }) => (
            <label key={key} className="snap-settings__row">
              <input type="checkbox" checked={snapSettings[key]} onChange={() => toggleSnapTarget(key)} />
              <span>{label}</span>
            </label>
          ))}
          <p className="snap-settings__hint">Hold Alt to bypass all snaps.</p>
        </div>
      )}
    </div>
  );
}
