import type { WebSearchResult } from '../llm/types';
import { generateSearchQueries, synthesizeDossier } from './llmHelpers';
import type { RunResearchOptions, RunResearchResult, ResearchProgressCallback } from './types';

const TAVILY_URL = 'https://api.tavily.com/search';

interface TavilyHit {
  title: string;
  url: string;
  content?: string;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyHit[];
}

async function tavilySearch(apiKey: string, query: string): Promise<TavilyHit[]> {
  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      search_depth: 'basic',
      include_answer: false,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Tavily ${res.status}: ${detail || res.statusText}`);
  }
  const data: TavilyResponse = await res.json();
  return data.results || [];
}

export async function researchTavily(
  options: RunResearchOptions,
  progress: ResearchProgressCallback,
): Promise<RunResearchResult> {
  const {
    chapterNumber,
    chapterTitle,
    chapterNarrative,
    keyConcepts,
    llmApiKey,
    tavilyApiKey,
  } = options;

  if (!tavilyApiKey) {
    throw new Error('Tavily API key is missing — paste it on the Setup page.');
  }

  progress({ phase: 'thinking' });
  const queries = await generateSearchQueries(llmApiKey, chapterTitle, chapterNarrative, keyConcepts);

  progress({ phase: 'searching' });
  const seen = new Set<string>();
  const webResults: WebSearchResult[] = [];
  const extras: Record<string, string> = {};

  for (const query of queries) {
    progress({ appendQueries: [query] });
    let hits: TavilyHit[] = [];
    try {
      hits = await tavilySearch(tavilyApiKey, query);
    } catch (err) {
      // One bad query shouldn't blow up the whole run — keep going with whatever
      // results we already have.
      console.warn(`Tavily search failed for "${query}":`, err);
      continue;
    }
    const fresh: WebSearchResult[] = [];
    for (const h of hits) {
      if (!h.url || seen.has(h.url)) continue;
      seen.add(h.url);
      const result: WebSearchResult = { title: h.title || h.url, url: h.url, pageAge: h.published_date };
      fresh.push(result);
      webResults.push(result);
      if (h.content) extras[h.url] = h.content;
    }
    if (fresh.length > 0) {
      progress({
        appendResults: fresh,
        setLatestSource: fresh[fresh.length - 1],
      });
    }
  }

  progress({ phase: 'compiling' });
  const { dossier, rawText } = await synthesizeDossier(
    llmApiKey,
    chapterNumber,
    chapterTitle,
    chapterNarrative,
    keyConcepts,
    webResults,
    extras,
    (text) => progress({ appendSynthesisText: text }),
  );

  return { dossier, rawText, webResults };
}
