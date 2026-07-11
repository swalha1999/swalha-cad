import { Circle, Dot, Minus, Ruler, Square } from 'lucide-react';
import type { ComponentType } from 'react';
import { useCadStore } from '../store/cad-store-context.js';
import { IconButton } from '../components/ui/IconButton.js';
import { Separator } from '../components/ui/Separator.js';
import { Tooltip } from '../components/ui/Tooltip.js';
import { SketchOverlay } from './SketchOverlay.js';
import type { SketchToolKind } from './tools/types.js';

const TOOLS: { kind: SketchToolKind; label: string; icon: ComponentType }[] = [
  { kind: 'point', label: 'Point', icon: Dot },
  { kind: 'line', label: 'Line', icon: Minus },
  { kind: 'rectangle', label: 'Rectangle', icon: Square },
  { kind: 'circle', label: 'Circle', icon: Circle },
];

const PLANE_LABEL = { XY: 'Top Plane (XY)', XZ: 'Front Plane (XZ)', YZ: 'Right Plane (YZ)' } as const;

/**
 * The focused sketch workspace: a tool toolbar (point / connected line /
 * rectangle / circle, plus a construction toggle and Finish Sketch) over the 2D
 * {@link SketchOverlay}. Tool selection and finishing route through the store so
 * the underlying feature is created/edited entirely through commands/history.
 */
export function SketchWorkspace() {
  const session = useCadStore((state) => state.sketch);
  const setSketchTool = useCadStore((state) => state.setSketchTool);
  const setSketchConstruction = useCadStore((state) => state.setSketchConstruction);
  const finishSketch = useCadStore((state) => state.finishSketch);

  if (!session) return null;

  return (
    <section className="sketch-workspace" aria-label="Sketch workspace">
      <div className="sketch-workspace__toolbar" role="toolbar" aria-label="Sketch tools">
        <span className="sketch-workspace__plane">{PLANE_LABEL[session.plane]}</span>
        <Separator orientation="vertical" className="sketch-workspace__separator" />
        {TOOLS.map(({ kind, label, icon: Icon }) => (
          <Tooltip key={kind} content={label}>
            <IconButton
              aria-label={label}
              aria-pressed={session.tool === kind}
              icon={<Icon />}
              onClick={() => setSketchTool(session.tool === kind ? null : kind)}
            />
          </Tooltip>
        ))}
        <Separator orientation="vertical" className="sketch-workspace__separator" />
        <Tooltip content="Construction geometry">
          <IconButton
            aria-label="Construction"
            aria-pressed={session.construction}
            icon={<Ruler />}
            onClick={() => setSketchConstruction(!session.construction)}
          />
        </Tooltip>
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
