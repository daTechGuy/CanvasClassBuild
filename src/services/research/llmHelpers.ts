import { streamMessage } from '../llm';
import { parseResearchResponse, RESEARCH_SYSTEM_PROMPT } from '../../prompts/research';
import type { ResearchDossier } from '../../types/course';
import type { WebSearchResult } from '../llm/types';

/**
 * Ask the active LLM to produce 4–6 web search queries for the chapter.
 * Returns an array of query strings; falls back to a single chapterTitle-based
 * query if the model output can't be parsed.
 */
export async function generateSearchQueries(
  apiKey: string,
  chapterTitle: string,
  chapterNarrative: string,
  keyConcepts: string[],
): Promise<string[]> {
  const system =
    'You generate web search queries that surface authoritative academic sources for a university course chapter. Output ONLY a JSON array of 4–6 short search query strings, no prose, no code fence.';
  const user = `Chapter: "${chapterTitle}"
Description: ${chapterNarrative}
Key concepts: ${keyConcepts.join(', ')}

Generate 4–6 targeted search queries.`;

  let raw = '';
  try {
    raw = await streamMessage(
      {
        apiKey,
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 800,
      },
      {},
    );
  } catch {
    /* fall through to fallback */
  }

  const queries = parseQueryArray(raw);
  if (queries.length > 0) return queries;

  const fallback = [
    `${chapterTitle} academic review`,
    keyConcepts[0] ? `${keyConcepts[0]} seminal paper` : `${chapterTitle} textbook`,
  ].filter(Boolean);
  return fallback;
}

function parseQueryArray(raw: string): string[] {
  if (!raw) return [];
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) text = fence[1];
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((q) => (typeof q === 'string' ? q.trim() : ''))
      .filter((q) => q.length > 0)
      .slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * Hand collected search results to the LLM and ask for the dossier JSON.
 * Streams text via the onText callback so progress UI keeps updating.
 */
export async function synthesizeDossier(
  apiKey: string,
  chapterNumber: number,
  chapterTitle: string,
  chapterNarrative: string,
  keyConcepts: string[],
  results: WebSearchResult[],
  resultExtras: Record<string, string>,
  onText: (text: string) => void,
): Promise<{ dossier: ResearchDossier; rawText: string }> {
  const formattedResults = results.length
    ? results
        .map((r, i) => {
          const extra = resultExtras[r.url] ? `\n   ${resultExtras[r.url].slice(0, 600)}` : '';
          return `${i + 1}. ${r.title}\n   ${r.url}${extra}`;
        })
        .join('\n\n')
    : '(no search results returned — produce a dossier from your prior knowledge, set isVerified=false on every source)';

  const user = `Build a research dossier for the chapter below.

**Chapter**: "${chapterTitle}"
**Description**: ${chapterNarrative}
**Key concepts**: ${keyConcepts.join(', ')}

**Search results to draw from**:
${formattedResults}

Produce 5–8 dossier sources. Prefer the search results above; only fall back to your prior knowledge if the results are thin. Output ONLY the JSON dossier.`;

  const rawText = await streamMessage(
    {
      apiKey,
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
      maxTokens: 8000,
    },
    {
      onText,
    },
  );

  const dossier = parseResearchResponse(rawText, chapterNumber) ?? {
    chapterNumber,
    sources: results.slice(0, 8).map((r) => ({
      title: r.title,
      authors: '',
      year: '',
      url: r.url,
      summary: '',
      relevance: '',
      isVerified: true,
    })),
    synthesisNotes: rawText.slice(0, 500),
  };

  return { dossier, rawText };
}
