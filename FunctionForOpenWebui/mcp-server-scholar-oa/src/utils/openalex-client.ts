import type { OpenAlexSearchResponse, OpenAlexWork, PaperCandidate } from "../types.js";
import {
  computeRelevanceScore,
  normalizeOpenAlexId,
  rebuildAbstractFromInvertedIndex,
} from "./text.js";

export class OpenAlexClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public url?: string
  ) {
    super(message);
    this.name = "OpenAlexClientError";
  }
}

export class OpenAlexClient {
  private readonly baseUrl = "https://api.openalex.org";
  private readonly apiKey = process.env.OPENALEX_API_KEY ?? "";
  private readonly mailto = process.env.OPENALEX_MAILTO ?? "";

  private buildUrl(path: string, query: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    if (this.apiKey) {
      url.searchParams.set("api_key", this.apiKey);
    }
    if (this.mailto) {
      url.searchParams.set("mailto", this.mailto);
    }

    return url.toString();
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "mcp-server-scholar-oa/0.1.0",
      },
    });

    if (!response.ok) {
      throw new OpenAlexClientError(
        `OpenAlex request failed: HTTP ${response.status} ${response.statusText}`,
        response.status,
        url
      );
    }

    return (await response.json()) as T;
  }

  async searchWorks(params: {
    query: string;
    limit: number;
    fromYear?: number;
    oaOnly?: boolean;
  }): Promise<{ total: number; candidates: PaperCandidate[] }> {
    const filters: string[] = [];
    if (params.fromYear) {
      filters.push(`from_publication_date:${params.fromYear}-01-01`);
    }
    if (params.oaOnly) {
      filters.push("is_oa:true");
    }

    const url = this.buildUrl("/works", {
      search: params.query,
      "per-page": params.limit,
      select:
        "id,doi,title,display_name,publication_year,publication_date,cited_by_count,authorships,open_access,primary_location,abstract_inverted_index",
      filter: filters.length > 0 ? filters.join(",") : undefined,
    });

    const data = await this.fetchJson<OpenAlexSearchResponse>(url);
    const works = data.results ?? [];
    const candidates = works.map((work) => this.toCandidate(work, params.query));
    return {
      total: data.meta?.count ?? works.length,
      candidates,
    };
  }

  async getWork(openalexId: string, query = ""): Promise<PaperCandidate> {
    const { short } = normalizeOpenAlexId(openalexId);
    const url = this.buildUrl(`/works/${short}`, {
      select:
        "id,doi,title,display_name,publication_year,publication_date,cited_by_count,authorships,open_access,primary_location,abstract_inverted_index",
    });
    const data = await this.fetchJson<OpenAlexWork>(url);
    return this.toCandidate(data, query);
  }

  toCandidate(work: OpenAlexWork, query: string): PaperCandidate {
    const idInfo = normalizeOpenAlexId(work.id);
    const title = (work.display_name || work.title || "").trim();
    const abstract = rebuildAbstractFromInvertedIndex(work.abstract_inverted_index);
    const relevance = computeRelevanceScore(query, title, abstract);

    const authors =
      work.authorships
        ?.map((a) => a.author?.display_name?.trim() || "")
        .filter((name) => name.length > 0)
        .slice(0, 6) ?? [];

    const openAccess = work.open_access || {};
    const primaryLocation = work.primary_location || {};

    return {
      openalexId: idInfo.canonical,
      openalexShortId: idInfo.short,
      title,
      publicationYear: work.publication_year ?? null,
      publicationDate: work.publication_date ?? null,
      doi: work.doi ?? null,
      authors,
      citedByCount: work.cited_by_count ?? 0,
      isOa: Boolean(openAccess.is_oa),
      oaStatus: openAccess.oa_status ?? "unknown",
      pdfUrl: primaryLocation.pdf_url ?? openAccess.oa_url ?? null,
      landingPageUrl: primaryLocation.landing_page_url ?? work.doi ?? null,
      abstract,
      relevanceScore: relevance.score,
      relevanceReasons: relevance.reasons,
    };
  }
}

export const openAlexClient = new OpenAlexClient();
