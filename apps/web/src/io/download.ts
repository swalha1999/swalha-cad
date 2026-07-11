import type { CadDocumentV1 } from '@swalha-cad/document';

export const DOCUMENT_FILENAME = 'design.swcad.json';
export const STL_FILENAME = 'design.stl';

/** Triggers a browser file download for `blob` via a temporary, never-attached anchor element. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadCadDocument(cadDocument: CadDocumentV1): void {
  const json = JSON.stringify(cadDocument, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), DOCUMENT_FILENAME);
}

export function downloadStl(bytes: Uint8Array): void {
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'model/stl' }), STL_FILENAME);
}
