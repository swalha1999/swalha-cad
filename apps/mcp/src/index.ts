#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DocumentSession, DocumentSessionError } from './document-session.js';
import { createCadMcpServer } from './server.js';

async function main(): Promise<void> {
  const documentPath = process.argv[2];
  if (!documentPath) {
    console.error('Usage: swalha-cad-mcp <path-to-.swcad.json>');
    process.exitCode = 1;
    return;
  }

  const session = await DocumentSession.open(documentPath);
  const server = createCadMcpServer(session);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  if (error instanceof DocumentSessionError) {
    console.error(`[${error.code}] ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
