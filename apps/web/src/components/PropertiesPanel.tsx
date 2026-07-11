import type { CadEntity, Primitive } from '@swalha-cad/document';
import { useCadStore } from '../store/cad-store-context.js';
import { selectSelectedEntity } from '../store/cad-store.js';

interface DimensionField {
  label: string;
  value: number;
  unit?: string;
}

function dimensionFieldsFor(primitive: Primitive): DimensionField[] {
  switch (primitive.kind) {
    case 'box':
      return [
        { label: 'Width', value: primitive.width, unit: 'mm' },
        { label: 'Height', value: primitive.height, unit: 'mm' },
        { label: 'Depth', value: primitive.depth, unit: 'mm' },
      ];
    case 'cylinder':
      return [
        { label: 'Radius', value: primitive.radius, unit: 'mm' },
        { label: 'Height', value: primitive.height, unit: 'mm' },
        { label: 'Segments', value: primitive.segments },
      ];
    case 'lBracket':
      return [
        { label: 'Width', value: primitive.width, unit: 'mm' },
        { label: 'Height', value: primitive.height, unit: 'mm' },
        { label: 'Depth', value: primitive.depth, unit: 'mm' },
        { label: 'Thickness', value: primitive.thickness, unit: 'mm' },
      ];
    default: {
      const exhaustive: never = primitive;
      throw new Error(`Unknown primitive kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function fieldId(label: string): string {
  return `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
}

/** Read-only for now: numeric editing is Task 11's job, this shell only displays current values. */
function NumericField({ label, value, unit }: DimensionField) {
  const id = fieldId(label);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field__control">
        <input id={id} type="number" readOnly value={value} />
        {unit ? <span className="field__unit">{unit}</span> : null}
      </div>
    </div>
  );
}

function PropertiesPanelContent({ entity }: { entity: CadEntity }) {
  const [tx, ty, tz] = entity.transform.translation;
  const [rx, ry, rz] = entity.transform.rotationDeg;
  const [sx, sy, sz] = entity.transform.scale;

  return (
    <div className="properties-panel__content">
      <div className="field">
        <label htmlFor="entity-name">Name</label>
        <input id="entity-name" type="text" readOnly value={entity.name} />
      </div>

      <h3 className="properties-panel__section">Dimensions</h3>
      {dimensionFieldsFor(entity.primitive).map((field) => (
        <NumericField key={field.label} {...field} />
      ))}

      <h3 className="properties-panel__section">Transform</h3>
      <NumericField label="Translate X" value={tx} unit="mm" />
      <NumericField label="Translate Y" value={ty} unit="mm" />
      <NumericField label="Translate Z" value={tz} unit="mm" />
      <NumericField label="Rotate X" value={rx} unit="deg" />
      <NumericField label="Rotate Y" value={ry} unit="deg" />
      <NumericField label="Rotate Z" value={rz} unit="deg" />
      <NumericField label="Scale X" value={sx} />
      <NumericField label="Scale Y" value={sy} />
      <NumericField label="Scale Z" value={sz} />
    </div>
  );
}

export function PropertiesPanel() {
  const entity = useCadStore(selectSelectedEntity);

  return (
    <aside className="properties-panel" aria-label="Properties">
      <h2 className="panel-heading">Properties</h2>
      {entity ? <PropertiesPanelContent entity={entity} /> : <p className="properties-panel__empty">No selection</p>}
    </aside>
  );
}
