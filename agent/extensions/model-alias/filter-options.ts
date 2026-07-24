/**
 * Lightweight fuzzy filter for model labels (provider/id).
 * Same contract as pi-tui's fuzzyFilter: all whitespace/slash tokens must match;
 * characters within a token match in order (not necessarily consecutive).
 */

export interface FuzzyMatch {
  matches: boolean;
  score: number;
}

/** Match query chars in order within text. Lower score = better. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  if (queryLower.length === 0) return { matches: true, score: 0 };
  if (queryLower.length > textLower.length) return { matches: false, score: 0 };

  let queryIndex = 0;
  let score = 0;
  let lastMatchIndex = -1;
  let consecutiveMatches = 0;

  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      const isWordBoundary = i === 0 || /[\s\-_./:]/.test(textLower[i - 1]!);
      if (lastMatchIndex === i - 1) {
        consecutiveMatches++;
        score -= consecutiveMatches * 5;
      } else {
        consecutiveMatches = 0;
        if (lastMatchIndex >= 0) score += (i - lastMatchIndex - 1) * 2;
      }
      if (isWordBoundary) score -= 10;
      score += i * 0.1;
      lastMatchIndex = i;
      queryIndex++;
    }
  }

  if (queryIndex < queryLower.length) return { matches: false, score: 0 };
  if (queryLower === textLower) score -= 100;
  return { matches: true, score };
}

/** Filter and sort by fuzzy quality (best first). Tokens split on space or /. */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  const q = query.trim();
  if (!q) return items;

  const tokens = q.split(/[\s/]+/).filter(Boolean);
  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const text = getText(item);
    let total = 0;
    let ok = true;
    for (const token of tokens) {
      const m = fuzzyMatch(token, text);
      if (!m.matches) {
        ok = false;
        break;
      }
      total += m.score;
    }
    if (ok) scored.push({ item, score: total });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.item);
}

/** Filter model labels with the same fuzzy rules as built-in selectors. */
export function filterSearchableOptions(options: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return options;
  return fuzzyFilter(options, q, (s) => s);
}
