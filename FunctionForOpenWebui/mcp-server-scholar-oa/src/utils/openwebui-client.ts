import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import type { OpenWebUIFileUploadResponse, OpenWebUIKnowledge } from "../types.js";
import { sleep } from "./text.js";

type JsonValue = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

export class OpenWebUIClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public endpoint?: string
  ) {
    super(message);
    this.name = "OpenWebUIClientError";
  }
}

export class OpenWebUIClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(params?: { baseUrl?: string; apiKey?: string }) {
    this.baseUrl = (params?.baseUrl ?? process.env.OPENWEBUI_BASE_URL ?? "").trim().replace(/\/+$/, "");
    this.apiKey = (params?.apiKey ?? process.env.OPENWEBUI_API_KEY ?? "").trim();

    if (!this.baseUrl) {
      throw new OpenWebUIClientError("OPENWEBUI_BASE_URL is required");
    }
    if (!this.apiKey) {
      throw new OpenWebUIClientError("OPENWEBUI_API_KEY is required");
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
  }

  private buildUrl(path: string): string {
    if (!path.startsWith("/")) {
      return `${this.baseUrl}/${path}`;
    }
    return `${this.baseUrl}${path}`;
  }

  private async requestJson<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: JsonValue
  ): Promise<T> {
    const endpoint = this.buildUrl(path);
    const response = await fetch(endpoint, {
      method,
      headers: {
        ...this.authHeaders(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new OpenWebUIClientError(
        `OpenWebUI request failed: HTTP ${response.status} ${response.statusText} - ${text.slice(0, 300)}`,
        response.status,
        endpoint
      );
    }

    return (await response.json()) as T;
  }

  async searchKnowledgeBases(query: string): Promise<OpenWebUIKnowledge[]> {
    const encoded = encodeURIComponent(query);
    const result = await this.requestJson<{ items?: OpenWebUIKnowledge[] }>(
      "GET",
      `/api/v1/knowledge/search?query=${encoded}`
    );
    return result.items ?? [];
  }

  async createKnowledgeBase(params: {
    name: string;
    description: string;
    makePublic: boolean;
  }): Promise<OpenWebUIKnowledge> {
    return this.requestJson<OpenWebUIKnowledge>("POST", "/api/v1/knowledge/create", {
      name: params.name,
      description: params.description,
      access_control: params.makePublic ? null : {},
    });
  }

  async getOrCreateKnowledgeBase(params: {
    name: string;
    description: string;
    makePublic: boolean;
  }): Promise<{ knowledgeBase: OpenWebUIKnowledge; created: boolean }> {
    const found = await this.searchKnowledgeBases(params.name);
    const exact = found.find((item) => item.name.trim().toLowerCase() === params.name.trim().toLowerCase());
    if (exact) {
      return { knowledgeBase: exact, created: false };
    }

    const created = await this.createKnowledgeBase(params);
    return { knowledgeBase: created, created: true };
  }

  async uploadFile(
    filePath: string,
    metadata: Record<string, unknown>
  ): Promise<OpenWebUIFileUploadResponse> {
    const endpoint = this.buildUrl("/api/v1/files/?process=true&process_in_background=true");
    const buffer = await readFile(filePath);
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = ext === "pdf" ? "application/pdf" : "text/markdown";
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), basename(filePath));
    form.append("metadata", JSON.stringify(metadata));

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
      },
      body: form,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new OpenWebUIClientError(
        `OpenWebUI upload failed: HTTP ${response.status} ${response.statusText} - ${text.slice(0, 300)}`,
        response.status,
        endpoint
      );
    }

    return (await response.json()) as OpenWebUIFileUploadResponse;
  }

  async getFileProcessStatus(fileId: string): Promise<string> {
    const result = await this.requestJson<{ status?: string }>("GET", `/api/v1/files/${fileId}/process/status`);
    return result.status ?? "pending";
  }

  async waitForFileProcessed(
    fileId: string,
    timeoutSeconds: number,
    pollSeconds = 2
  ): Promise<{ status: string; fileId: string }> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const status = await this.getFileProcessStatus(fileId);
      if (status === "completed" || status === "failed") {
        return { status, fileId };
      }
      await sleep(pollSeconds * 1000);
    }

    return { status: "timeout", fileId };
  }

  async addFilesToKnowledgeBase(knowledgeBaseId: string, fileIds: string[]): Promise<void> {
    const payload = fileIds.map((fileId) => ({ file_id: fileId }));
    await this.requestJson("POST", `/api/v1/knowledge/${knowledgeBaseId}/files/batch/add`, payload);
  }
}
