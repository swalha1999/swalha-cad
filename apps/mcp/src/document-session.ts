import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { CadCommand, CadDocumentV1 } from '@swalha-cad/document';
import { applyCommand, parseCadDocument, UnknownEntityError } from '@swalha-cad/document';

const EMPTY_DOCUMENT: CadDocumentV1 = { schemaVersion: 1, units: 'mm', entities: [] };

/** Structured error for session-level failures (startup validation, unknown entities). */
export class DocumentSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DocumentSessionError';
    this.code = code;
  }
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export interface DocumentSessionOptions {
  /** Injectable so tests can assert on deterministic ids instead of random UUIDs. */
  createId?: () => string;
}

/**
 * Owns a single `.swcad.json` file for the lifetime of an MCP process: loads
 * and validates it at startup, applies mutations only through the shared
 * `CadCommand` reducer, and persists the result atomically (write to a temp
 * file, then rename) after every successful command.
 */
export class DocumentSession {
  private document: CadDocumentV1;
  private readonly filePath: string;
  private readonly createId: () => string;

  private constructor(filePath: string, document: CadDocumentV1, createId: () => string) {
    this.filePath = filePath;
    this.document = document;
    this.createId = createId;
  }

  static async open(filePath: string, options: DocumentSessionOptions = {}): Promise<DocumentSession> {
    const createId = options.createId ?? (() => randomUUID());

    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if (isNodeErrnoException(error) && error.code === 'ENOENT') {
        const session = new DocumentSession(filePath, EMPTY_DOCUMENT, createId);
        await session.persist();
        return session;
      }
      throw new DocumentSessionError(
        'document_read_failed',
        `Failed to read "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new DocumentSessionError('document_invalid_json', `"${filePath}" is not valid JSON.`);
    }

    const result = parseCadDocument(parsedJson);
    if (!result.success) {
      throw new DocumentSessionError(
        'document_invalid_schema',
        `"${filePath}" is not a valid SWALHA CAD document: ${result.error.message}`,
      );
    }

    return new DocumentSession(filePath, result.data, createId);
  }

  getDocument(): CadDocumentV1 {
    return this.document;
  }

  nextId(): string {
    return this.createId();
  }

  /** Applies `command` through the shared reducer and persists the result before resolving. */
  async applyCommand(command: CadCommand): Promise<CadDocumentV1> {
    let next: CadDocumentV1;
    try {
      next = applyCommand(this.document, command);
    } catch (error) {
      if (error instanceof UnknownEntityError) {
        throw new DocumentSessionError('entity_not_found', error.message);
      }
      throw error;
    }

    this.document = next;
    await this.persist();
    return this.document;
  }

  private async persist(): Promise<void> {
    const json = JSON.stringify(this.document, null, 2);
    const tmpPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, json, 'utf8');
    await rename(tmpPath, this.filePath);
  }
}
