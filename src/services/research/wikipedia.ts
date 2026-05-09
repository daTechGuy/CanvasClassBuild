import type { WebSearchResult } from '../llm/types';
import { generateSearchQueries, synthesizeDossier } from './llmHelpers';
import type { RunResearchOptions, RunResearchResult, ResearchProgressCallback } from './types';

interface WikiSearchHit {
  title: string;
  snippet?: string;
  pageid?: number;
}

interface WikiSearchResponse {
  query?: { search?: WikiSearchHit[] };
}

const WIKI_URL = 'https://en.wikipedia.org/w/api.php';

async function wikiSearch(query: string): Promise<WikiSearchHit[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '5',
    format: 'json',
    origin: '*',
  });
  const res = await fetch(`${WIKI_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Wikipedia ${res.status}: ${res.statusText}`);
  }
  const data: WikiSearchResponse = await res.json();
  return data.query?.search || [];
}

function stripWikiSnippet(html: string): string {
  // Wikipedia returns snippets with <span class="searchmatch"> wrappers; strip
  // tags to keep the synthesis prompt clean.
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function articleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export async function researchWikipedia(
  options: RunResearchOptions,
  progress: ResearchProgressCallback,
): Promise<RunResearchResult> {
  const { chapterNumber, chapterTitle, chapterNarrative, keyConcepts, llmApiKey } = options;

  progress({ phase: 'thinking' });
  const queries = await generateSearchQueries(llmApiKey, chapterTitle, chapterNarrative, keyConcepts);

  progress({ phase: 'searching' });
  const seen = new Set<string>();
  const webResults: WebSearchResult[] = [];
  const extras: Record<string, string> = {};

  for (const query of queries) {
    progress({ appendQueries: [query] });
    let hits: WikiSearchHit[] = [];
    try {
      hits = await wikiSearch(query);
    } catch (err) {
      console.warn(`Wikipedia search failed for "${query}":`, err);
      continue;
    }
    const fresh: WebSearchResult[] = [];
    for (const h of hits) {
      const url = articleUrl(h.title);
      if (seen.has(url)) continue;
      seen.add(url);
      const result: WebSearchResult = { title: h.title, url };
      fresh.push(result);
      webResults.push(result);
      if (h.snippet) extras[url] = stripWikiSnippet(h.snippet);
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
