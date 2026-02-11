import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, unlink } from "node:fs/promises";

import { z } from "zod";

import type { PaperCandidate } from "../types.js";
import { openAlexClient } from "../utils/openalex-client.js";
import { OpenWebUIClient } from "../utils/openwebui-client.js";
import {
  computeRelevanceScore,
  normalizeOpenAlexId,
  sanitizeFilename,
  truncateText,
} from "../utils/text.js";

const candidateCache = new Map<string, PaperCandidate>();

function cacheCandidate(candidate: PaperCandidate): void {
  candidateCache.set(candidate.openalexId, candidate);
  candidateCache.set(candidate.openalexShortId, candidate);
}

async function resolveCandidate(openalexId: string, query = ""): Promise<PaperCandidate> {
  const { canonical, short } = normalizeOpenAlexId(openalexId);
  const cached = candidateCache.get(canonical) ?? candidateCache.get(short);
  if (cached) {
    return cached;
  }

  const fetched = await openAlexClient.getWork(canonical, query);
  cacheCandidate(fetched);
  return fetched;
}

async function tryDownloadPdf(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "mcp-server-scholar-oa/0.1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > 80 * 1024 * 1024) {
    throw new Error(`PDF too large (${contentLength} bytes)`);
  }

  const raw = Buffer.from(await response.arrayBuffer());
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const pdfSignature = raw.subarray(0, 4).toString("ascii");
  if (!contentType.includes("pdf") && pdfSignature !== "%PDF") {
    throw new Error(`Downloaded content is not a PDF (content-type=${contentType || "unknown"})`);
  }

  return raw;
}

function buildAbstractNote(candidate: PaperCandidate, note: string): string {
  const lines: string[] = [];
  lines.push(`# ${candidate.title}`);
  lines.push("");
  lines.push(`- OpenAlex: ${candidate.openalexId}`);
  if (candidate.doi) lines.push(`- DOI: ${candidate.doi}`);
  if (candidate.publicationYear) lines.push(`- Year: ${candidate.publicationYear}`);
  lines.push(`- OA: ${candidate.isOa ? "yes" : "no"} (${candidate.oaStatus})`);
  lines.push(`- Retrieval mode: abstract-only`);
  lines.push(`- Note: ${note}`);
  lines.push("");
  lines.push("## Abstract");
  lines.push(candidate.abstract || "No abstract available.");
  return lines.join("\n");
}

function formatCandidate(candidate: PaperCandidate): Record<string, unknown> {
  return {
    openalex_id: candidate.openalexId,
    title: candidate.title,
    year: candidate.publicationYear,
    doi: candidate.doi,
    authors: candidate.authors,
    cited_by_count: candidate.citedByCount,
    is_oa: candidate.isOa,
    oa_status: candidate.oaStatus,
    pdf_url: candidate.pdfUrl,
    landing_page_url: candidate.landingPageUrl,
    relevance_score: Number(candidate.relevanceScore.toFixed(3)),
    relevance_reasons: candidate.relevanceReasons,
    abstract_preview: truncateText(candidate.abstract, 420),
  };
}

export const scholarToolSchemas = {
  searchCandidates: {
    query: z.string().min(2).describe("Search query / keyword"),
    limit: z.number().int().min(1).max(50).default(20),
    fromYear: z.number().int().min(1900).max(2100).optional(),
    oaOnly: z.boolean().default(false),
  },
  screenCandidates: {
    query: z.string().min(2),
    candidateIds: z
      .array(z.string().min(1))
      .min(1)
      .max(100)
      .describe("OpenAlex IDs from search results"),
    threshold: z.number().min(0).max(1).default(0.35),
  },
  ingestToOpenWebUI: {
    candidateIds: z.array(z.string().min(1)).min(1).max(30),
    query: z.string().optional().describe("Original user query, used for metadata and fallback rescoring"),
    knowledgeBaseName: z.string().default("Public OA Scholar KB"),
    knowledgeBaseDescription: z
      .string()
      .default("OA-first literature corpus. Non-OA papers are stored as abstract-only notes."),
    makePublic: z.boolean().default(true),
    maxPapers: z.number().int().min(1).max(30).default(10),
    fileProcessTimeoutSec: z.number().int().min(30).max(3600).default(900),
    openwebuiBaseUrl: z.string().optional().describe("Optional override for OPENWEBUI_BASE_URL"),
    openwebuiApiKey: z.string().optional().describe("Optional override for OPENWEBUI_API_KEY"),
  },
};

const searchCandidatesSchema = z.object(scholarToolSchemas.searchCandidates);
const screenCandidatesSchema = z.object(scholarToolSchemas.screenCandidates);
const ingestToOpenWebUISchema = z.object(scholarToolSchemas.ingestToOpenWebUI);

