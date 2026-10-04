import Anthropic from '@anthropic-ai/sdk';

let clientInstance: Anthropic | null = null;
let currentKey = '';

export function getClient(apiKey: string): Anthropic {
  if (clientInstance && currentKey === apiKey) return clientInstance;
  currentKey = apiKey;
  clientInstance = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
  return clientInstance;
}

export const MODELS = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

export const OLLAMA_MODELS = {
  default: 'gpt-oss:120b-cloud',
  qwenCoder: 'qwen3-coder:480b-cloud',
  deepseek: 'deepseek-v3.1:671b-cloud',
} as const;

export const DEFAULT_OLLAMA_MODEL = OLLAMA_MODELS.default;

// Gemini ids change often — the Setup page lets the user type any model id; these are
// just the defaults (https://ai.google.dev/gemini-api/docs/models).
export const GEMINI_MODELS = {
  default: 'gemini-3.8-flash',
  pro: 'gemini-3.1-pro-preview',
} as const;

export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS.default;

export type ThinkingBudget = 'max' | 'high' | 'medium' | 'low';

const BUDGET_TOKENS: Record<ThinkingBudget, number> = {
  max: 32000,
  high: 16000,
  medium: 8000,
  low: 4000,
};

export function getThinkingTokens(budget: ThinkingBudget): number {
  return BUDGET_TOKENS[budget];
}
