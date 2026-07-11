import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocumentV2 } from '@swalha-cad/document';
import { DOCUMENT_FILENAME, STL_FILENAME, downloadBlob, downloadCadDocument, downloadStl } from './download.js';

const TEST_DOCUMENT: CadDocumentV2 = {
  schemaVersion: 2,
  units: 'mm',
  entities: [],
  features: [],
};

describe('downloadBlob', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('creates an object URL for the given blob', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });

    downloadBlob(blob, 'greeting.txt');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('clicks a temporary anchor pointing at the object URL with the given filename', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });

    downloadBlob(blob, 'greeting.txt');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('greeting.txt');
    expect(anchor.href).toBe('blob:mock-url');
  });

  it('revokes the object URL after triggering the download', () => {
    downloadBlob(new Blob(['hello']), 'greeting.txt');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('downloadCadDocument', () => {
  it('downloads the document as pretty-printed JSON under the deterministic filename', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    downloadCadDocument(TEST_DOCUMENT);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe(DOCUMENT_FILENAME);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    expect(JSON.parse(text)).toEqual(TEST_DOCUMENT);

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('downloadStl', () => {
  it('downloads the bytes as a binary STL under the deterministic filename', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const bytes = new Uint8Array([1, 2, 3, 4]);

    downloadStl(bytes);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe(STL_FILENAME);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('model/stl');
    const buffer = new Uint8Array(await blob.arrayBuffer());
    expect(buffer).toEqual(bytes);

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
