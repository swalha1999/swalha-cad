import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DocumentSessionError } from './document-session.js';

/** Structured error payload embedded in `CallToolResult.content` as JSON text. */
export interface ToolErrorPayload {
  error: {
    code: string;
    message: string;
  };
}

export function toolJsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export function toolErrorResult(code: string, message: string): CallToolResult {
  const payload: ToolErrorPayload = { error: { code, message } };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

/** Runs `handler`, converting `DocumentSessionError` (and Zod validation) into a structured tool error result. */
export async function runTool(handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof DocumentSessionError) {
      return toolErrorResult(error.code, error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return toolErrorResult('unexpected_error', message);
  }
}
