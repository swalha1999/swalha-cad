import { Box, Cylinder, Shapes } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Primitive } from '@swalha-cad/document';
import { useCadStore } from '../store/cad-store-context.js';
import { IconButton } from './ui/IconButton.js';
import { Tooltip } from './ui/Tooltip.js';

const PRIMITIVE_KINDS: { kind: Primitive['kind']; label: string; icon: ComponentType }[] = [
  { kind: 'box', label: 'Add Box', icon: Box },
  { kind: 'cylinder', label: 'Add Cylinder', icon: Cylinder },
  { kind: 'lBracket', label: 'Add L-Bracket', icon: Shapes },
];

export function AddPrimitiveMenu() {
  const createEntity = useCadStore((state) => state.createEntity);

  return (
    <div className="feature-toolbar__group" role="group" aria-label="Add primitive">
      {PRIMITIVE_KINDS.map(({ kind, label, icon: Icon }) => (
        <Tooltip key={kind} content={label}>
          <IconButton aria-label={label} icon={<Icon />} onClick={() => createEntity(kind)} />
        </Tooltip>
      ))}
    </div>
  );
}
