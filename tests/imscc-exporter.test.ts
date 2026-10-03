import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { assembleImscc } from '../src/services/export/imsccExporter';
import type {
  Syllabus,
  GeneratedChapter,
  InClassQuizQuestion,
  WeeklyChallengeData,
} from '../src/types/course';

function makeSyllabus(): Syllabus {
  return {
    courseTitle: 'Test Course',
    courseOverview: 'A test course for the exporter unit tests.',
    chapters: [
      {
        number: 1,
        title: 'Chapter One',
        narrative: '',
        keyConcepts: [],
        widgets: [],
        scienceAnnotations: [],
        spacingConnections: [],
      },
    ],
  };
}

function makeChapter(overrides: Partial<GeneratedChapter> = {}): GeneratedChapter {
  return {
    number: 1,
    title: 'Chapter One',
    htmlContent: '<html><body><h1>Reading body</h1></body></html>',
    ...overrides,
  };
}

const practiceQuizMd = `1. **Which mammal lays eggs?**
   a. The platypus
   b. The wolf
   c. The lion
   d. The dolphin
   **Answer**: The platypus
   **Feedback**: Platypuses are monotremes.

---

2. **Which planet is closest to the sun?**
   a. Mercury
   b. Venus
   c. Earth
   d. Mars
   **Answer**: Mercury
   **Feedback**: Mercury orbits within ~58M km of the sun.
`;

const inClassQuiz: InClassQuizQuestion[] = [
  {
    question: 'What is 2+2?',
    correctAnswer: '4',
    correctFeedback: 'Right.',
    distractors: [
      { text: '3', feedback: 'Off by one.' },
      { text: '5', feedback: 'Off by one.' },
      { text: '22', feedback: 'String concatenation, not addition.' },
    ],
  },
];

const weeklyChallenge: WeeklyChallengeData = {
  metadata: { chapterTitle: 'Chapter One', weekNumber: 1, estimatedMinutes: 10 },
  questions: [
    {
      type: 'mcq',
      tier: 'warmup',
      stem: 'Which programming language?',
      options: ['Python', 'Cobol', 'Fortran', 'Lisp'],
      correctIndex: 0,
      feedback: { correct: 'Yes.', incorrect: 'No.' },
      difficulty: 1,
    },
    {
      type: 'two-stage',
      tier: 'core',
      stem: 'Pick the right answer + reason.',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 1,
      justifications: ['r0', 'r1', 'r2', 'r3'],
      correctJustificationIndex: 1,
      feedback: { correct: 'Yes.', incorrect: 'No.' },
      difficulty: 2,
    },
    // These three shouldn't convert to QTI — only the MCQ + two-stage above
    // should make it into the assessment.
    {
      type: 'assertion-reason',
      tier: 'challenge',
      stem: 'Evaluate.',
      assertion: 'A',
      reason: 'B',
      correctRelationship: 'both-true-reason-explains',
      feedback: { correct: '.', incorrect: '.' },
      difficulty: 3,
    },
    {
      type: 'agreement-matrix',
      tier: 'challenge',
      stem: 'Classify.',
      statements: [{ text: 'x', correct: 'always' }],
      feedback: { correct: '.', incorrect: '.' },
      difficulty: 3,
    },
    {
      type: 'slider-estimation',
      tier: 'challenge',
      stem: 'Pick a number.',
      unit: 'kg',
      correctValue: 5,
      acceptableRange: [4, 6],
      sliderMin: 0,
      sliderMax: 10,
      feedback: { correct: '.', incorrect: '.' },
      difficulty: 3,
    },
  ],
};

async function unzipBlob(blob: Blob): Promise<JSZip> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return JSZip.loadAsync(buf);
}

async function readText(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`Missing file in cartridge: ${path}`);
  return f.async('string');
}

