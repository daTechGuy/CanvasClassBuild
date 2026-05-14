import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mock for the LLM facade — controls both the query-generation call
// and the dossier-synthesis call. Each call to streamMessage consumes the
// next response in the queue.
const { mockStreamMessage } = vi.hoisted(() => ({
  mockStreamMessage: vi.fn<(opts: unknown, cbs: unknown) => Promise<string>>(),
}));

vi.mock('../src/services/llm', () => ({
  streamMessage: mockStreamMessage,
  streamWithRetry: mockStreamMessage,
  sendMessage: vi.fn(),
}));

import { researchWikipedia } from '../src/services/research/wikipedia';
import type { RunResearchOptions, ResearchProgress } from '../src/services/research/types';

interface MockFetchCall {
  url: string;
}

function installMockFetch(handler: (url: string) => unknown): {
  calls: MockFetchCall[];
  restore: () => void;
} {
  const calls: MockFetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url });
    const body = handler(url);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), {
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
  chapterNumber: 3,
  chapterTitle: 'Sampling Distributions',
  chapterNarrative: 'How sample statistics behave across repeated draws.',
  keyConcepts: ['central limit theorem', 'standard error'],
  llmApiKey: 'sk-test',
  claudeApiKey: 'sk-test',
};

const synthesisResponse = JSON.stringify({
  sources: [
    {
      title: 'Central Limit Theorem',
      authors: '',
      year: '',
      url: 'https://en.wikipedia.org/wiki/Central_limit_theorem',
      summary: 'A classical result.',
      relevance: 'Foundational.',
      isVerified: true,
    },
  ],
  synthesisNotes: 'These articles establish the textbook foundation.',
});

describe('researchWikipedia', () => {
  beforeEach(() => {
    mockStreamMessage.mockReset();
  });

  it('asks the LLM for queries, hits the Wikipedia API per query, then asks for synthesis', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["central limit theorem", "standard error"]')
      .mockResolvedValueOnce(synthesisResponse);

    const fetchMock = installMockFetch(() => ({
      query: {
        search: [
          {
            title: 'Central Limit Theorem',
            snippet: 'A <span class="searchmatch">classical</span> result in statistics.',
          },
          {
            title: 'Standard Error',
            snippet: 'The <span class="searchmatch">standard error</span> measures variability.',
          },
        ],
      },
    }));

    try {
      const progressUpdates: ResearchProgress[] = [];
      const result = await researchWikipedia(baseOptions, (u) => progressUpdates.push(u));

      // Three LLM calls expected: query gen + synthesis. (The Wikipedia
      // search itself goes through fetch, not the LLM.)
      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      // Two queries → two Wikipedia API calls
      expect(fetchMock.calls).toHaveLength(2);
      expect(fetchMock.calls[0].url).toContain('en.wikipedia.org/w/api.php');
      expect(fetchMock.calls[0].url).toContain('srsearch=central+limit+theorem');
      expect(fetchMock.calls[1].url).toContain('srsearch=standard+error');

      expect(result.dossier.sources).toHaveLength(1);
      expect(result.dossier.sources[0].title).toBe('Central Limit Theorem');
      expect(result.dossier.synthesisNotes).toContain('textbook foundation');
    } finally {
      fetchMock.restore();
    }
  });

  it('builds correct article URLs and dedupes across queries', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["q1", "q2"]')
      .mockResolvedValueOnce(synthesisResponse);

    // Both queries return the same article — should appear once.
    const fetchMock = installMockFetch(() => ({
      query: {
        search: [
          { title: 'Central Limit Theorem', snippet: 'plain snippet' },
        ],
      },
    }));

    try {
      const result = await researchWikipedia(baseOptions, () => {});
      // After dedup, webResults has 1 entry, not 2.
      expect(result.webResults).toHaveLength(1);
      expect(result.webResults[0].url).toBe(
        'https://en.wikipedia.org/wiki/Central_Limit_Theorem',
      );
      // Spaces in titles become underscores in the URL.
      expect(result.webResults[0].url).not.toContain(' ');
    } finally {
      fetchMock.restore();
    }
  });

  it('strips <span class="searchmatch"> wrappers from snippets passed to the synthesis prompt', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["a"]')
      .mockResolvedValueOnce(synthesisResponse);

    const fetchMock = installMockFetch(() => ({
      query: {
        search: [
          {
            title: 'Article',
            snippet: 'The <span class="searchmatch">central</span> point is <b>important</b>.',
          },
        ],
      },
    }));

    try {
      await researchWikipedia(baseOptions, () => {});

      // The second LLM call is the synthesis. Its user message should contain
      // the clean snippet without HTML tags.
      const synthesisCall = mockStreamMessage.mock.calls[1][0] as {
        messages: Array<{ content: string }>;
      };
      const userMessage = synthesisCall.messages[0].content;
      expect(userMessage).toContain('The central point is important.');
      expect(userMessage).not.toContain('<span');
      expect(userMessage).not.toContain('searchmatch');
    } finally {
      fetchMock.restore();
    }
  });

  it('keeps going after a per-query Wikipedia failure', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["good", "bad", "alsoGood"]')
      .mockResolvedValueOnce(synthesisResponse);

    let callIdx = 0;
    const fetchMock = installMockFetch(() => {
      const i = callIdx++;
      if (i === 1) {
        // Second query → 503
        return new Response('upstream error', { status: 503 });
      }
      return {
        query: {
          search: [{ title: i === 0 ? 'First Hit' : 'Third Hit' }],
        },
      };
    });

    try {
      const result = await researchWikipedia(baseOptions, () => {});
      expect(fetchMock.calls).toHaveLength(3);
      // Two successful queries → two unique hits; the failure shouldn't
      // short-circuit the loop.
      expect(result.webResults.map((r) => r.title).sort()).toEqual(['First Hit', 'Third Hit']);
    } finally {
      fetchMock.restore();
    }
  });

  it('streams progress phase transitions (thinking → searching → compiling)', async () => {
    mockStreamMessage
      .mockResolvedValueOnce('["q"]')
      .mockResolvedValueOnce(synthesisResponse);
    const fetchMock = installMockFetch(() => ({
      query: { search: [{ title: 'Foo' }] },
    }));

    try {
      const phases: string[] = [];
      await researchWikipedia(baseOptions, (u) => {
        if (u.phase) phases.push(u.phase);
      });

      expect(phases).toContain('thinking');
      expect(phases).toContain('searching');
      expect(phases).toContain('compiling');
      // Order matters: thinking comes before searching comes before compiling.
      const order = ['thinking', 'searching', 'compiling'];
      const indices = order.map((p) => phases.indexOf(p));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    } finally {
      fetchMock.restore();
    }
  });

  it('falls back to a generated query when the LLM returns nothing parseable', async () => {
    // First call (query gen) returns malformed text; the helper then falls
    // back to two synthesized queries based on chapter title + key concept.
    mockStreamMessage
      .mockResolvedValueOnce('not a json array')
      .mockResolvedValueOnce(synthesisResponse);

    const fetchMock = installMockFetch(() => ({
      query: { search: [{ title: 'Backup Article' }] },
    }));

    try {
      const result = await researchWikipedia(baseOptions, () => {});
      // Fallback emits 2 queries (academic review + seminal paper).
      expect(fetchMock.calls).toHaveLength(2);
      expect(result.webResults.length).toBeGreaterThan(0);
    } finally {
      fetchMock.restore();
    }
  });
});
