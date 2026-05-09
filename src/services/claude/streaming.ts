// Compatibility facade. Real implementation lives in `src/services/llm/`,
// which routes between the Anthropic and Ollama backends based on the
// active provider in apiStore. Existing imports from this path keep working.
export {
  streamMessage,
  streamWithRetry,
  sendMessage,
} from '../llm';
export type {
  StreamCallbacks,
  StreamOptions,
  WebSearchResult,
  ThinkingBudget,
  LlmProvider,
} from '../llm';
