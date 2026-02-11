export interface OpenAlexWork {
  id: string;
  doi: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  publication_date?: string | null;
  cited_by_count?: number | null;
  authorships?: Array<{
    author?: {
      display_name?: string | null;
    } | null;
  }>;
  open_access?: {
    is_oa?: boolean;
    oa_status?: string | null;
    oa_url?: string | null;
  } | null;
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
  } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

export interface OpenAlexSearchResponse {
  meta?: {
    count?: number;
    page?: number;
    per_page?: number;
  };
  results: OpenAlexWork[];
}

export interface PaperCandidate {
  openalexId: string;
  openalexShortId: string;
  title: string;
  publicationYear: number | null;
  publicationDate: string | null;
  doi: string | null;
  authors: string[];
  citedByCount: number;
  isOa: boolean;
  oaStatus: string;
  pdfUrl: string | null;
  landingPageUrl: string | null;
  abstract: string;
  relevanceScore: number;
  relevanceReasons: string[];
}

export interface OpenWebUIKnowledge {
  id: string;
  name: string;
  description: string;
  access_control?: Record<string, unknown> | null;
}

export interface OpenWebUIFileUploadResponse {
  id: string;
  filename?: string;
  data?: {
    status?: string;
    error?: string;
  } | null;
}
