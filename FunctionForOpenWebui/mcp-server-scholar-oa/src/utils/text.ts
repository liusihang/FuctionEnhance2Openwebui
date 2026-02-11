export function normalizeOpenAlexId(raw: string): { canonical: string; short: string } {
  const match = raw.match(/W\d+/i);
  if (!match) {
    throw new Error(`Invalid OpenAlex id: ${raw}`);
  }

  const short = match[0].toUpperCase();
  return {
    canonical: `https://openalex.org/${short}`,
    short,
  };
}

export function rebuildAbstractFromInvertedIndex(
  abstractInvertedIndex: Record<string, number[]> | null | undefined
): string {
  if (!abstractInvertedIndex) {
    return "";
  }

  let maxPosition = -1;
  for (const positions of Object.values(abstractInvertedIndex)) {
    for (const pos of positions) {
      if (pos > maxPosition) {
        maxPosition = pos;
      }
    }
  }

  if (maxPosition < 0) {
    return "";
  }

  const tokens: string[] = new Array(maxPosition + 1).fill("");
  for (const [word, positions] of Object.entries(abstractInvertedIndex)) {
    for (const pos of positions) {
      tokens[pos] = word;
    }
  }

  return tokens
    .filter((token) => token.trim().length > 0)
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function tokenize(input: string): string[] {
  if (!input) {
    return [];
  }

  const matches = input.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu);
  return matches ? matches : [];
}

export function uniqueTokens(input: string): string[] {
  return [...new Set(tokenize(input))];
}

export function computeRelevanceScore(
  query: string,
  title: string,
  abstract: string
): { score: number; reasons: string[] } {
  const qTokens = uniqueTokens(query);
  if (qTokens.length === 0) {
    return { score: 0, reasons: ["Empty query tokens"] };
  }

  const titleTokens = new Set(tokenize(title));
  const bodyTokens = new Set(tokenize(`${title} ${abstract}`));

  let overlap = 0;
  let titleOverlap = 0;

  for (const token of qTokens) {
    if (bodyTokens.has(token)) {
      overlap += 1;
    }
    if (titleTokens.has(token)) {
      titleOverlap += 1;
    }
  }

  const queryCoverage = overlap / qTokens.length;
  const titleCoverage = titleOverlap / qTokens.length;
  const phraseBoost = title.toLowerCase().includes(query.toLowerCase()) ? 0.15 : 0;
  const abstractBoost = abstract.length > 0 ? 0.05 : 0;
  const score = Math.min(1, 0.55 * queryCoverage + 0.25 * titleCoverage + phraseBoost + abstractBoost);

  const reasons: string[] = [];
  reasons.push(`query_coverage=${queryCoverage.toFixed(2)}`);
  reasons.push(`title_coverage=${titleCoverage.toFixed(2)}`);
  if (phraseBoost > 0) reasons.push("exact_query_phrase_in_title");
  if (abstractBoost > 0) reasons.push("abstract_available");

  return { score, reasons };
}

export function sanitizeFilename(input: string, maxLen = 120): string {
  const ascii = input
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  const safe = ascii.length > 0 ? ascii : "paper";
  return safe.slice(0, maxLen).trim().replace(/\s/g, "_");
}

export function truncateText(input: string, maxLen = 600): string {
  if (input.length <= maxLen) {
    return input;
  }
  return `${input.slice(0, maxLen - 3)}...`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
