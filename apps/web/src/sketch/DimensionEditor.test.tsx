import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from './tools/types.js';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore, selectActiveSketch } from '../store/cad-store.js';
import { DimensionEditor } from './DimensionEditor.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}

type Store = ReturnType<typeof createCadStore>;

/** A store in XY sketch mode with a single line and a distance dimension on it. */
function dimensionedStore(): { store: Store; distanceId: string } {
  let n = 0;
  const store = createCadStore(undefined, { createId: () => `id-${++n}` });
  store.getState().enterSketch('XY');
  store.getState().setSketchTool('line');
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 0) });
  store.getState().dispatchSketchEvent({ type: 'finish' });
  store.getState().setSketchTool(null);
  const [pa, pb] = selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'point');
  store.getState().applyConstraint({ kind: 'distance', pointA: pa!.id, pointB: pb!.id, value: 10 });
  const distanceId = selectActiveSketch(store.getState())!.constraints[0]!.id;
  return { store, distanceId };
}

function renderEditor(store: Store) {
  render(
    <CadStoreProvider store={store}>
      <DimensionEditor />
    </CadStoreProvider>,
  );
}

describe('DimensionEditor', () => {
  it('shows a hint when no dimensional constraint is selected', () => {
    const { store } = dimensionedStore();
    store.getState().selectConstraint(null);
    renderEditor(store);
    expect(screen.getByTestId('dimension-editor-hint')).toBeInTheDocument();
  });

  it('edits the selected distance in millimetres and rebuilds the geometry', () => {
    const { store, distanceId } = dimensionedStore();
    store.getState().selectConstraint(distanceId);
    renderEditor(store);

    const input = screen.getByLabelText('Distance value');
    expect(input).toHaveValue(10);
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.blur(input);

    const constraint = selectActiveSketch(store.getState())!.constraints[0]!;
    expect(constraint.kind === 'distance' && constraint.value).toBe(25);
    const points = selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'point');
    expect(Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y)).toBeCloseTo(25, 6);
  });

  it('shows millimetres for a distance and rejects a non-positive value inline', () => {
    const { store, distanceId } = dimensionedStore();
    store.getState().selectConstraint(distanceId);
    renderEditor(store);
    expect(screen.getByText('mm')).toBeInTheDocument();

    const input = screen.getByLabelText('Distance value');
    fireEvent.change(input, { target: { value: '-4' } });
    fireEvent.blur(input);

    expect(screen.getByText(/invalid value/i)).toBeInTheDocument();
    const constraint = selectActiveSketch(store.getState())!.constraints[0]!;
    expect(constraint.kind === 'distance' && constraint.value).toBe(10);
  });

  it('edits an angle dimension in degrees', () => {
    let n = 0;
    const store = createCadStore(undefined, { createId: () => `id-${++n}` });
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('rectangle');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(40, 30) });
    store.getState().setSketchTool(null);
    const lineList = selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'line');
    store.getState().applyConstraint({ kind: 'angle', lineA: lineList[0]!.id, lineB: lineList[1]!.id, valueDeg: 90 });
    const angleId = selectActiveSketch(store.getState())!.constraints.find((c) => c.kind === 'angle')!.id;
    store.getState().selectConstraint(angleId);

    renderEditor(store);
    expect(screen.getByText('°')).toBeInTheDocument();
    expect(screen.getByLabelText('Angle value')).toHaveValue(90);
  });
});
