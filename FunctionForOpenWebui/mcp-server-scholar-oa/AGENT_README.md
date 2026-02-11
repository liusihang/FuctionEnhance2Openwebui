# AGENT README (Deploy + Maintenance)

This document is for maintainers/operators of `mcp-server-scholar-oa`.

## 1. What This Service Does

`mcp-server-scholar-oa` is an MCP stdio server that provides 3 tools:

1. `search_paper_candidates`
2. `screen_paper_candidates`
3. `ingest_candidates_to_openwebui_kb`

Pipeline intent:

- OA-first paper retrieval
- non-OA fallback to abstract-only notes
- automatic OpenWebUI upload + processing + KB attachment (for embedding/RAG)

## 2. File Layout

- Entry point: `src/index.ts`
- Tool logic: `src/tools/scholar.ts`
- OpenAlex client: `src/utils/openalex-client.ts`
- OpenWebUI client: `src/utils/openwebui-client.ts`
- Common types: `src/types.ts`
- Text/relevance utils: `src/utils/text.ts`

## 3. Runtime Requirements

- Node.js >= 18
- Outbound network access to:
  - `api.openalex.org`
  - your OpenWebUI instance
- OpenWebUI API key with file/knowledge permissions

## 4. Required Environment Variables

- `OPENWEBUI_BASE_URL` (required)
- `OPENWEBUI_API_KEY` (required)
- `OPENALEX_API_KEY` (optional now, recommended)
- `OPENALEX_MAILTO` (optional, recommended)

Notes:

- The code does not auto-load `.env`; env vars must be injected by process manager / shell / MCP host config.

## 5. Build and Run

```bash
npm install
npm run build
node dist/index.js
```

Expected startup log:

- `Scholar OA MCP Server running on stdio`

## 6. Operational Semantics

### 6.1 search_paper_candidates

- Calls OpenAlex `/works` search
- Builds candidate metadata
- Reconstructs abstract from `abstract_inverted_index`
- Calculates lexical relevance score

### 6.2 screen_paper_candidates

- Re-scores provided candidates against query
- Splits into relevant/irrelevant by threshold

### 6.3 ingest_candidates_to_openwebui_kb

For each candidate:

1. If OA PDF URL is available, tries PDF download.
2. If PDF unavailable/fails, creates markdown abstract note.
3. Uploads file to OpenWebUI with `process=true`.
4. Polls `/files/{id}/process/status`.
5. Adds successful files to target knowledge base.

## 7. OpenWebUI APIs Used

- `POST /api/v1/files/?process=true&process_in_background=true`
- `GET /api/v1/files/{id}/process/status`
- `GET /api/v1/knowledge/search?query=...`
- `POST /api/v1/knowledge/create`
- `POST /api/v1/knowledge/{id}/files/batch/add`

## 8. Public KB Behavior

When `makePublic=true`, the client sends `access_control=null` on KB creation.

OpenWebUI may still enforce private/restricted permissions based on user role/policy.
Tool output exposes:

- `requested_public`
- `actual_public`

Use this delta for permission troubleshooting.

## 9. Troubleshooting Runbook

### Error: `OPENWEBUI_BASE_URL is required`

- Env var missing in runtime. Set it in MCP host process environment.

### Error: `OPENWEBUI_API_KEY is required`

- Missing/empty API key.

### OpenWebUI upload 401/403

- Key invalid or insufficient permissions.
- Validate key against OpenWebUI directly first.

### OpenWebUI status keeps pending / timeout

- Increase `fileProcessTimeoutSec` argument.
- Check OpenWebUI embedding backend and worker health.
- Check OpenWebUI file parsing support for uploaded file type.

### PDF download fails often

- Expected for unstable/blocked OA endpoints.
- System will fallback to abstract note automatically.

### KB exists but files not attached

- Check `results[].openwebui_status` and `uploaded_success_count`.
- Only `completed` files are batch-added to KB.

## 10. Maintenance Tasks

### Upgrade dependencies

```bash
npm outdated
npm update
npm run build
```

Then run quick smoke tests (search + screen + ingest with 1 OA paper).

### Validate after OpenWebUI upgrade

Retest these endpoints:

- `/api/v1/files/`
- `/api/v1/files/{id}/process/status`
- `/api/v1/knowledge/create`
- `/api/v1/knowledge/{id}/files/batch/add`

### Validate after OpenAlex changes

- Re-run a search call and verify fields:
  - `open_access`
  - `primary_location`
  - `abstract_inverted_index`

## 11. Extension Guide

Common extension directions:

1. Add more relevance signals (venue/year/citation priors).
2. Add source fallback chain (Semantic Scholar/Unpaywall) while preserving compliance.
3. Add deduplication by DOI/OpenAlex ID before ingestion.
4. Add retry + backoff for OpenWebUI file upload.

Recommended rule:

- Keep `ingest_candidates_to_openwebui_kb` behavior deterministic and explicit in returned JSON.

## 12. Security and Compliance Notes

- Do not add Sci-Hub or other copyright-infringing sources.
- Respect publisher/access terms.
- Keep OpenWebUI API keys out of logs and commits.

## 13. Minimal On-Call Check

When a user says “RAG cannot find paper”:

1. Run `search_paper_candidates` for the topic.
2. Run `ingest_candidates_to_openwebui_kb` for 1 known OA paper.
3. Confirm `uploaded_success_count >= 1`.
4. Confirm the KB ID in result exists in OpenWebUI UI.
5. Re-test query in OpenWebUI with that KB attached.

