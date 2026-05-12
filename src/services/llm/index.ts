import type Anthropic from '@anthropic-ai/sdk';
import { useApiStore } from '../../store/apiStore';
import { streamMessageAnthropic, sendMessageAnthropic } from './anthropic';
import { streamMessageOllama } from './ollama';
import type { StreamCallbacks, StreamOptions, LlmProvider } from './types';

export type { LlmProvider, StreamCallbacks, StreamOptions, WebSearchResult, ThinkingBudget } from './types';

/**
 * Resolve the provider + concrete (apiKey, model) pair for this call. An
 * explicit `provider` in options wins; otherwise we read the active provider
 * from apiStore. On Ollama, the apiKey/model passed in (which call sites
 * derive from the legacy Anthropic store fields) is overridden with the
 * Ollama-specific store fields.
 */
function resolveProvider(options: StreamOptions): {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
} {
  const explicit = options.provider;
  const state = useApiStore.getState();
  const provider = explicit ?? state.provider;
  if (provider === 'ollama') {
    // Prefer explicit overrides (used by the CLI, which doesn't touch
    // the IndexedDB-backed apiStore). Fall back to store state in the
    // browser flow.
    return {
      provider,
      apiKey: options.ollamaApiKey || state.ollamaApiKey,
      model: options.model || options.ollamaModel || state.ollamaModel,
    };
  }
  return { provider, apiKey: options.apiKey, model: options.model };
}

export async function streamMessage(
  options: StreamOptions,
  callbacks: StreamCallbacks,
): Promise<string> {
  const { provider, apiKey, model } = resolveProvider(options);
  const resolved: StreamOptions = { ...options, apiKey, model };
  if (provider === 'ollama') {
    return streamMessageOllama(resolved, callbacks);
  }
  return streamMessageAnthropic(resolved, callbacks);
}

export async function streamWithRetry(
  options: StreamOptions,
  callbacks: StreamCallbacks,
  maxRetries = 3,
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await streamMessage(options, callbacks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('rate');
      if (isRateLimit && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1500));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Non-streaming variant. Anthropic-only — Ollama callers should use
 * streamMessage and accumulate text via callbacks.
 */
export async function sendMessage(
  options: Omit<StreamOptions, 'maxTokens'> & { maxTokens?: number },
): Promise<Anthropic.Message> {
  return sendMessageAnthropic(options);
}
