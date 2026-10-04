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

export {
  MODELS,
  OLLAMA_MODELS,
  DEFAULT_OLLAMA_MODEL,
  GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL,
  getThinkingTokens,
} from '../llm/models';
export type { ThinkingBudget } from '../llm/models';

