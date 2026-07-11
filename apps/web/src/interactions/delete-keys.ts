import type { StoreApi } from 'zustand';
import type { CadStoreState } from '../store/cad-store.js';

/** True for a plain Delete/Backspace with no command/navigation modifier held. */
export function isDeleteKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === 'Delete' || event.key === 'Backspace';
}

/**
 * True when focus is in a field/editor where Delete/Backspace must edit text
 * rather than delete a CAD object: an input (including the numeric dimension
 * editor), textarea, select, or contenteditable region.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * Handles a global Delete/Backspace as a CAD deletion, returning whether it did.
 *
 * Fires only when the key is a plain Delete/Backspace and text editing does not
 * own focus (neither the event target nor the active element is a field/editor).
 * In sketch mode it deletes the current sketch selection or constraint glyph;
 * otherwise it deletes the selected body/feature (which may open the dependency
 * impact dialog). Returns `false` — so the caller must NOT preventDefault, and
 * Backspace navigation stays intact — whenever no CAD deletion is performed.
 */
export function handleGlobalDelete(store: StoreApi<CadStoreState>, event: KeyboardEvent): boolean {
  if (!isDeleteKey(event)) return false;
  if (isTextEntryTarget(event.target) || isTextEntryTarget(document.activeElement)) return false;

  const state = store.getState();
  if (state.sketch) {
    if (state.sketchSelection.length === 0 && !state.selectedConstraintId) return false;
    state.deleteSketchSelection();
    return true;
  }

  if (!state.selectedEntityId && !state.selectedFeatureId) return false;
  state.deleteSelected();
  return true;
}
