import type { StoreApi } from 'zustand';
import type { CadStoreState } from '../store/cad-store.js';
import { isTextEntryTarget } from './delete-keys.js';

/**
 * Handles Enter/Escape while the Sketch support-selection command is active,
 * returning whether it did. Enter confirms the collected support (creating and
 * entering the sketch); Escape cancels the command and restores the prior state.
 *
 * Fires only when the command is open and text editing does not own focus
 * (neither the event target nor the active element is a field/editor), so typing
 * in a form field never confirms or cancels. Returns `false` in every other case
 * so the caller must NOT preventDefault and other handlers stay intact.
 */
export function handleSketchSupportKey(store: StoreApi<CadStoreState>, event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key !== 'Enter' && event.key !== 'Escape') return false;
  const state = store.getState();
  if (!state.sketchSupport) return false;
  if (isTextEntryTarget(event.target) || isTextEntryTarget(document.activeElement)) return false;

  if (event.key === 'Escape') {
    state.cancelSketchSupport();
    return true;
  }
  // Enter confirms; when no support is chosen yet the command stays open with its diagnostic.
  state.confirmSketchSupport();
  return true;
}
