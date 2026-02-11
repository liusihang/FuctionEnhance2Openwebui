# Quickstart

## 1) Install and build

```bash
cd mcp-server-scholar-oa
npm install
npm run build
```

## 2) Configure environment

Set these env vars in your MCP runtime:

- `OPENWEBUI_BASE_URL`
- `OPENWEBUI_API_KEY`
- Optional: `OPENALEX_API_KEY`, `OPENALEX_MAILTO`

## 3) Register MCP server

Example MCP config:

```json
{
  "mcpServers": {
    "scholar-oa": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-scholar-oa/dist/index.js"],
      "env": {
        "OPENWEBUI_BASE_URL": "http://localhost:3000",
        "OPENWEBUI_API_KEY": "your_openwebui_api_key",
        "OPENALEX_API_KEY": "",
        "OPENALEX_MAILTO": "you@example.com"
      }
    }
  }
}
```

## 4) Try it in chat

1. Ask to search candidate papers with a keyword.
2. Ask to screen candidates.
3. Ask to ingest selected IDs into your OpenWebUI public KB.
