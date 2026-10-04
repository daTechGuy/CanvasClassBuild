import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  normalizeDoi,
  fetchCrossrefWork,
  searchPapers,
  getPaperByDoi,
  findOpenAccess,
  normalizeTitle,
  titlesMatch,
  enrichDossier,
} from '../src/services/academic';
import type { ResearchDossier, ResearchSource } from '../src/types/course';

describe('Academic Services', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('normalizeDoi', () => {
    it('preserves clean DOI strings', () => {
      expect(normalizeDoi('10.1037/0003-066x.59.1.29')).toBe(
        '10.1037/0003-066x.59.1.29',
      );
    });

    it('strips https://doi.org/ and http://doi.org/ prefixes', () => {
      expect(normalizeDoi('https://doi.org/10.1000/182')).toBe('10.1000/182');
      expect(normalizeDoi('http://doi.org/10.1000/182')).toBe('10.1000/182');
    });

    it('strips dx.doi.org prefixes', () => {
      expect(normalizeDoi('https://dx.doi.org/10.1145/3318464.3389700')).toBe(
        '10.1145/3318464.3389700',
      );
      expect(normalizeDoi('http://dx.doi.org/10.1145/3318464.3389700')).toBe(
        '10.1145/3318464.3389700',
      );
    });

    it('strips "doi:" prefix case-insensitively', () => {
      expect(normalizeDoi('doi: 10.1016/j.cell.2020.08.001')).toBe(
        '10.1016/j.cell.2020.08.001',
      );
      expect(normalizeDoi('DOI:10.1016/j.cell.2020.08.001')).toBe(
        '10.1016/j.cell.2020.08.001',
      );
    });

    it('trims whitespace and trailing punctuation', () => {
      expect(normalizeDoi('   10.1000/182.,;  ')).toBe('10.1000/182');
    });
  });

  describe('fetchCrossrefWork', () => {
    it('returns null immediately if DOI has no slash or is invalid', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      expect(await fetchCrossrefWork('invalid-doi')).toBeNull();
      expect(await fetchCrossrefWork('')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches and parses work with a single author', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            DOI: '10.1000/182',
            title: ['Understanding Digital Identifiers'],
            author: [{ family: 'Smith', given: 'John' }],
            issued: { 'date-parts': [[2021, 5, 12]] },
            'container-title': ['Journal of Digital Libraries'],
            URL: 'https://doi.org/10.1000/182',
          },
        }),
      });

      const result = await fetchCrossrefWork('10.1000/182');
      expect(result).toEqual({
        doi: '10.1000/182',
        title: 'Understanding Digital Identifiers',
        authors: 'Smith, J.',
        year: '2021',
        container: 'Journal of Digital Libraries',
        url: 'https://doi.org/10.1000/182',
      });
    });

    it('formats two authors with ampersand', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            title: ['Deep Learning Concepts'],
            author: [
              { family: 'Bengio', given: 'Yoshua' },
              { family: 'Goodfellow', given: 'Ian' },
            ],
            issued: { 'date-parts': [[2016]] },
          },
        }),
      });

      const result = await fetchCrossrefWork('10.1000/dl');
      expect(result?.authors).toBe('Bengio, Y. & Goodfellow, I.');
      expect(result?.year).toBe('2016');
      expect(result?.doi).toBe('10.1000/dl');
    });

    it('formats 3+ authors with "et al." and supports literal author names', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            title: ['Attention Is All You Need'],
            author: [
              { family: 'Vaswani', given: 'Ashish' },
              { family: 'Shazeer', given: 'Noam' },
              { literal: 'Google Brain Team' },
            ],
          },
        }),
      });

      const result = await fetchCrossrefWork('10.1000/attention');
      expect(result?.authors).toBe('Vaswani, A. et al.');
    });

    it('handles author with literal name only', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            title: ['WHO Health Report'],
            author: [{ literal: 'World Health Organization' }],
          },
        }),
      });

      const result = await fetchCrossrefWork('10.1000/who');
      expect(result?.authors).toBe('World Health Organization');
    });

    it('returns null on 404 or network failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      expect(await fetchCrossrefWork('10.1000/not-found')).toBeNull();

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      expect(await fetchCrossrefWork('10.1000/network-err')).toBeNull();
    });
  });

  describe('Semantic Scholar service', () => {
    it('searchPapers returns array of papers on successful search', async () => {
      const mockPapers = [
        {
          paperId: 'p1',
          title: 'Attention Is All You Need',
          authors: [{ name: 'Ashish Vaswani' }],
          year: 2017,
          externalIds: { DOI: '10.5555/3295222.3295349' },
          openAccessPdf: { url: 'https://arxiv.org/pdf/1706.03762.pdf' },
        },
      ];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockPapers }),
      });

      const results = await searchPapers('Attention Is All You Need', 3);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Attention Is All You Need');
      expect(results[0].externalIds?.DOI).toBe('10.5555/3295222.3295349');
    });

    it('searchPapers returns empty array on error or non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      expect(await searchPapers('test')).toEqual([]);

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Fetch timeout'));
      expect(await searchPapers('test')).toEqual([]);
    });

    it('getPaperByDoi returns paper object when found', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          paperId: 'p1',
          title: 'Deep Learning',
          year: 2015,
        }),
      });

      const paper = await getPaperByDoi('10.1038/nature14539');
      expect(paper?.title).toBe('Deep Learning');
      expect(paper?.year).toBe(2015);
    });

    it('getPaperByDoi returns null on 404 or failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      expect(await getPaperByDoi('10.1000/unknown')).toBeNull();

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network err'));
      expect(await getPaperByDoi('10.1000/fail')).toBeNull();
    });
  });

  describe('findOpenAccess (Unpaywall)', () => {
    it('returns null if DOI has no slash', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      expect(await findOpenAccess('nodoi')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns Open Access info with PDF URL if available', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          is_oa: true,
          best_oa_location: {
            url_for_pdf: 'https://example.com/paper.pdf',
            url: 'https://example.com/paper.html',
          },
        }),
      });

      const res = await findOpenAccess('10.1000/182');
      expect(res).toEqual({
        doi: '10.1000/182',
        isOa: true,
        bestOaUrl: 'https://example.com/paper.pdf',
      });
    });

    it('falls back to landing page url if url_for_pdf is null', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          is_oa: true,
          best_oa_location: {
            url: 'https://example.com/paper.html',
          },
        }),
      });

      const res = await findOpenAccess('10.1000/182');
      expect(res?.bestOaUrl).toBe('https://example.com/paper.html');
    });

    it('returns null on failure or error response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      expect(await findOpenAccess('10.1000/182')).toBeNull();

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      expect(await findOpenAccess('10.1000/182')).toBeNull();
    });
  });

  describe('normalizeTitle & titlesMatch', () => {
    it('normalizes titles by stripping punctuation and lowercasing', () => {
      expect(normalizeTitle('Deep Residual Learning for Image Recognition!'))
        .toBe('deep residual learning for image recognition');
      expect(normalizeTitle('  A   Fast-Paced    Overview: Part 1...  '))
        .toBe('a fast paced overview part 1');
    });

    it('matches exact and punctuation/case-equivalent titles', () => {
      expect(titlesMatch('Machine Learning: A Review', 'machine learning a review')).toBe(true);
      expect(titlesMatch('', 'Something')).toBe(false);
      expect(titlesMatch('Something', '')).toBe(false);
    });

    it('matches long substring variants (length >= 20)', () => {
      const full = 'Convolutional Neural Networks for Sentence Classification: A Comprehensive Survey';
      const short = 'Convolutional Neural Networks for Sentence Classification';
      expect(titlesMatch(full, short)).toBe(true);
      expect(titlesMatch(short, full)).toBe(true);
    });

    it('matches based on token overlap (Jaccard similarity >= 0.6)', () => {
      const a = 'Effective Approaches to Attention-based Neural Machine Translation';
      const b = 'Approaches to Attention-based Neural Machine Translation Systems';
      expect(titlesMatch(a, b)).toBe(true);
    });

    it('rejects distinct titles', () => {
      const a = 'Introduction to Quantum Computing';
      const b = 'Advanced Topics in Polymer Chemistry';
      expect(titlesMatch(a, b)).toBe(false);
    });
  });

  describe('enrichDossier', () => {
    const baseSource: ResearchSource = {
      title: 'Attention Is All You Need',
      authors: 'A. Vaswani',
      year: '2017',
      summary: 'Transformer architecture introduction.',
      relevance: 'Foundational model for NLP.',
      isVerified: false,
    };

    const emptyDossier: ResearchDossier = {
      chapterNumber: 1,
      sources: [],
      synthesisNotes: 'No sources yet.',
    };

    it('handles empty sources cleanly without network calls', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      const result = await enrichDossier(emptyDossier);
      expect(result.dossier.sources).toEqual([]);
      expect(result.stats).toEqual({
        total: 0,
        doiVerified: 0,
        doiResolved: 0,
        oaFound: 0,
        unverified: 0,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('Path A: verifies source with valid DOI and updates open access', async () => {
      const sourceWithDoi: ResearchSource = {
        ...baseSource,
        doi: '10.5555/3295222.3295349',
      };
      const dossier: ResearchDossier = {
        chapterNumber: 1,
        sources: [sourceWithDoi],
        synthesisNotes: 'Testing Path A',
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('api.crossref.org')) {
          return new Response(
            JSON.stringify({
              message: {
                DOI: '10.5555/3295222.3295349',
                title: ['Attention Is All You Need'],
                author: [{ family: 'Vaswani', given: 'Ashish' }],
                issued: { 'date-parts': [[2017]] },
                URL: 'https://doi.org/10.5555/3295222.3295349',
              },
            }),
            { status: 200 },
          );
        }
        if (u.includes('api.unpaywall.org')) {
          return new Response(
            JSON.stringify({
              is_oa: true,
              best_oa_location: {
                url_for_pdf: 'https://arxiv.org/pdf/1706.03762.pdf',
              },
            }),
            { status: 200 },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const onProgress = vi.fn();
      const result = await enrichDossier(dossier, { onProgress });

      expect(onProgress).toHaveBeenCalledWith(1, 1);
      expect(result.stats.total).toBe(1);
      expect(result.stats.doiVerified).toBe(1);
      expect(result.stats.oaFound).toBe(1);
      expect(result.stats.unverified).toBe(0);

      const enrichedSource = result.dossier.sources[0];
      expect(enrichedSource.isVerified).toBe(true);
      expect(enrichedSource.doi).toBe('10.5555/3295222.3295349');
      expect(enrichedSource.authors).toBe('Vaswani, A.');
      expect(enrichedSource.url).toBe('https://arxiv.org/pdf/1706.03762.pdf');
    });

    it('Path A Hallucinated DOI: strips DOI if Crossref title does not match', async () => {
      const sourceWithHallucinatedDoi: ResearchSource = {
        ...baseSource,
        title: 'Deep Learning with Convolutional Networks',
        doi: '10.1000/wrong-paper',
      };
      const dossier: ResearchDossier = {
        chapterNumber: 1,
        sources: [sourceWithHallucinatedDoi],
        synthesisNotes: 'Testing Hallucinated DOI',
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('api.crossref.org')) {
          return new Response(
            JSON.stringify({
              message: {
                DOI: '10.1000/wrong-paper',
                title: ['Modern Architectural History in France'],
                author: [{ family: 'Dupont', given: 'Pierre' }],
                issued: { 'date-parts': [[2010]] },
              },
            }),
            { status: 200 },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const result = await enrichDossier(dossier);
      expect(result.stats.unverified).toBe(1);
      expect(result.stats.doiVerified).toBe(0);

      const source = result.dossier.sources[0];
      expect(source.doi).toBeUndefined();
      expect(source.isVerified).toBe(false);
      expect(source.title).toBe('Deep Learning with Convolutional Networks');
    });

    it('Path B: resolves DOI via Semantic Scholar search when source has no DOI', async () => {
      const sourceNoDoi: ResearchSource = {
        ...baseSource,
        doi: undefined,
      };
      const dossier: ResearchDossier = {
        chapterNumber: 1,
        sources: [sourceNoDoi],
        synthesisNotes: 'Testing Path B',
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('api.semanticscholar.org')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  paperId: 'ss1',
                  title: 'Attention Is All You Need',
                  authors: [{ name: 'Ashish Vaswani' }, { name: 'Noam Shazeer' }],
                  year: 2017,
                  externalIds: { DOI: '10.5555/3295222.3295349' },
                  openAccessPdf: { url: 'https://arxiv.org/pdf/1706.03762.pdf' },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (u.includes('api.unpaywall.org')) {
          return new Response(
            JSON.stringify({
              is_oa: true,
              best_oa_location: {
                url_for_pdf: 'https://arxiv.org/pdf/1706.03762.pdf',
              },
            }),
            { status: 200 },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const result = await enrichDossier(dossier);
      expect(result.stats.doiResolved).toBe(1);
      expect(result.stats.oaFound).toBe(1);
      expect(result.stats.unverified).toBe(0);

      const enriched = result.dossier.sources[0];
      expect(enriched.isVerified).toBe(true);
      expect(enriched.doi).toBe('10.5555/3295222.3295349');
      expect(enriched.authors).toBe('Ashish Vaswani, Noam Shazeer');
      expect(enriched.url).toBe('https://arxiv.org/pdf/1706.03762.pdf');
    });

    it('Path B: accepts Semantic Scholar paper without DOI', async () => {
      const sourceNoDoi: ResearchSource = {
        ...baseSource,
        title: 'An Obscure Technical Whitepaper',
        doi: undefined,
      };
      const dossier: ResearchDossier = {
        chapterNumber: 1,
        sources: [sourceNoDoi],
        synthesisNotes: 'Testing Path B without DOI',
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('api.semanticscholar.org')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  paperId: 'ss2',
                  title: 'An Obscure Technical Whitepaper',
                  authors: [{ name: 'Researcher Alpha' }],
                  year: 2022,
                  externalIds: {},
                  openAccessPdf: { url: 'https://example.com/preprint.pdf' },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const result = await enrichDossier(dossier);
      expect(result.stats.doiResolved).toBe(1);
      expect(result.stats.doiVerified).toBe(0);

      const enriched = result.dossier.sources[0];
      expect(enriched.isVerified).toBe(true);
      expect(enriched.doi).toBeUndefined();
      expect(enriched.url).toBe('https://example.com/preprint.pdf');
    });

    it('gracefully degrades to unverified when search finds no match', async () => {
      const unknownSource: ResearchSource = {
        ...baseSource,
        title: 'Completely Nonexistent Paper XYZ 12345',
        doi: undefined,
      };
      const dossier: ResearchDossier = {
        chapterNumber: 1,
        sources: [unknownSource],
        synthesisNotes: 'Testing degraded path',
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('api.semanticscholar.org')) {
          return new Response(
            JSON.stringify({ data: [] }),
            { status: 200 },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const result = await enrichDossier(dossier);
      expect(result.stats.unverified).toBe(1);
      expect(result.dossier.sources[0].isVerified).toBe(false);
      expect(result.dossier.sources[0].title).toBe('Completely Nonexistent Paper XYZ 12345');
    });

    it('handles network failure during enrichment gracefully', async () => {
      const source: ResearchSource = {
        ...baseSource,
        doi: '10.1000/boom',
      };
      const dossier: ResearchDossier = {
        chapterNumber: 1,
        sources: [source],
        synthesisNotes: 'Testing network failure',
      };

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));

      const result = await enrichDossier(dossier);
      expect(result.stats.unverified).toBe(1);
      expect(result.dossier.sources[0].isVerified).toBe(false);
    });

    it('processes multiple sources concurrently and tracks progress', async () => {
      const sources: ResearchSource[] = Array.from({ length: 5 }, (_, i) => ({
        ...baseSource,
        title: `Research Study Number ${i + 1}`,
      }));
      const dossier: ResearchDossier = {
        chapterNumber: 1,
        sources,
        synthesisNotes: 'Batch processing',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const progressSteps: Array<[number, number]> = [];
      const result = await enrichDossier(dossier, {
        concurrency: 2,
        onProgress: (done, total) => progressSteps.push([done, total]),
      });

      expect(result.stats.total).toBe(5);
      expect(result.stats.unverified).toBe(5);
      expect(progressSteps).toHaveLength(5);
      expect(progressSteps[progressSteps.length - 1]).toEqual([5, 5]);
    });
  });
});
