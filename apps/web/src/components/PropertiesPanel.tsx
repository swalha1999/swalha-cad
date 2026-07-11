import type { CadEntity, CadEntityPatch, Primitive } from '@swalha-cad/document';
import { useCadStore } from '../store/cad-store-context.js';
import { selectSelectedEntity } from '../store/cad-store.js';
import { NumericField } from './NumericField.js';
import { TransformFields } from './TransformFields.js';

interface DimensionField {
  label: string;
  value: number;
  unit?: string;
  onCommit: (next: number) => boolean;
}

function dimensionFieldsFor(primitive: Primitive, commitPrimitive: (next: Primitive) => boolean): DimensionField[] {
  switch (primitive.kind) {
    case 'box':
      return [
        { label: 'Width', value: primitive.width, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, width: v }) },
        { label: 'Height', value: primitive.height, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, height: v }) },
        { label: 'Depth', value: primitive.depth, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, depth: v }) },
      ];
    case 'cylinder':
      return [
        { label: 'Radius', value: primitive.radius, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, radius: v }) },
        { label: 'Height', value: primitive.height, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, height: v }) },
        { label: 'Segments', value: primitive.segments, onCommit: (v) => commitPrimitive({ ...primitive, segments: Math.round(v) }) },
      ];
    case 'lBracket':
      return [
        { label: 'Width', value: primitive.width, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, width: v }) },
        { label: 'Height', value: primitive.height, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, height: v }) },
        { label: 'Depth', value: primitive.depth, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, depth: v }) },
        { label: 'Thickness', value: primitive.thickness, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, thickness: v }) },
      ];
    default: {
      const exhaustive: never = primitive;
      throw new Error(`Unknown primitive kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function PropertiesPanelContent({
  entity,
  updateEntity,
}: {
  entity: CadEntity;
  updateEntity: (id: string, patch: CadEntityPatch) => boolean;
}) {
  const commitPrimitive = (next: Primitive) => updateEntity(entity.id, { primitive: next });
  const commitTransform = (next: CadEntity['transform']) => updateEntity(entity.id, { transform: next });

  return (
    <div className="properties-panel__content">
      <div className="field">
        <label htmlFor="entity-name">Name</label>
        <input id="entity-name" type="text" readOnly value={entity.name} />
      </div>

      <h3 className="properties-panel__section">Dimensions</h3>
      {dimensionFieldsFor(entity.primitive, commitPrimitive).map((field) => (
        <NumericField key={field.label} {...field} />
      ))}

      <h3 className="properties-panel__section">Transform</h3>
      <TransformFields transform={entity.transform} onCommit={commitTransform} />
    </div>
  );
}

export function PropertiesPanel() {
  const entity = useCadStore(selectSelectedEntity);
  const updateEntity = useCadStore((state) => state.updateEntity);

  return (
    <aside className="properties-panel" aria-label="Properties">
      <h2 className="panel-heading">Properties</h2>
      {entity ? (
        <PropertiesPanelContent entity={entity} updateEntity={updateEntity} />
      ) : (
        <p className="properties-panel__empty">No selection</p>
      )}
    </aside>
  );
}
