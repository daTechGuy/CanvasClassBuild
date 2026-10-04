import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamMessageGemini } from '../src/services/llm/gemini';
import type { StreamCallbacks, StreamOptions } from '../src/services/llm/types';

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
  signal?: AbortSignal | null;
}

/** Build an SSE response. `wire` is the exact byte segments as they arrive, so tests can split mid-event. */
function sseResponse(wire: string[], status = 200): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of wire) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

const event = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const textChunk = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, ...extra }],
});
const thoughtChunk = (text: string) => ({
  candidates: [{ content: { role: 'model', parts: [{ text, thought: true }] } }],
});
const errorResponse = (status: number, message: string, statusText: string) =>
  new Response(JSON.stringify({ error: { code: status, message, status: statusText } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function installFetch(handler: (call: Call, n: number) => Response): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers ?? {}),
      body: init?.body ? JSON.parse(init.body as string) : {},
      signal: init?.signal,
    };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const opts = (o: Partial<StreamOptions> = {}): StreamOptions => ({
  apiKey: 'AIza-test',
  model: 'gemini-3.8-flash',
  messages: [{ role: 'user', content: 'Hello' }],
  ...o,
});

describe('streamMessageGemini', () => {
  let restore: (() => void) | null = null;
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => {
    restore?.();
    restore = null;
    vi.restoreAllMocks();
  });

  describe('request contract', () => {
    it('POSTs to the streaming endpoint with the key in a header, never in the URL', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('hi'))]));
      restore = f.restore;
      await streamMessageGemini(opts({ model: 'gemini-3.8-flash' }), {});

      expect(f.calls).toHaveLength(1);
      const c = f.calls[0];
      expect(c.method).toBe('POST');
      expect(c.url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
      );
      expect(c.url).not.toContain('AIza-test');
      expect(c.headers.get('x-goog-api-key')).toBe('AIza-test');
      expect(c.headers.get('content-type')).toBe('application/json');
    });

    it('encodes odd model ids and maps system prompt + roles (assistant → model)', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('ok'))]));
      restore = f.restore;
      await streamMessageGemini(
        opts({
          model: 'models/x y',
          system: 'You are a course architect.',
          messages: [
            { role: 'user', content: 'Plan it' },
            { role: 'assistant', content: 'Draft one' },
            { role: 'user', content: 'Refine it' },
          ],
        }),
        {},
      );
      const body = f.calls[0].body as {
        systemInstruction: { parts: { text: string }[] };
        contents: { role: string; parts: { text: string }[] }[];
      };
      expect(f.calls[0].url).toContain('/models/models%2Fx%20y:streamGenerateContent');
      expect(body.systemInstruction.parts[0].text).toBe('You are a course architect.');
      expect(body.contents.map((c) => [c.role, c.parts[0].text])).toEqual([
        ['user', 'Plan it'],
        ['model', 'Draft one'],
        ['user', 'Refine it'],
      ]);
    });

    it('flattens content blocks to text and drops empty/tool-only messages', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('ok'))]));
      restore = f.restore;
      await streamMessageGemini(
        opts({
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'part A' }, { type: 'text', text: 'part B' }] },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'x', input: {} } as any] },
          ],
        }),
        {},
      );
      const contents = (f.calls[0].body as { contents: { parts: { text: string }[] }[] }).contents;
      expect(contents).toHaveLength(1);
      expect(contents[0].parts[0].text).toBe('part A\npart B');
    });

    it('omits systemInstruction when there is no system prompt', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('ok'))]));
      restore = f.restore;
      await streamMessageGemini(opts(), {});
      expect(f.calls[0].body).not.toHaveProperty('systemInstruction');
    });

    it('leaves headroom above maxTokens for thinking, capped at the 65,536 output ceiling', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('ok'))]));
      restore = f.restore;
      await streamMessageGemini(opts({ maxTokens: 4000 }), {});
      await streamMessageGemini(opts({ maxTokens: 4000, thinkingBudget: 'low' }), {});
      await streamMessageGemini(opts({ maxTokens: 60000, thinkingBudget: 'max' }), {});
      const max = f.calls.map((c) => (c.body.generationConfig as { maxOutputTokens: number }).maxOutputTokens);
      expect(max[0]).toBe(4000); // no thinking requested → exactly what the caller asked for
      expect(max[1]).toBeGreaterThan(4000);
      expect(max[2]).toBe(65536);
    });

    it('asks for thought summaries only when a thinking budget was requested', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('ok'))]));
      restore = f.restore;
      await streamMessageGemini(opts(), {});
      await streamMessageGemini(opts({ thinkingBudget: 'medium' }), {});
      const cfg = f.calls.map((c) => c.body.generationConfig as Record<string, unknown>);
      expect(cfg[0]).not.toHaveProperty('thinkingConfig');
      expect(cfg[1].thinkingConfig).toEqual({ includeThoughts: true });
    });

    it('passes the abort signal through to fetch', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('ok'))]));
      restore = f.restore;
      const ac = new AbortController();
      await streamMessageGemini(opts({ signal: ac.signal }), {});
      expect(f.calls[0].signal).toBe(ac.signal);
    });
  });

  describe('streaming', () => {
    it('streams text, routes thought summaries to onThinking, and returns the full text', async () => {
      const f = installFetch(() =>
        sseResponse([event(thoughtChunk('planning…')), event(textChunk('Hello ')), event(textChunk('world', { finishReason: 'STOP' }))]),
      );
      restore = f.restore;
      const cb: StreamCallbacks = { onText: vi.fn(), onThinking: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
      const out = await streamMessageGemini(opts({ thinkingBudget: 'high' }), cb);

      expect(out).toBe('Hello world');
      expect(cb.onThinking).toHaveBeenCalledWith('planning…');
      expect(cb.onText).toHaveBeenNthCalledWith(1, 'Hello ');
      expect(cb.onText).toHaveBeenNthCalledWith(2, 'world');
      expect(cb.onDone).toHaveBeenCalledWith('Hello world');
      expect(cb.onError).not.toHaveBeenCalled();
    });

    it('reassembles events split across arbitrary network chunks (mid-JSON, mid-delimiter)', async () => {
      const all = event(textChunk('abc')) + event(textChunk('def'));
      // Cut at awkward places: inside the JSON, and between the two newlines of the delimiter.
      const cuts = [7, 31, all.indexOf('\n\n') + 1, all.length - 3];
      const wire: string[] = [];
      let prev = 0;
      for (const c of [...cuts, all.length]) { wire.push(all.slice(prev, c)); prev = c; }
      const f = installFetch(() => sseResponse(wire));
      restore = f.restore;
      expect(await streamMessageGemini(opts(), {})).toBe('abcdef');
    });

    it('handles CRLF event delimiters', async () => {
      const crlf = (o: unknown) => `data: ${JSON.stringify(o)}\r\n\r\n`;
      const f = installFetch(() => sseResponse([crlf(textChunk('one ')), crlf(textChunk('two'))]));
      restore = f.restore;
      expect(await streamMessageGemini(opts(), {})).toBe('one two');
    });

    it('accepts a final event that arrives without a trailing blank line', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('a')), `data: ${JSON.stringify(textChunk('b'))}`]));
      restore = f.restore;
      expect(await streamMessageGemini(opts(), {})).toBe('ab');
    });

    it('ignores non-JSON keep-alives and parts with no text', async () => {
      const f = installFetch(() =>
        sseResponse([
          ': keep-alive\n\n',
          'data: not json\n\n',
          event({ candidates: [{ content: { parts: [{}] } }] }),
          event(textChunk('real')),
        ]),
      );
      restore = f.restore;
      expect(await streamMessageGemini(opts(), {})).toBe('real');
    });

    it('returns the partial text on MAX_TOKENS (like the Anthropic path) and warns', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('{"half":', { finishReason: 'MAX_TOKENS' }))]));
      restore = f.restore;
      expect(await streamMessageGemini(opts(), {})).toBe('{"half":');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('MAX_TOKENS'));
    });
  });

  describe('errors', () => {
    it('reports Google\'s error message with the HTTP code and status, and calls onError', async () => {
      const f = installFetch(() => errorResponse(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT'));
      restore = f.restore;
      const cb: StreamCallbacks = { onError: vi.fn() };
      await expect(streamMessageGemini(opts(), cb)).rejects.toThrow(
        'Gemini 400 INVALID_ARGUMENT: API key not valid. Please pass a valid API key.',
      );
      expect(cb.onError).toHaveBeenCalledOnce();
      expect(f.calls).toHaveLength(1); // an unrelated 400 is not retried
    });

    it('keeps "429" in the message so streamWithRetry\'s rate-limit backoff recognises it', async () => {
      const f = installFetch(() => errorResponse(429, 'Quota exceeded for this model.', 'RESOURCE_EXHAUSTED'));
      restore = f.restore;
      await expect(streamMessageGemini(opts(), {})).rejects.toThrow(/Gemini 429 RESOURCE_EXHAUSTED/);
    });

    it('attaches the HTTP status to the error so friendlyError can map it', async () => {
      const f = installFetch(() => errorResponse(404, 'models/nope is not found', 'NOT_FOUND'));
      restore = f.restore;
      const err = await streamMessageGemini(opts(), {}).catch((e) => e);
      expect((err as { status?: number }).status).toBe(404);
    });

    it('falls back to the raw body / status text when the error is not JSON', async () => {
      const f = installFetch(() => new Response('upstream exploded', { status: 502, statusText: 'Bad Gateway' }));
      restore = f.restore;
      await expect(streamMessageGemini(opts(), {})).rejects.toThrow('Gemini 502: upstream exploded');
    });

    it('retries once WITHOUT thought summaries when a 400 complains about thinking', async () => {
      const f = installFetch((call, n) =>
        n === 1
          ? errorResponse(400, 'Thinking config is not supported for this model.', 'INVALID_ARGUMENT')
          : sseResponse([event(textChunk('fine'))]),
      );
      restore = f.restore;
      const out = await streamMessageGemini(opts({ thinkingBudget: 'high' }), {});

      expect(out).toBe('fine');
      expect(f.calls).toHaveLength(2);
      expect((f.calls[0].body.generationConfig as Record<string, unknown>).thinkingConfig).toBeDefined();
      expect((f.calls[1].body.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
    });

    it('does not retry a thinking-flavoured 400 when no thinking was requested', async () => {
      const f = installFetch(() => errorResponse(400, 'thinking is odd', 'INVALID_ARGUMENT'));
      restore = f.restore;
      await expect(streamMessageGemini(opts(), {})).rejects.toThrow(/Gemini 400/);
      expect(f.calls).toHaveLength(1);
    });

    it('explains a blocked prompt instead of returning an empty string', async () => {
      const f = installFetch(() => sseResponse([event({ promptFeedback: { blockReason: 'SAFETY' } })]));
      restore = f.restore;
      await expect(streamMessageGemini(opts(), {})).rejects.toThrow(/blocked the response \(SAFETY\).*another provider/);
    });

    it('explains a response cut off by the safety filter mid-stream with no text', async () => {
      const f = installFetch(() => sseResponse([event({ candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] })]));
      restore = f.restore;
      await expect(streamMessageGemini(opts(), {})).rejects.toThrow(/blocked the response \(PROHIBITED_CONTENT\)/);
    });

    it('says so when the model returns nothing at all', async () => {
      const f = installFetch(() => sseResponse([event({ candidates: [{ finishReason: 'STOP' }] })]));
      restore = f.restore;
      await expect(streamMessageGemini(opts(), {})).rejects.toThrow('Gemini returned no text (finish reason: STOP).');
    });

    it('surfaces an error object delivered inside the stream', async () => {
      const f = installFetch(() =>
        sseResponse([event(textChunk('partial')), event({ error: { code: 503, status: 'UNAVAILABLE', message: 'overloaded' } })]),
      );
      restore = f.restore;
      await expect(streamMessageGemini(opts(), {})).rejects.toThrow('Gemini 503 UNAVAILABLE: overloaded');
    });

    it('fails fast, without calling the network, when the key or model is missing', async () => {
      const f = installFetch(() => sseResponse([event(textChunk('x'))]));
      restore = f.restore;
      const cb: StreamCallbacks = { onError: vi.fn() };
      await expect(streamMessageGemini(opts({ apiKey: '' }), cb)).rejects.toThrow(/key is missing/);
      await expect(streamMessageGemini(opts({ model: undefined }), cb)).rejects.toThrow(/requires a model name/);
      expect(f.calls).toHaveLength(0);
      expect(cb.onError).toHaveBeenCalledTimes(2);
    });

    it('rejects when there is nothing to send', async () => {
      const f = installFetch(() => sseResponse([]));
      restore = f.restore;
      await expect(streamMessageGemini(opts({ messages: [{ role: 'user', content: '' }] }), {})).rejects.toThrow(/no message content/);
      expect(f.calls).toHaveLength(0);
    });

    it('propagates an abort as the original error (callers treat it as a silent cancel)', async () => {
      const abort = new DOMException('The operation was aborted.', 'AbortError');
      const f = installFetch(() => { throw abort; });
      restore = f.restore;
      await expect(streamMessageGemini(opts(), {})).rejects.toBe(abort);
    });
  });
});