export async function searchCandidatesTool(
  args: unknown
) {
  const input = searchCandidatesSchema.parse(args);
  const result = await openAlexClient.searchWorks({
    query: input.query,
    limit: input.limit,
    fromYear: input.fromYear,
    oaOnly: input.oaOnly,
  });

  const ranked = [...result.candidates].sort((a, b) => b.relevanceScore - a.relevanceScore);
  ranked.forEach(cacheCandidate);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            query: input.query,
            total_hits: result.total,
            returned: ranked.length,
            candidates: ranked.map(formatCandidate),
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function screenCandidatesTool(
  args: unknown
) {
  const input = screenCandidatesSchema.parse(args);
  const candidates: PaperCandidate[] = [];
  for (const id of input.candidateIds) {
    const candidate = await resolveCandidate(id, input.query);
    const rescored = { ...candidate };
    const relevance = computeRelevanceScore(input.query, candidate.title, candidate.abstract);
    rescored.relevanceScore = relevance.score;
    rescored.relevanceReasons = relevance.reasons;
    cacheCandidate(rescored);
    candidates.push(rescored);
  }

  const relevant = candidates.filter((item) => item.relevanceScore >= input.threshold);
  const irrelevant = candidates.filter((item) => item.relevanceScore < input.threshold);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            query: input.query,
            threshold: input.threshold,
            relevant_count: relevant.length,
            irrelevant_count: irrelevant.length,
            relevant: relevant.map(formatCandidate),
            irrelevant: irrelevant.map(formatCandidate),
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function ingestToOpenWebUITool(
  args: unknown
) {
  const input = ingestToOpenWebUISchema.parse(args);
  const openWebUI = new OpenWebUIClient({
    baseUrl: input.openwebuiBaseUrl,
    apiKey: input.openwebuiApiKey,
  });

  const uniqueIds = [...new Set(input.candidateIds)];
  const selectedIds = uniqueIds.slice(0, input.maxPapers);
  await mkdir(join(tmpdir(), "mcp-scholar-oa"), { recursive: true });

  const processed: Array<Record<string, unknown>> = [];
  const successfulFileIds: string[] = [];

  for (const rawId of selectedIds) {
    const candidate = await resolveCandidate(rawId, input.query ?? "");
    const baseName = sanitizeFilename(`${candidate.title}_${candidate.openalexShortId}`);
    let localPath = "";
    let retrievalMode: "pdf" | "abstract-only" = "abstract-only";
    let retrievalNote = "OA PDF unavailable; stored abstract-only note.";

    try {
      if (candidate.isOa && candidate.pdfUrl) {
        const pdfBuffer = await tryDownloadPdf(candidate.pdfUrl);
        localPath = join(tmpdir(), "mcp-scholar-oa", `${baseName}.pdf`);
        await writeFile(localPath, pdfBuffer);
        retrievalMode = "pdf";
        retrievalNote = "Downloaded OA PDF and uploaded for full embedding.";
      } else {
        localPath = join(tmpdir(), "mcp-scholar-oa", `${baseName}.md`);
        await writeFile(localPath, buildAbstractNote(candidate, retrievalNote), "utf8");
      }
    } catch (error) {
      localPath = join(tmpdir(), "mcp-scholar-oa", `${baseName}.md`);
      retrievalMode = "abstract-only";
      retrievalNote = `PDF download failed (${error instanceof Error ? error.message : String(error)}); stored abstract-only note.`;
      await writeFile(localPath, buildAbstractNote(candidate, retrievalNote), "utf8");
    }

    let uploadedFileId: string | null = null;
    let uploadStatus = "failed";
    let uploadError: string | null = null;
    try {
      const upload = await openWebUI.uploadFile(localPath, {
        source: "openalex",
        openalex_id: candidate.openalexId,
        doi: candidate.doi,
        title: candidate.title,
        retrieval_mode: retrievalMode,
        query: input.query ?? "",
      });

      uploadedFileId = upload.id;
      const finalStatus = await openWebUI.waitForFileProcessed(
        uploadedFileId,
        input.fileProcessTimeoutSec
      );
      uploadStatus = finalStatus.status;
      if (uploadStatus === "completed") {
        successfulFileIds.push(uploadedFileId);
      } else if (uploadStatus === "failed") {
        uploadError = "OpenWebUI processing failed";
      } else if (uploadStatus === "timeout") {
        uploadError = "OpenWebUI processing timeout";
      }
    } catch (error) {
      uploadError = error instanceof Error ? error.message : String(error);
    } finally {
      try {
        await unlink(localPath);
      } catch {
        // Ignore cleanup failures.
      }
    }

    processed.push({
      openalex_id: candidate.openalexId,
      title: candidate.title,
      retrieval_mode: retrievalMode,
      retrieval_note: retrievalNote,
      openwebui_file_id: uploadedFileId,
      openwebui_status: uploadStatus,
      error: uploadError,
    });
  }

  const kbInfo = await openWebUI.getOrCreateKnowledgeBase({
    name: input.knowledgeBaseName,
    description: input.knowledgeBaseDescription,
    makePublic: input.makePublic,
  });

  if (successfulFileIds.length > 0) {
    await openWebUI.addFilesToKnowledgeBase(kbInfo.knowledgeBase.id, successfulFileIds);
  }

  const isPublic = kbInfo.knowledgeBase.access_control === null;
  const warning =
    input.makePublic && !isPublic
      ? "Knowledge base is not publicly readable due to current OpenWebUI permissions. It was created/used with restricted access."
      : null;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            knowledge_base: {
              id: kbInfo.knowledgeBase.id,
              name: kbInfo.knowledgeBase.name,
              created: kbInfo.created,
              requested_public: input.makePublic,
              actual_public: isPublic,
            },
            uploaded_success_count: successfulFileIds.length,
            uploaded_failed_count: processed.length - successfulFileIds.length,
            warning,
            results: processed,
          },
          null,
          2
        ),
      },
    ],
  };
}
