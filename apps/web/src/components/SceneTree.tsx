import { useCadStore } from '../store/cad-store-context.js';

export function SceneTree() {
  const entities = useCadStore((state) => state.document.entities);
  const selectedEntityId = useCadStore((state) => state.selectedEntityId);
  const selectEntity = useCadStore((state) => state.selectEntity);

  return (
    <nav className="scene-tree" aria-label="Scene tree">
      <h2 className="panel-heading">Scene</h2>
      <ul className="scene-tree__list">
        {entities.map((entity) => (
          <li key={entity.id}>
            <button
              type="button"
              className="scene-tree__row"
              aria-current={entity.id === selectedEntityId}
              aria-label={entity.name}
              onClick={() => selectEntity(entity.id)}
            >
              <span className="scene-tree__kind">{entity.primitive.kind}</span>
              <span className="scene-tree__name">{entity.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
