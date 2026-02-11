#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  ingestToOpenWebUITool,
  scholarToolSchemas,
  screenCandidatesTool,
  searchCandidatesTool,
} from "./tools/scholar.js";

const server = new Server(
  {
    name: "mcp-server-scholar-oa",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_paper_candidates",
        description:
          "Search OpenAlex by keyword and return candidate papers with title, abstract preview, OA status, and relevance score.",
        inputSchema: {
          type: "object",
          properties: {
            query: scholarToolSchemas.searchCandidates.query,
            limit: scholarToolSchemas.searchCandidates.limit,
            fromYear: scholarToolSchemas.searchCandidates.fromYear,
            oaOnly: scholarToolSchemas.searchCandidates.oaOnly,
          },
          required: ["query"],
        },
      },
      {
        name: "screen_paper_candidates",
        description:
          "Screen candidate paper IDs against the query and split into relevant vs irrelevant using lexical relevance scoring.",
        inputSchema: {
          type: "object",
          properties: {
            query: scholarToolSchemas.screenCandidates.query,
            candidateIds: scholarToolSchemas.screenCandidates.candidateIds,
            threshold: scholarToolSchemas.screenCandidates.threshold,
          },
          required: ["query", "candidateIds"],
        },
      },
      {
        name: "ingest_candidates_to_openwebui_kb",
        description:
          "OA-first ingestion pipeline: download OA PDF when available, fallback to abstract-only note for non-OA, upload to OpenWebUI, and attach to a knowledge base for RAG.",
        inputSchema: {
          type: "object",
          properties: {
            candidateIds: scholarToolSchemas.ingestToOpenWebUI.candidateIds,
            query: scholarToolSchemas.ingestToOpenWebUI.query,
            knowledgeBaseName: scholarToolSchemas.ingestToOpenWebUI.knowledgeBaseName,
            knowledgeBaseDescription: scholarToolSchemas.ingestToOpenWebUI.knowledgeBaseDescription,
            makePublic: scholarToolSchemas.ingestToOpenWebUI.makePublic,
            maxPapers: scholarToolSchemas.ingestToOpenWebUI.maxPapers,
            fileProcessTimeoutSec: scholarToolSchemas.ingestToOpenWebUI.fileProcessTimeoutSec,
            openwebuiBaseUrl: scholarToolSchemas.ingestToOpenWebUI.openwebuiBaseUrl,
            openwebuiApiKey: scholarToolSchemas.ingestToOpenWebUI.openwebuiApiKey,
          },
          required: ["candidateIds"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "search_paper_candidates":
        return await searchCandidatesTool(args as any);
      case "screen_paper_candidates":
        return await screenCandidatesTool(args as any);
      case "ingest_candidates_to_openwebui_kb":
        return await ingestToOpenWebUITool(args as any);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Scholar OA MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
