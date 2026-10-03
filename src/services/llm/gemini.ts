import type Anthropic from '@anthropic-ai/sdk';
import { getThinkingTokens } from '../claude/client';
import type { StreamCallbacks, StreamOptions } from './types';

/**
 * Google Gemini backend (generateContent / streamGenerateContent, REST + SSE).
 *
 * Unlike Ollama Cloud, Google answers CORS preflights (including for the
 * `x-goog-api-key` header) from any origin, so the browser calls it directly — no
 * proxy. The key goes in a header rather than the `?key=` query string so it never
 * lands in URLs, logs or referrers.
 *
 * Like the Ollama backend this ignores Anthropic server tools (web search), so the
 * "Claude web search" research backend still needs a Claude key; Tavily and
 * Wikipedia research work with Gemini as the synthesising model.
 */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Output ceiling for the current Flash/Pro models. */
const GEMINI_MAX_OUTPUT_TOKENS = 65536;

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

/** Anthropic content blocks → plain text (tool blocks are dropped, as for Ollama). */
function flattenContent(content: Anthropic.MessageParam['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = block as any;
      return b.type === 'text' && typeof b.text === 'string' ? b.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function toGeminiContents(messages: Anthropic.MessageParam[]): GeminiContent[] {
  return messages
    .map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: flattenContent(m.content) }],
    }))
    .filter((c) => c.parts[0].text.length > 0);
}

/**
 * Carries the HTTP status so `friendlyError` (utils/errors.ts) can map it, as it does for
 * the SDK errors from the other providers. (No parameter properties: erasableSyntaxOnly.)
 */
class GeminiHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GeminiHttpError';
    this.status = status;
  }
}

/** Google's error envelope → one readable line that keeps the HTTP code (retry logic keys off "429"). */
async function errorFromResponse(res: Response): Promise<Error> {
  const raw = await res.text().catch(() => '');
  let message = '';
  let status = '';
  try {
    const j = JSON.parse(raw) as GeminiChunk;
    message = j.error?.message ?? '';
    status = j.error?.status ?? '';
  } catch {
    message = raw;
  }
  return new GeminiHttpError(`Gemini ${res.status}${status ? ` ${status}` : ''}: ${message || res.statusText}`, res.status);
}

const BLOCK_REASONS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

export async function streamMessageGemini(
  options: StreamOptions,
  callbacks: StreamCallbacks,
): Promise<string> {
  const { apiKey, model, system, messages, thinkingBudget, maxTokens = 16000, signal } = options;

  const fail = (message: string): never => {
    const err = new Error(message);
    callbacks.onError?.(err);
    throw err;
  };
  if (!model) fail('Gemini provider requires a model name (e.g. gemini-3.8-flash).');
  if (!apiKey) fail('Gemini API key is missing — paste it on the Setup page.');

  const contents = toGeminiContents(messages);
  if (contents.length === 0) fail('Gemini was given no message content.');

  // Thinking tokens count toward maxOutputTokens (a hard cutoff), so leave headroom above
  // the caller's intended output — same reasoning as the Opus path in anthropic.ts.
  const maxOutputTokens = Math.min(
    GEMINI_MAX_OUTPUT_TOKENS,
    maxTokens + (thinkingBudget ? getThinkingTokens(thinkingBudget) * 2 : 0),
  );

  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model!)}:streamGenerateContent?alt=sse`;

  const request = (withThoughts: boolean) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          maxOutputTokens,
          // Ask for thought *summaries* so the UI's "thinking" trace works. Not every model
          // accepts this, so a 400 about it is retried once without.
          ...(withThoughts && thinkingBudget ? { thinkingConfig: { includeThoughts: true } } : {}),
        },
      }),
      signal,
    });

  let fullText = '';

  try {
    let res = await request(true);
    if (res.status === 400 && thinkingBudget) {
      const err = await errorFromResponse(res);
      if (!/think|thought/i.test(err.message)) throw err;
      res = await request(false);
    }
    if (!res.ok || !res.body) throw await errorFromResponse(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: string | undefined;
    let blockReason: string | undefined;

    const handle = (payload: string) => {
      let chunk: GeminiChunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        return; // partial/keep-alive
      }
      if (chunk.error) {
        throw new GeminiHttpError(
          `Gemini ${chunk.error.code ?? ''} ${chunk.error.status ?? ''}: ${chunk.error.message ?? 'stream error'}`.replace(/\s+/g, ' '),
          chunk.error.code ?? 500,
        );
      }
      if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
      const cand = chunk.candidates?.[0];
      if (cand?.finishReason) finishReason = cand.finishReason;
      for (const part of cand?.content?.parts ?? []) {
        if (!part.text) continue;
        if (part.thought) {
          callbacks.onThinking?.(part.text);
        } else {
          fullText += part.text;
          callbacks.onText?.(part.text);
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE: events are separated by a blank line; each has one or more `data:` lines.
      let sep = buffer.search(/\r?\n\r?\n/);
      while (sep !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
        sep = buffer.search(/\r?\n\r?\n/);
        const data = event
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (data) handle(data);
      }
    }
    if (buffer.trim().startsWith('data:')) handle(buffer.trim().slice(5).trim()); // stream ended without a blank line

    if (!fullText) {
      const reason = blockReason ?? finishReason;
      if (reason && BLOCK_REASONS.has(reason)) {
        throw new Error(
          `Gemini blocked the response (${reason}). Reword the topic, or switch to another provider in the API keys dialog.`,
        );
      }
      throw new Error(`Gemini returned no text${reason ? ` (finish reason: ${reason})` : ''}.`);
    }
    if (finishReason === 'MAX_TOKENS') {
      // Same as the Anthropic path: hand back what we have; callers' JSON parsing will surface a truncated material.
      console.warn('Gemini stopped at the output token limit (MAX_TOKENS); the response may be truncated.');
    }

    callbacks.onDone?.(fullText);
    return fullText;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    callbacks.onError?.(err);
    throw err;
  }
}