describe('assembleImscc', () => {
  it('produces a parseable ZIP with a CC 1.1 manifest and Canvas course_settings', async () => {
    const blob = await assembleImscc(makeSyllabus(), [makeChapter()]);
    const zip = await unzipBlob(blob);

    const manifest = await readText(zip, 'imsmanifest.xml');
    expect(manifest).toContain('imsccv1p1');
    expect(manifest).toContain('<schemaversion>1.1.0</schemaversion>');
    expect(manifest).toContain('Test Course');

    // Canvas-specific course_settings extension
    expect(zip.file('course_settings/course_settings.xml')).toBeTruthy();
    expect(zip.file('course_settings/syllabus.html')).toBeTruthy();
    expect(zip.file('course_settings/canvas_export.txt')).toBeTruthy();

    const courseSettings = await readText(zip, 'course_settings/course_settings.xml');
    expect(courseSettings).toMatch(/<title>Test Course<\/title>/);
  });

  it('emits the reading HTML as a webcontent resource', async () => {
    const blob = await assembleImscc(makeSyllabus(), [makeChapter()]);
    const zip = await unzipBlob(blob);

    const readingPath = 'chapter-1-chapter-one/reading.html';
    expect(zip.file(readingPath)).toBeTruthy();
    const reading = await readText(zip, readingPath);
    expect(reading).toContain('Reading body');
  });

  it('emits QTI 1.2 assessments for practice + in-class + weekly challenge with auto-publish sidecars', async () => {
    const chapter = makeChapter({
      practiceQuizData: practiceQuizMd,
      inClassQuizData: inClassQuiz,
      weeklyChallengeData: weeklyChallenge,
    });
    const blob = await assembleImscc(makeSyllabus(), [chapter]);
    const zip = await unzipBlob(blob);

    // Practice quiz: two MCQs from the markdown
    const practiceQti = await readText(zip, 'chapter-1-chapter-one/practice-quiz.xml');
    expect(practiceQti).toContain('questestinterop');
    expect(practiceQti.match(/<item /g)?.length).toBe(2);
    expect(practiceQti).toContain('Which mammal lays eggs?');

    // Practice quiz auto-publish sidecar
    const practiceMeta = await readText(zip, 'chapter-1-chapter-one/practice-quiz-meta.xml');
    expect(practiceMeta).toContain('canvas.instructure.com');
    expect(practiceMeta).toContain('<published>true</published>');
    expect(practiceMeta).toContain('<workflow_state>published</workflow_state>');

    // In-class: one MCQ
    const inClassQti = await readText(zip, 'chapter-1-chapter-one/in-class-quiz.xml');
    expect(inClassQti.match(/<item /g)?.length).toBe(1);
    expect(inClassQti).toContain('What is 2+2?');
    expect(zip.file('chapter-1-chapter-one/in-class-quiz-meta.xml')).toBeTruthy();

    // Weekly challenge: 5 source questions but only 2 (mcq + two-stage)
    // convert to QTI. Lossy types (assertion-reason, agreement-matrix,
    // slider-estimation) are dropped.
    const challengeQti = await readText(zip, 'chapter-1-chapter-one/weekly-challenge.xml');
    expect(challengeQti.match(/<item /g)?.length).toBe(2);
    expect(zip.file('chapter-1-chapter-one/weekly-challenge-meta.xml')).toBeTruthy();
  });

  it('emits native discussion topics with auto-publish sidecars', async () => {
    const chapter = makeChapter({
      discussionData: [
        { hook: 'Hot take', prompt: 'Are viruses alive?' },
        { hook: 'Big picture', prompt: 'What is life?' },
      ],
    });
    const blob = await assembleImscc(makeSyllabus(), [chapter]);
    const zip = await unzipBlob(blob);

    const disc1 = await readText(zip, 'chapter-1-chapter-one/discussions/disc-1.xml');
    expect(disc1).toContain('imsdt_v1p1');
    expect(disc1).toContain('Hot take');
    expect(disc1).toContain('Are viruses alive?');

    const meta1 = await readText(zip, 'chapter-1-chapter-one/discussions/disc-1-meta.xml');
    expect(meta1).toContain('canvas.instructure.com');
    expect(meta1).toContain('<published>true</published>');

    expect(zip.file('chapter-1-chapter-one/discussions/disc-2.xml')).toBeTruthy();
    expect(zip.file('chapter-1-chapter-one/discussions/disc-2-meta.xml')).toBeTruthy();
  });
});

