import type Anthropic from '@anthropic-ai/sdk';
import { useApiStore } from '../../store/apiStore';
import { streamMessageAnthropic, sendMessageAnthropic } from './anthropic';
import { streamMessageOllama } from './ollama';
import { streamMessageGemini } from './gemini';
import type { StreamCallbacks, StreamOptions, LlmProvider } from './types';

export type { LlmProvider, StreamCallbacks, StreamOptions, WebSearchResult, ThinkingBudget } from './types';

/**
 * Call sites pass Anthropic model ids (MODELS.opus …). Those mean nothing to a
 * non-Claude provider, so only an explicit non-Claude override is honoured.
 */
function explicitNonClaudeModel(model?: string): string | undefined {
  return model && !model.startsWith('claude-') ? model : undefined;
}

/**
 * Resolve the provider + concrete (apiKey, model) pair for this call. An
 * explicit `provider` in options wins; otherwise we read the active provider
 * from apiStore. On Ollama/Gemini, the apiKey/model passed in (which call sites
 * derive from the legacy Anthropic store fields) is overridden with that
 * provider's own store fields.
 */
function resolveProvider(options: StreamOptions): {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
} {
  const state = useApiStore.getState();
  const provider = options.provider ?? state.provider;
  // Explicit overrides win (the CLI doesn't touch the IndexedDB-backed apiStore);
  // otherwise fall back to the store, as in the browser flow.
  if (provider === 'ollama') {
    return {
      provider,
      apiKey: options.ollamaApiKey || state.ollamaApiKey,
      model: explicitNonClaudeModel(options.model) || options.ollamaModel || state.ollamaModel,
    };
  }
  if (provider === 'gemini') {
    return {
      provider,
      apiKey: options.geminiApiKey || state.geminiApiKey,
      model: explicitNonClaudeModel(options.model) || options.geminiModel || state.geminiModel,
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
  if (provider === 'gemini') {
    return streamMessageGemini(resolved, callbacks);
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
      // Never retry a user-initiated cancel.
      if (options.signal?.aborted) throw err;
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
