import { describe, expect, it } from 'vitest';
import { createCadStore } from '../store/cad-store.js';
import { handleSketchSupportKey } from './sketch-support-keys.js';

function keyEvent(init: Partial<KeyboardEvent> & { key: string; target?: EventTarget | null }): KeyboardEvent {
  return { ctrlKey: false, metaKey: false, altKey: false, target: null, ...init } as unknown as KeyboardEvent;
}

describe('handleSketchSupportKey', () => {
  it('does nothing when no support command is active', () => {
    const store = createCadStore();
    expect(handleSketchSupportKey(store, keyEvent({ key: 'Enter' }))).toBe(false);
    expect(handleSketchSupportKey(store, keyEvent({ key: 'Escape' }))).toBe(false);
  });

  it('Escape cancels the command', () => {
    const store = createCadStore();
    store.getState().startSketch();
    expect(handleSketchSupportKey(store, keyEvent({ key: 'Escape' }))).toBe(true);
    expect(store.getState().sketchSupport).toBeNull();
  });

  it('Enter confirms the collected support and enters the sketch', () => {
    const store = createCadStore();
    store.getState().startSketch();
    store.getState().chooseSketchPlane('XY');
    expect(handleSketchSupportKey(store, keyEvent({ key: 'Enter' }))).toBe(true);
    expect(store.getState().sketch?.plane).toBe('XY');
  });

  it('Enter with an empty collector keeps the command open with a diagnostic', () => {
    const store = createCadStore();
    store.getState().startSketch();
    expect(handleSketchSupportKey(store, keyEvent({ key: 'Enter' }))).toBe(true);
    expect(store.getState().sketchSupport).not.toBeNull();
    expect(store.getState().sketchSupport!.error).toMatch(/select a sketch plane/i);
  });

  it('ignores Enter/Escape while a text field owns focus (focus guard)', () => {
    const store = createCadStore();
    store.getState().startSketch();
    const input = document.createElement('input');
    expect(handleSketchSupportKey(store, keyEvent({ key: 'Escape', target: input }))).toBe(false);
    expect(store.getState().sketchSupport).not.toBeNull();
  });

  it('ignores modified chords (e.g. Ctrl+Enter)', () => {
    const store = createCadStore();
    store.getState().startSketch();
    expect(handleSketchSupportKey(store, keyEvent({ key: 'Enter', ctrlKey: true }))).toBe(false);
  });
});
