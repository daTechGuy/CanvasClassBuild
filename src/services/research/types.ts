import type { ResearchDossier } from '../../types/course';
import type { WebSearchResult } from '../llm/types';

export type ResearchBackend = 'anthropic' | 'tavily' | 'wikipedia';

export interface ResearchProgress {
  phase?: 'thinking' | 'searching' | 'compiling' | 'validating';
  appendQueries?: string[];
  appendResults?: WebSearchResult[];
  appendSynthesisText?: string;
  setLatestSource?: WebSearchResult | null;
}

export type ResearchProgressCallback = (update: ResearchProgress) => void;

export interface RunResearchOptions {
  chapterNumber: number;
  chapterTitle: string;
  chapterNarrative: string;
  keyConcepts: string[];
  /** Active LLM provider's API key (used by tavily/wikipedia backends). */
  llmApiKey: string;
  /** Anthropic key. Required by the anthropic backend regardless of active provider. */
  claudeApiKey: string;
  /** Tavily key, required by the tavily backend. */
  tavilyApiKey?: string;
}

export interface RunResearchResult {
  dossier: ResearchDossier;
  /** Raw LLM output (used as a fallback for synthesisNotes when JSON parse fails). */
  rawText: string;
  /** Web results gathered during search (used to backfill the dossier on parse failure). */
  webResults: WebSearchResult[];
}
