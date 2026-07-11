import type { CadCommand } from './commands.js';
import { applyCommand } from './reducer.js';
import type { CadDocumentV2 } from './types.js';

/** Immutable undo/redo stack of document states, addressed only through commands. */
export interface CommandHistory {
  readonly past: readonly CadDocumentV2[];
  readonly present: CadDocumentV2;
  readonly future: readonly CadDocumentV2[];
}

export function createHistory(document: CadDocumentV2): CommandHistory {
  return { past: [], present: document, future: [] };
}

export function canUndo(history: CommandHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: CommandHistory): boolean {
  return history.future.length > 0;
}

/** Applies a command to the present document, pushing the prior state onto undo and clearing redo. */
export function applyCommandToHistory(history: CommandHistory, command: CadCommand): CommandHistory {
  const present = applyCommand(history.present, command);
  return { past: [...history.past, history.present], present, future: [] };
}

export function undo(history: CommandHistory): CommandHistory {
  if (history.past.length === 0) {
    return history;
  }
  const previous = history.past[history.past.length - 1] as CadDocumentV2;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: CommandHistory): CommandHistory {
  if (history.future.length === 0) {
    return history;
  }
  const next = history.future[0] as CadDocumentV2;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
