import type Anthropic from '@anthropic-ai/sdk';

export type LlmProvider = 'anthropic' | 'ollama';

export type ThinkingBudget = 'max' | 'high' | 'medium' | 'low';

export interface WebSearchResult {
  title: string;
  url: string;
  pageAge?: string | null;
}

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
  onWebSearch?: (query: string) => void;
  onWebSearchResults?: (results: WebSearchResult[]) => void;
  onDone?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Options use Anthropic's MessageParam shape because the codebase composes
 * messages that way. The Ollama backend converts to its own shape internally.
 */
export interface StreamOptions {
  apiKey: string;
  model?: string;
  system?: string;
  messages: Anthropic.MessageParam[];
  thinkingBudget?: ThinkingBudget;
  // Custom and server-side tools (web_search, etc.). Ollama silently ignores.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: any[];
  maxTokens?: number;
  /** Provider override. If omitted, the active provider in apiStore is used. */
  provider?: LlmProvider;
}
