export type {
  Vec3,
  Transform,
  Primitive,
  CadEntity,
  CadDocumentV1,
  CadDocumentV2,
  SketchPlane,
  SketchEntity,
  SketchConstraint,
  SketchFeature,
  ExtrudeFeature,
  CadFeature,
} from './types.js';
export { parseCadDocument } from './schema.js';
export type { ParsedCadDocument } from './schema.js';
export { migrateToV2 } from './migrate.js';
export type { CadCommand, CadEntityPatch, CadFeaturePatch } from './commands.js';
export { parseCadCommand } from './commands.js';
export { applyCommand, UnknownEntityError, UnknownFeatureError } from './reducer.js';
export type { CommandHistory } from './history.js';
export { createHistory, applyCommandToHistory, undo, redo, canUndo, canRedo } from './history.js';