describe('assembleImscc — slide decks', () => {
  afterEach(() => {
    vi.doUnmock('../src/services/export/pptxExporter');
    vi.resetModules();
  });

  const slides = [
    { title: 'A', speakerNotes: '', bullets: [], imagePrompt: 'prompt a' },
    { title: 'B', speakerNotes: '', bullets: [], imagePrompt: 'prompt b' },
  ];

  async function loadWithFakePptx() {
    const generatePptx = vi.fn(
      async (
        sl: unknown[],
        _c: string,
        _t: string,
        _theme: string | undefined,
        _key: string,
        opts: { onSlideRendered?: (i: number, uri: string) => void; onProgress?: (c: number, t: number, p: string) => void },
      ) => {
        // Pretend two images were rendered.
        sl.forEach((_, i) => opts.onSlideRendered?.(i, `data:image/png;base64,${i}`));
        opts.onProgress?.(sl.length, sl.length, 'packing');
        return { blob: new Blob(['PPTX']), renderedImages: {} };
      },
    );
    vi.doMock('../src/services/export/pptxExporter', () => ({ generatePptx }));
    const mod = await import('../src/services/export/imsccExporter');
    return { assembleImscc: mod.assembleImscc, generatePptx };
  }

  async function files(blob: Blob) {
    return Object.keys((await JSZip.loadAsync(await blob.arrayBuffer())).files);
  }

  it('omits slides.pptx and never calls the image API when slides are unrendered and no opt-in', async () => {
    const { assembleImscc, generatePptx } = await loadWithFakePptx();
    const blob = await assembleImscc(makeSyllabus(), [makeChapter({ slidesJson: slides })], {
      openaiApiKey: 'sk-test',
    });

    expect(generatePptx).not.toHaveBeenCalled();
    expect((await files(blob)).some((f) => f.endsWith('slides.pptx'))).toBe(false);
  });

  it('bundles the deck from cached images without re-rendering', async () => {
    const { assembleImscc, generatePptx } = await loadWithFakePptx();
    const rendered = slides.map((sl) => ({ ...sl, imageDataUri: 'data:image/png;base64,x' }));
    const blob = await assembleImscc(makeSyllabus(), [makeChapter({ slidesJson: rendered })], {
      openaiApiKey: 'sk-test',
    });

    expect(generatePptx).toHaveBeenCalledTimes(1);
    const opts = generatePptx.mock.calls[0][5] as { preRendered: Record<number, string> };
    expect(Object.keys(opts.preRendered)).toEqual(['0', '1']);
    expect((await files(blob)).some((f) => f.endsWith('slides.pptx'))).toBe(true);
  });

  it('renders and bundles missing decks only when renderMissingSlides is set, reporting progress', async () => {
    const { assembleImscc, generatePptx } = await loadWithFakePptx();
    const onSlideRendered = vi.fn();
    const onSlideProgress = vi.fn();
    const blob = await assembleImscc(makeSyllabus(), [makeChapter({ slidesJson: slides })], {
      openaiApiKey: 'sk-test',
      renderMissingSlides: true,
      onSlideRendered,
      onSlideProgress,
    });

    expect(generatePptx).toHaveBeenCalledTimes(1);
    expect(onSlideRendered).toHaveBeenCalledWith(1, 0, 'data:image/png;base64,0');
    expect(onSlideRendered).toHaveBeenCalledWith(1, 1, 'data:image/png;base64,1');
    expect(onSlideProgress).toHaveBeenCalledWith(1, 2, 2, 'packing');
    expect((await files(blob)).some((f) => f.endsWith('slides.pptx'))).toBe(true);
  });

  it('never renders without an OpenAI key, even when asked to', async () => {
    const { assembleImscc, generatePptx } = await loadWithFakePptx();
    await assembleImscc(makeSyllabus(), [makeChapter({ slidesJson: slides })], {
      renderMissingSlides: true,
    });

    expect(generatePptx).not.toHaveBeenCalled();
  });
});
