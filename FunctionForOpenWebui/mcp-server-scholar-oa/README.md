# Scholar OA MCP Server

MCP server for an OA-first literature workflow:

1. Search papers by keyword (OpenAlex)
2. Build candidate list and screen relevance
3. Download OA PDFs when possible
4. For non-OA papers, store abstract-only notes
5. Upload to OpenWebUI and attach into a knowledge base for embedding + RAG

## Maintainer Docs

- See `AGENT_README.md` for deployment, operations, troubleshooting, and extension guidance.

## Features

- `search_paper_candidates`
  - Keyword search with relevance scoring
  - Returns OA status and candidate metadata
- `screen_paper_candidates`
  - Split candidate IDs into relevant / irrelevant by threshold
- `ingest_candidates_to_openwebui_kb`
  - OA => PDF upload
  - Non-OA => abstract-only markdown upload
  - Auto create/reuse OpenWebUI knowledge base
  - Batch add files into KB

## Prerequisites

- Node.js >= 18
- OpenWebUI running and reachable
- OpenWebUI API key with permission to upload files and manage knowledge

## Install

```bash
cd mcp-server-scholar-oa
npm install
npm run build
```

## Environment

Copy `.env.example` to your runtime environment:

- `OPENWEBUI_BASE_URL` (example: `http://localhost:3000`)
- `OPENWEBUI_API_KEY`
- `OPENALEX_API_KEY` (optional now, recommended)
- `OPENALEX_MAILTO` (optional, recommended)

## OpenWebUI API workflow used

- Upload file:
  - `POST /api/v1/files/?process=true&process_in_background=true`
- Wait processing:
  - `GET /api/v1/files/{id}/process/status`
- Create KB:
  - `POST /api/v1/knowledge/create`
- Search KB:
  - `GET /api/v1/knowledge/search?query=...`
- Attach files:
  - `POST /api/v1/knowledge/{id}/files/batch/add`

## Public knowledge base behavior

`makePublic=true` sends `access_control=null` when creating KB.

If your OpenWebUI account does not have public sharing permission, OpenWebUI may downgrade access control.  
The tool returns both:

- `requested_public`
- `actual_public`

so you can detect permission-based fallback.

## Example tool usage

1) Search candidates

```json
{
  "tool": "search_paper_candidates",
  "arguments": {
    "query": "graph neural network for protein function prediction",
    "limit": 15
  }
}
```

2) Screen candidates

```json
{
  "tool": "screen_paper_candidates",
  "arguments": {
    "query": "graph neural network for protein function prediction",
    "candidateIds": [
      "https://openalex.org/W2907492528",
      "https://openalex.org/W2116341502"
    ],
    "threshold": 0.35
  }
}
```

3) Ingest into OpenWebUI KB

```json
{
  "tool": "ingest_candidates_to_openwebui_kb",
  "arguments": {
    "candidateIds": [
      "https://openalex.org/W2907492528"
    ],
    "query": "graph neural network for protein function prediction",
    "knowledgeBaseName": "Public OA Scholar KB",
    "makePublic": true,
    "maxPapers": 10
  }
}
```
