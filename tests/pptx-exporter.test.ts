import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { generatePptx } from '../src/services/export/pptxExporter';
import type { SlideData } from '../src/types/course';

// 1×1 transparent PNG — stands in for a rendered slide image.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function makeSlide(overrides: Partial<SlideData> & { title: string }): SlideData {
  return {
    bullets: [],
    speakerNotes: '',
    ...overrides,
  };
}

async function loadPptx(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generatePptx', () => {
  it('produces a non-empty .pptx blob (valid OOXML zip)', async () => {
    const { blob } = await generatePptx(
      [makeSlide({ title: 'Hello', bodyText: 'Sub' })],
      'Stats',
      'Ch 1',
      undefined,
      'sk-test',
    );
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    const zip = await loadPptx(blob);
    // OOXML packages have a `[Content_Types].xml` at the root.
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
  });

  it('writes one slide file per SlideData entry', async () => {
    const { blob } = await generatePptx(
      [
        makeSlide({ title: 'One' }),
        makeSlide({ title: 'Two', bullets: ['a', 'b'] }),
        makeSlide({ title: 'Three', bodyText: 'A thought' }),
      ],
      'Stats',
      'Ch 1',
      undefined,
      'sk-test',
    );
    const zip = await loadPptx(blob);
    const slideXmls = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slideXmls).toHaveLength(3);
  });

  it('uses pre-rendered images without calling the image API', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network must not be touched when every slide is pre-rendered');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const slides = [
      makeSlide({ title: 'A', imagePrompt: 'a prompt' }),
      makeSlide({ title: 'B', imagePrompt: 'b prompt' }),
    ];
    const { blob, renderedImages } = await generatePptx(
      slides,
      'Course',
      'Ch',
      undefined,
      'sk-test',
      { preRendered: { 0: PIXEL, 1: PIXEL } },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Object.keys(renderedImages)).toEqual(['0', '1']);
    const zip = await loadPptx(blob);
    const media = Object.keys(zip.files).filter((n) => n.startsWith('ppt/media/'));
    expect(media.length).toBeGreaterThan(0);
  });

  it('falls back to a text-only slide when a slide has no image', async () => {
    const { blob } = await generatePptx(
      [makeSlide({ title: 'Text only', bodyText: 'plain body copy' })],
      'Course',
      'Ch',
      undefined,
      'sk-test',
    );
    const zip = await loadPptx(blob);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('Text only');
    expect(slideXml).toContain('plain body copy');
  });

  it('attaches the speaker-notes text to the slide that supplied them', async () => {
    const { blob } = await generatePptx(
      [
        makeSlide({ title: 'With notes', speakerNotes: 'Say this aloud.' }),
        makeSlide({ title: 'Without notes' }),
      ],
      'Course',
      'Ch',
      undefined,
      'sk-test',
    );
    const zip = await loadPptx(blob);
    // pptxgenjs writes a notesSlide XML for every slide (it's part of the
    // OOXML spec), but the speaker text only appears in slides that opted in.
    const notes1 = (await zip.file('ppt/notesSlides/notesSlide1.xml')?.async('string')) ?? '';
    const notes2 = (await zip.file('ppt/notesSlides/notesSlide2.xml')?.async('string')) ?? '';
    expect(notes1).toContain('Say this aloud.');
    expect(notes2).not.toContain('Say this aloud.');
  });

  it('writes the course title and chapter title into the .pptx metadata', async () => {
    const { blob } = await generatePptx(
      [makeSlide({ title: 'A' })],
      'Stats 101',
      'The Replication Crisis',
      undefined,
      'sk-test',
    );
    const zip = await loadPptx(blob);
    const coreXml = await zip.file('docProps/core.xml')!.async('string');
    expect(coreXml).toContain('The Replication Crisis');
    expect(coreXml).toContain('Stats 101');
  });

  it('refuses to build an empty deck', async () => {
    await expect(generatePptx([], 'Course', 'Ch', undefined, 'sk-test')).rejects.toThrow(
      /zero slides/i,
    );
  });

  it('requires an OpenAI key (slides are rendered as images)', async () => {
    await expect(
      generatePptx([makeSlide({ title: 'A' })], 'Course', 'Ch', undefined, '  '),
    ).rejects.toThrow(/OpenAI API key/i);
  });
});
