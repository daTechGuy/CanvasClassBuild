import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockStreamMessage } = vi.hoisted(() => ({
  mockStreamMessage: vi.fn<(opts: unknown, cbs: unknown) => Promise<string>>(),
}));

vi.mock('../src/services/llm', () => ({
  streamMessage: mockStreamMessage,
  streamWithRetry: mockStreamMessage,
  sendMessage: vi.fn(),
}));

import { researchTavily } from '../src/services/research/tavily';
import type { RunResearchOptions } from '../src/services/research/types';

interface MockFetchCall {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

function installMockFetch(handler: (call: MockFetchCall) => unknown): {
  calls: MockFetchCall[];
  restore: () => void;
} {
  const calls: MockFetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers ?? {});
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const call: MockFetchCall = {
      url,
      method,
      authorization: headers.get('authorization'),
      body,
    };
    calls.push(call);
    const result = handler(call);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const baseOptions: RunResearchOptions = {
  chapterNumber: 5,
  chapterTitle: 'Bayesian Inference',
  chapterNarrative: 'How priors and likelihoods combine.',
  keyConcepts: ['posterior', 'prior'],
  llmApiKey: 'sk-test',
  claudeApiKey: 'sk-test',
  tavilyApiKey: 'tvly-test',
};

const synthesisResponse = JSON.stringify({
  sources: [
    {
      title: 'Bayes Rule explained',
      authors: '',
      year: '',
      url: 'https://example.com/bayes',
      summary: 'A primer.',
      relevance: 'Core.',
      isVerified: true,
    },
  ],
  synthesisNotes: 'A consolidated view.',
});

describe('researchTavily', () => {
  beforeEach(() => {
    mockStreamMessage.mockReset();
  });

  it('throws cleanly when the Tavily key is missing', async () => {
    await expect(
      researchTavily({ ...baseOptions, tavilyApiKey: undefined }, () => {}),
    ).rejects.toThrow(/Tavily API key is missing/i);
  });

  it('POSTs to tavily.com/search with the bearer token and expected body shape', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["bayes basics"]')
      .mockResolvedValueOnce(synthesisResponse);

    const fetchMock = installMockFetch(() => ({ results: [] }));

    try {
      await researchTavily(baseOptions, () => {});

      expect(fetchMock.calls).toHaveLength(1);
      const call = fetchMock.calls[0];
      expect(call.url).toBe('https://api.tavily.com/search');
      expect(call.method).toBe('POST');
      expect(call.authorization).toBe('Bearer tvly-test');
      expect(call.body).toMatchObject({
        query: 'bayes basics',
        max_results: 5,
        search_depth: 'basic',
        include_answer: false,
      });
    } finally {
      fetchMock.restore();
    }
  });

  it('aggregates results across queries and dedupes by URL', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["q1", "q2"]')
      .mockResolvedValueOnce(synthesisResponse);

    let i = 0;
    const fetchMock = installMockFetch(() => {
      const idx = i++;
      // q1 returns A + B, q2 returns A again (duplicate) + C
      if (idx === 0) {
        return {
          results: [
            { title: 'Article A', url: 'https://example.com/a', content: 'a-content' },
            { title: 'Article B', url: 'https://example.com/b', content: 'b-content' },
          ],
        };
      }
      return {
        results: [
          { title: 'Article A (dup)', url: 'https://example.com/a', content: 'a-dup' },
          { title: 'Article C', url: 'https://example.com/c', content: 'c-content' },
        ],
      };
    });

    try {
      const result = await researchTavily(baseOptions, () => {});
      // 4 hits but 3 unique URLs after dedup
      const urls = result.webResults.map((r) => r.url).sort();
      expect(urls).toEqual([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c',
      ]);
    } finally {
      fetchMock.restore();
    }
  });

  it('feeds Tavily content snippets into the synthesis user message', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["q"]')
      .mockResolvedValueOnce(synthesisResponse);

    const fetchMock = installMockFetch(() => ({
      results: [
        {
          title: 'Bayes Primer',
          url: 'https://example.com/bayes',
          content: 'SENTINEL_TAVILY_CONTENT_FOR_SYNTHESIS',
          published_date: '2024-01-15',
        },
      ],
    }));

    try {
      await researchTavily(baseOptions, () => {});

      // Second LLM call is synthesis; its user message should contain the
      // Tavily content snippet (or its first 600 chars, per llmHelpers).
      const synthesisCall = mockStreamMessage.mock.calls[1][0] as {
        messages: Array<{ content: string }>;
      };
      expect(synthesisCall.messages[0].content).toContain(
        'SENTINEL_TAVILY_CONTENT_FOR_SYNTHESIS',
      );
    } finally {
      fetchMock.restore();
    }
  });

  it('drops hits with empty/missing URLs (Tavily occasionally returns these)', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["q"]')
      .mockResolvedValueOnce(synthesisResponse);

    const fetchMock = installMockFetch(() => ({
      results: [
        { title: 'Has URL', url: 'https://example.com/has-url' },
        { title: 'No URL', url: '' },
        { title: 'Also missing URL' } as { title: string; url?: string },
      ],
    }));

    try {
      const result = await researchTavily(baseOptions, () => {});
      expect(result.webResults).toHaveLength(1);
      expect(result.webResults[0].url).toBe('https://example.com/has-url');
    } finally {
      fetchMock.restore();
    }
  });

  it('keeps going after a per-query Tavily failure', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["good", "bad", "alsoGood"]')
      .mockResolvedValueOnce(synthesisResponse);

    let i = 0;
    const fetchMock = installMockFetch(() => {
      const idx = i++;
      if (idx === 1) {
        return new Response('Tavily down', { status: 503 });
      }
      return {
        results: [
          {
            title: `Hit ${idx}`,
            url: `https://example.com/hit-${idx}`,
          },
        ],
      };
    });

    try {
      const result = await researchTavily(baseOptions, () => {});
      expect(fetchMock.calls).toHaveLength(3);
      // The 503 contributes 0 results; the other two contribute 1 each.
      expect(result.webResults).toHaveLength(2);
    } finally {
      fetchMock.restore();
    }
  });

  it('streams progress phases in order (thinking → searching → compiling)', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["q"]')
      .mockResolvedValueOnce(synthesisResponse);
    const fetchMock = installMockFetch(() => ({
      results: [{ title: 't', url: 'https://example.com/t' }],
    }));

    try {
      const phases: string[] = [];
      await researchTavily(baseOptions, (u) => {
        if (u.phase) phases.push(u.phase);
      });
      expect(phases).toContain('thinking');
      expect(phases).toContain('searching');
      expect(phases).toContain('compiling');
      const order = ['thinking', 'searching', 'compiling'];
      const indices = order.map((p) => phases.indexOf(p));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    } finally {
      fetchMock.restore();
    }
  });

  it('preserves published_date on results as pageAge', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["q"]')
      .mockResolvedValueOnce(synthesisResponse);
    const fetchMock = installMockFetch(() => ({
      results: [
        {
          title: 'Dated',
          url: 'https://example.com/dated',
          published_date: '2024-06-01',
        },
      ],
    }));

    try {
      const result = await researchTavily(baseOptions, () => {});
      expect(result.webResults[0].pageAge).toBe('2024-06-01');
    } finally {
      fetchMock.restore();
    }
  });
});
