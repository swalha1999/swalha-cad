import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from './tools/types.js';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore, selectActiveSketch } from '../store/cad-store.js';
import { ConstraintStatus } from './ConstraintStatus.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}

type Store = ReturnType<typeof createCadStore>;

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

function lines(store: Store): Extract<ReturnType<typeof selectActiveSketch>, object>['entities'] {
  return selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'line');
}

function renderStatus(store: Store) {
  render(
    <CadStoreProvider store={store}>
      <ConstraintStatus />
    </CadStoreProvider>,
  );
}

describe('ConstraintStatus', () => {
  it('renders nothing outside sketch mode', () => {
    const store = createCadStore();
    const { container } = render(
      <CadStoreProvider store={store}>
        <ConstraintStatus />
      </CadStoreProvider>,
    );
    expect(container.querySelector('.constraint-status')).toBeNull();
  });

  it('shows an under-constrained status with remaining degrees of freedom', () => {
    renderStatus(sketchStore());
    const region = screen.getByRole('region', { name: 'Constraint status' });
    expect(region).toHaveClass('constraint-status--under-constrained');
    expect(screen.getByText('Under-constrained')).toBeInTheDocument();
    expect(screen.getByText(/degrees of freedom remaining/i)).toBeInTheDocument();
  });

  it('shows a fully-constrained status for a fully dimensioned rectangle', () => {
    const store = sketchStore();
    const [l0, l1, l2, l3] = lines(store).map((l) => l.id);
    const l0e = lines(store)[0]!;
    const l1e = lines(store)[1]!;
    store.getState().applyConstraint({ kind: 'horizontal', lineId: l0! });
    store.getState().applyConstraint({ kind: 'vertical', lineId: l1! });
    store.getState().applyConstraint({ kind: 'horizontal', lineId: l2! });
    store.getState().applyConstraint({ kind: 'vertical', lineId: l3! });
    if (l0e.kind !== 'line' || l1e.kind !== 'line') throw new Error('expected lines');
    store.getState().applyConstraint({ kind: 'distance', pointA: l0e.startId, pointB: l0e.endId, value: 40 });
    store.getState().applyConstraint({ kind: 'distance', pointA: l1e.startId, pointB: l1e.endId, value: 30 });

    renderStatus(store);
    expect(screen.getByRole('region', { name: 'Constraint status' })).toHaveClass('constraint-status--fully-constrained');
    expect(screen.getByText('Fully constrained')).toBeInTheDocument();
  });

  it('shows a conflicting status with an alert listing the diagnostics', () => {
    const store = sketchStore();
    const l0 = lines(store)[0]!;
    if (l0.kind !== 'line') throw new Error('expected a line');
    store.getState().applyConstraint({ kind: 'distance', pointA: l0.startId, pointB: l0.endId, value: 40 });
    store.getState().applyConstraint({ kind: 'distance', pointA: l0.startId, pointB: l0.endId, value: 80 });

    renderStatus(store);
    expect(screen.getByRole('region', { name: 'Constraint status' })).toHaveClass('constraint-status--conflicting');
    expect(screen.getByText('Conflicting')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
