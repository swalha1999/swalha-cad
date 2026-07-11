import type { CadDocumentV2 } from '@swalha-cad/document';
import { parseCadDocument } from '@swalha-cad/document';

export type OpenDocumentResult =
  | { success: true; document: CadDocumentV2 }
  | { success: false; error: string };

/** Reads a `.swcad.json` file, parses its JSON, and validates/migrates it to the canonical V2 document schema. */
export async function openCadDocumentFile(file: File): Promise<OpenDocumentResult> {
  const text = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { success: false, error: `"${file.name}" is not valid JSON.` };
  }

  const result = parseCadDocument(parsed);
  if (!result.success) {
    return { success: false, error: `"${file.name}" is not a valid SWALHA CAD document: ${result.error.message}` };
  }

  return { success: true, document: result.data };
}
