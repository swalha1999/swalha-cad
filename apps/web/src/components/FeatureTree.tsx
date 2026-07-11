import { Box, Cylinder, Layers, Move3d, PencilRuler, Shapes, Target } from 'lucide-react';
import type { ComponentType } from 'react';
import type { CadFeature, Primitive } from '@swalha-cad/document';
import { useCadStore } from '../store/cad-store-context.js';

const PRIMITIVE_ICONS: Record<Primitive['kind'], ComponentType<{ className?: string }>> = {
  box: Box,
  cylinder: Cylinder,
  lBracket: Shapes,
};

const FEATURE_ICONS: Record<CadFeature['kind'], ComponentType<{ className?: string }>> = {
  sketch: PencilRuler,
  extrude: Move3d,
};

const ORIGIN_ROWS = ['Origin', 'Front Plane (XZ)', 'Top Plane (XY)', 'Right Plane (YZ)'];

/**
 * Left-hand feature tree: a placeholder Origin/plane group (functional once sketching
 * lands in a later milestone task) above the current M1 primitive bodies. The `nav`
 * keeps the "Scene tree" accessible name from M1 so existing browser workflows and
 * their e2e coverage keep working unchanged.
 */
export function FeatureTree() {
  const entities = useCadStore((state) => state.document.entities);
  const features = useCadStore((state) => state.document.features);
  const selectedEntityId = useCadStore((state) => state.selectedEntityId);
  const selectEntity = useCadStore((state) => state.selectEntity);

  return (
    <nav className="feature-tree" aria-label="Scene tree">
      <h2 className="panel-heading">Part Studio 1</h2>

      <h3 className="feature-tree__section-heading">Origin &amp; Planes</h3>
      <ul className="feature-tree__list feature-tree__list--origin">
        {ORIGIN_ROWS.map((label) => (
          <li key={label} className="feature-tree__origin-row">
            {label === 'Origin' ? <Target className="feature-tree__row-icon" /> : <Layers className="feature-tree__row-icon" />}
            <span>{label}</span>
          </li>
        ))}
      </ul>

      {features.length > 0 && (
        <>
          <h3 className="feature-tree__section-heading">Features</h3>
          <ul className="feature-tree__list feature-tree__list--origin">
            {features.map((feature) => {
              const Icon = FEATURE_ICONS[feature.kind];
              return (
                <li key={feature.id} className="feature-tree__origin-row">
                  <Icon className="feature-tree__row-icon" />
                  <span>{feature.name}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h3 className="feature-tree__section-heading">Bodies</h3>
      <ul className="feature-tree__list">
        {entities.map((entity) => {
          const Icon = PRIMITIVE_ICONS[entity.primitive.kind];
          return (
            <li key={entity.id}>
              <button
                type="button"
                className="feature-tree__row"
                aria-current={entity.id === selectedEntityId}
                aria-label={entity.name}
                onClick={() => selectEntity(entity.id)}
              >
                <Icon className="feature-tree__row-icon" />
                <span className="feature-tree__name">{entity.name}</span>
                <span className="feature-tree__kind">{entity.primitive.kind}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
