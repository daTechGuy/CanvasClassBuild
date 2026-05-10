import type Anthropic from '@anthropic-ai/sdk';
import type { StreamCallbacks, StreamOptions } from './types';

// Same-origin proxy URL. ollama.com doesn't set CORS headers, so direct
// browser fetches are blocked. In dev: vite.config.ts forwards this to
// https://ollama.com/api/chat. In prod: api/ollama-proxy.ts (Vercel Edge
// function) does the same forwarding. One URL in both modes.
const OLLAMA_CLOUD_URL = '/api/ollama-proxy';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

interface OllamaChatChunk {
  model?: string;
  created_at?: string;
  message?: { role: string; content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
}

/**
 * Flatten Anthropic's content-block array into a plain string. Ollama's chat
 * API accepts only string content; tool-use and result blocks are dropped.
 */
function flattenContent(content: Anthropic.MessageParam['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = block as any;
      if (b.type === 'text' && typeof b.text === 'string') return b.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function toOllamaMessages(
  messages: Anthropic.MessageParam[],
  system?: string,
): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    out.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: flattenContent(m.content),
    });
  }
  return out;
}

export async function streamMessageOllama(
  options: StreamOptions,
  callbacks: StreamCallbacks,
): Promise<string> {
  const { apiKey, model, system, messages } = options;

  if (!model) {
    const err = new Error('Ollama provider requires a model name (e.g. gpt-oss:120b-cloud).');
    callbacks.onError?.(err);
    throw err;
  }
  if (!apiKey) {
    const err = new Error('Ollama API key is missing — paste it on the Setup page.');
    callbacks.onError?.(err);
    throw err;
  }

  let fullText = '';

  try {
    const res = await fetch(OLLAMA_CLOUD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: toOllamaMessages(messages, system),
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Ollama Cloud ${res.status}: ${detail || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // NDJSON: process complete lines, leave any partial line in the buffer.
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line) continue;

        let chunk: OllamaChatChunk;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }

        const thinking = chunk.message?.thinking;
        if (thinking) callbacks.onThinking?.(thinking);

        const text = chunk.message?.content;
        if (text) {
          fullText += text;
          callbacks.onText?.(text);
        }

        if (chunk.done) break;
      }
    }

    callbacks.onDone?.(fullText);
    return fullText;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    callbacks.onError?.(err);
    throw err;
  }
}
