import { streamWithRetry } from '../llm';
import { RESEARCH_SYSTEM_PROMPT, buildResearchUserPrompt, parseResearchResponse } from '../../prompts/research';
import type { WebSearchResult } from '../llm/types';
import type { RunResearchOptions, RunResearchResult, ResearchProgressCallback } from './types';

/**
 * Original behavior — Claude with the built-in web_search server tool. Kept
 * verbatim from the pre-refactor ResearchPage flow, just behind the new
 * runResearch shape.
 */
export async function researchAnthropic(
  options: RunResearchOptions,
  progress: ResearchProgressCallback,
): Promise<RunResearchResult> {
  const { chapterNumber, chapterTitle, chapterNarrative, keyConcepts, claudeApiKey } = options;

  const localWebResults: WebSearchResult[] = [];

  const fullText = await streamWithRetry(
    {
      apiKey: claudeApiKey,
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildResearchUserPrompt(chapterTitle, chapterNarrative, keyConcepts),
        },
      ],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      maxTokens: 16000,
      // Force Anthropic regardless of the active LLM provider — only Claude
      // exposes the web_search server tool.
      provider: 'anthropic',
    },
    {
      onThinking: () => progress({ phase: 'thinking' }),
      onText: (text) => progress({ phase: 'compiling', appendSynthesisText: text }),
      onWebSearch: (query) => progress({ phase: 'searching', appendQueries: [query] }),
      onWebSearchResults: (results) => {
        const newResults = results.filter(
          (r) => !localWebResults.some((existing) => existing.url === r.url),
        );
        localWebResults.push(...newResults);
        progress({
          appendResults: newResults,
          setLatestSource: newResults.length > 0 ? newResults[newResults.length - 1] : null,
        });
      },
    },
  );

  const dossier = parseResearchResponse(fullText, chapterNumber) ?? {
    chapterNumber,
    sources: localWebResults.map((r) => ({
      title: r.title,
      authors: '',
      year: '',
      url: r.url,
      summary: '',
      relevance: '',
      isVerified: true,
    })),
    synthesisNotes: fullText.slice(0, 500),
  };

  return { dossier, rawText: fullText, webResults: localWebResults };
}
