import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from './tools/types.js';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore, selectActiveSketch } from '../store/cad-store.js';
import { ConstraintToolbar } from './ConstraintToolbar.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}

type Store = ReturnType<typeof createCadStore>;

/** A store in XY sketch mode holding an axis-aligned rectangle, tool cleared. */
function sketchStore(): Store {
  let n = 0;
  const store = createCadStore(undefined, { createId: () => `id-${++n}` });
  store.getState().enterSketch('XY');
  store.getState().setSketchTool('rectangle');
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(40, 30) });
  store.getState().setSketchTool(null);
  return store;
}

function lineIds(store: Store): string[] {
  return selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'line').map((e) => e.id);
}
function pointIds(store: Store): string[] {
  return selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'point').map((e) => e.id);
}

function renderToolbar(store: Store) {
  render(
    <CadStoreProvider store={store}>
      <ConstraintToolbar />
    </CadStoreProvider>,
  );
}

describe('ConstraintToolbar', () => {
  it('exposes a Constraints toolbar landmark', () => {
    renderToolbar(sketchStore());
    expect(screen.getByRole('toolbar', { name: 'Constraints' })).toBeInTheDocument();
  });

  it('disables every constraint button with no selection', () => {
    renderToolbar(sketchStore());
    for (const name of ['Coincident constraint', 'Horizontal constraint', 'Distance constraint', 'Radius constraint', 'Angle constraint']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('enables horizontal/vertical/distance when one line is selected', () => {
    const store = sketchStore();
    store.getState().setSketchSelection([lineIds(store)[0]!]);
    renderToolbar(store);

    expect(screen.getByRole('button', { name: 'Horizontal constraint' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Vertical constraint' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Distance constraint' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Coincident constraint' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Angle constraint' })).toBeDisabled();
  });

  it('enables coincident and distance for two selected points', () => {
    const store = sketchStore();
    const [p0, p1] = pointIds(store);
    store.getState().setSketchSelection([p0!, p1!]);
    renderToolbar(store);

    expect(screen.getByRole('button', { name: 'Coincident constraint' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Distance constraint' })).toBeEnabled();
  });

  it('enables angle for two selected lines', () => {
    const store = sketchStore();
    const [l0, l1] = lineIds(store);
    store.getState().setSketchSelection([l0!, l1!]);
    renderToolbar(store);
    expect(screen.getByRole('button', { name: 'Angle constraint' })).toBeEnabled();
  });

  it('applies a horizontal constraint and clears the selection on click', () => {
    const store = sketchStore();
    store.getState().setSketchSelection([lineIds(store)[0]!]);
    renderToolbar(store);

    fireEvent.click(screen.getByRole('button', { name: 'Horizontal constraint' }));

    expect(selectActiveSketch(store.getState())!.constraints).toHaveLength(1);
    expect(store.getState().sketchSelection).toEqual([]);
  });

  it('applies a distance dimension seeded with the measured length', () => {
    const store = sketchStore();
    store.getState().setSketchSelection([lineIds(store)[0]!]);
    renderToolbar(store);

    fireEvent.click(screen.getByRole('button', { name: 'Distance constraint' }));

    const constraint = selectActiveSketch(store.getState())!.constraints[0]!;
    expect(constraint.kind === 'distance' && constraint.value).toBe(40);
  });
});
