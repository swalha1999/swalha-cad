import type { Primitive } from '@swalha-cad/document';
import { useCadStore } from '../store/cad-store-context.js';

const PRIMITIVE_KINDS: { kind: Primitive['kind']; label: string }[] = [
  { kind: 'box', label: 'Add Box' },
  { kind: 'cylinder', label: 'Add Cylinder' },
  { kind: 'lBracket', label: 'Add L-Bracket' },
];

export function AddPrimitiveMenu() {
  const createEntity = useCadStore((state) => state.createEntity);

  return (
    <div className="toolbar__group" role="group" aria-label="Add primitive">
      {PRIMITIVE_KINDS.map(({ kind, label }) => (
        <button key={kind} type="button" className="toolbar__button" onClick={() => createEntity(kind)}>
          {label}
        </button>
      ))}
    </div>
  );
}
