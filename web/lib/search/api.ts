/**
 * Client for the pose-guide retrieval API (server/api/search_routes.py).
 *
 * These types mirror the server's responses. As with lib/contracts/yoga.ts,
 * this file is the only place the wire format is written down on the client.
 */

import { config } from '@/lib/config';

export type SearchModel = 'boolean' | 'bim' | 'bim_feedback' | 'bm25' | 'bm25f';

export const MODEL_LABELS: Record<SearchModel, string> = {
  boolean: 'Boolean',
  bim: 'BIM',
  bim_feedback: 'BIM + feedback',
  bm25: 'BM25',
  bm25f: 'BM25F',
};

/** One line of plain language per model, shown under the switch. */
export const MODEL_BLURBS: Record<SearchModel, string> = {
  boolean:
    'Yes or no. Every word is a set of guides; AND, OR and NOT combine the sets. Nothing is ranked.',
  bim:
    'Rare words are better clues. Each query word a guide contains adds its rarity weight — once, however often it appears.',
  bim_feedback:
    'BIM, then assume the top 3 are relevant, re-estimate every word’s weight from them, and rank again.',
  bm25:
    'BIM’s rarity, plus: more mentions help but with diminishing returns, and long guides get a handicap.',
  bm25f:
    'BM25 where a word in the pose’s name or its mistakes counts more than the same word in a caution.',
};

export interface GuideSummary {
  id: number;
  slug: string;
  name: string;
  sanskrit: string;
  level: string;
  category: string;
  trackable: boolean;
  overview: string;
}

/** Per-term evidence. Which keys are present depends on the model. */
export interface TermEvidence {
  term: string;
  df: number;
  contribution: number;
  tf?: number;
  idf?: number;
  length_norm?: number;
  p?: number;
  u?: number;
  fields?: Record<string, number>;
  weighted_tf?: number;
}

export interface SearchHit {
  doc: GuideSummary;
  score: number | null;
  terms: TermEvidence[];
  snippet: string | null;
}

export interface SearchResponse {
  model: SearchModel;
  query: string;
  expression: string | null;
  terms: string[];
  ranked: boolean;
  total: number;
  results: SearchHit[];
}

export interface CompareResponse {
  query: string;
  boolean: string;
  models: SearchResponse[];
}

export interface RegionHit {
  doc_id: number;
  list: string;
  label: string;
  start: number;
  end: number;
  text: string;
}

export interface StructuredResponse {
  model: 'non_overlapped' | 'overlapped';
  expression: string;
  terms: string[];
  regions_considered: number;
  documents: { doc: GuideSummary; regions: RegionHit[] }[];
  total_regions: number;
  shortest_regions?: number;
  overlapping_pairs: number;
}

export type MetricKey = 'P@3' | 'P@5' | 'R@5' | 'MAP' | 'MRR';

export interface BenchmarkResponse {
  queries: {
    id: string;
    text: string;
    boolean: string;
    source: string;
    relevant: string[];
    rankings: Record<string, string[]>;
    metrics: Record<string, Record<string, number>>;
    boolean_set: { precision: number; recall: number; f1: number; retrieved: number };
  }[];
  summary: Record<string, Record<MetricKey, number>>;
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${config.api.baseUrl}/api/search${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `Search failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // Not JSON — keep the status line.
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const searchApi = {
  search: (q: string, model: SearchModel) => get<SearchResponse>('', { q, model }),
  compare: (q: string, boolean?: string) =>
    get<CompareResponse>('/compare', boolean ? { q, boolean } : { q }),
  structured: (q: string) => get<StructuredResponse>('/structured', { q }),
  benchmarks: () => get<BenchmarkResponse>('/benchmarks'),
};

/**
 * Whether a displayed word is an occurrence of a stemmed query term.
 * "balanc" should light up "balance" and "balancing"; "arm" lights "arms".
 */
export function matchesTerm(word: string, terms: string[]): boolean {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return false;
  return terms.some((t) => w === t || (t.length >= 3 && w.startsWith(t)));
}
