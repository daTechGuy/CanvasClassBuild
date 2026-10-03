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

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Not well-formed XML: ${xml.slice(0, 120)}`);
  }
  return doc;
}

/** All elements by local name (namespace-agnostic). */
function all(doc: Document | Element, name: string): Element[] {
  return Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === name);
}

function text(el: Element | undefined | null, name: string): string {
  return (el ? all(el, name)[0]?.textContent : '') ?? '';
}

async function buildFull() {
  const chapter = makeChapter({
    practiceQuizData: practiceQuizMd,
    inClassQuizData: inClassQuiz,
    weeklyChallengeData: weeklyChallenge,
    discussionData: [
      { hook: 'Hot take', prompt: 'Are viruses alive?' },
      { hook: 'Big picture', prompt: 'What is life?' },
    ],
  });
  const blob = await assembleImscc(makeSyllabus(), [chapter]);
  const zip = await unzipBlob(blob);
  const manifest = parseXml(await readText(zip, 'imsmanifest.xml'));
  const resources = new Map(all(manifest, 'resource').map((r) => [r.getAttribute('identifier')!, r]));
  const modules = parseXml(await readText(zip, 'course_settings/module_meta.xml'));
  return { zip, manifest, resources, modules };
}

describe('assembleImscc (native Canvas export)', () => {
  it('writes a CC 1.1 manifest plus the native course_settings files', async () => {
    const blob = await assembleImscc(makeSyllabus(), [makeChapter()]);
    const zip = await unzipBlob(blob);

    const manifest = await readText(zip, 'imsmanifest.xml');
    expect(manifest).toContain('imsccv1p1');
    expect(manifest).toContain('<schemaversion>1.1.0</schemaversion>');

    for (const f of [
      'course_settings/course_settings.xml',
      'course_settings/module_meta.xml',
      'course_settings/assignment_groups.xml',
      'course_settings/files_meta.xml',
      'course_settings/syllabus.html',
      'course_settings/canvas_export.txt',
    ]) {
      expect(zip.file(f), f).toBeTruthy();
    }

    const settings = parseXml(await readText(zip, 'course_settings/course_settings.xml'));
    expect(text(settings.documentElement, 'title')).toBe('Test Course');
    expect(text(settings.documentElement, 'default_view')).toBe('modules');
  });

  it('puts the overview and a chapter outline in the syllabus, tagged intendeduse=syllabus', async () => {
    const { zip, resources } = await buildFull();

    const syllabus = await readText(zip, 'course_settings/syllabus.html');
    expect(syllabus).toContain('A test course for the exporter unit tests.');
    expect(syllabus).toContain('Chapter One');
    const tagged = [...resources.values()].find((r) => r.getAttribute('intendeduse') === 'syllabus');
    expect(tagged?.getAttribute('href')).toBe('course_settings/syllabus.html');
  });

  it('emits the reading as a native Canvas Page (no scripts/styles) plus the interactive original as a file', async () => {
    const chapter = makeChapter({
      htmlContent:
        '<html><head><style>body{color:red}</style><script>alert(1)</script></head><body><h1>Reading body</h1><script>x()</script></body></html>',
    });
    const zip = await unzipBlob(await assembleImscc(makeSyllabus(), [chapter]));

    const page = await readText(zip, 'wiki_content/chapter-1-chapter-one-reading.html');
    expect(page).toContain('Reading body');
    expect(page).not.toMatch(/<script|<style/i);
    expect(page).toContain('<meta name="workflow_state" content="active"/>');
    expect(page).toMatch(/<meta name="identifier" content="g[0-9a-f]{32}"\/>/);

    // Full-fidelity original is kept for download.
    const original = await readText(zip, 'web_resources/chapter-1-chapter-one/reading-interactive.html');
    expect(original).toContain('alert(1)');
  });

  it('builds one quiz per source with both QTI flavours and the right graded/practice type', async () => {
    const { zip, resources, modules } = await buildFull();

    const quizItems = all(modules, 'item').filter((i) => text(i, 'content_type') === 'Quizzes::Quiz');
    expect(quizItems.map((i) => text(i, 'title'))).toEqual([
      'Chapter One — Practice Quiz',
      'Chapter One — In-Class Quiz',
      'Week 1 Challenge — Chapter One',
    ]);

    const kinds: string[] = [];
    for (const item of quizItems) {
      const quizId = text(item, 'identifierref');
      const res = resources.get(quizId)!;
      expect(res.getAttribute('type')).toBe('imsqti_xmlv1p2/imscc_xmlv1p1/assessment');
      const metaResId = all(res, 'dependency')[0].getAttribute('identifierref')!;
      const metaRes = resources.get(metaResId)!;
      const metaHref = metaRes.getAttribute('href')!;
      expect(metaHref).toBe(`${quizId}/assessment_meta.xml`);
      // The meta resource carries Canvas's native QTI too.
      expect(all(metaRes, 'file').map((f) => f.getAttribute('href'))).toContain(
        `non_cc_assessments/${quizId}.xml.qti`,
      );
      expect(zip.file(`${quizId}/assessment_qti.xml`)).toBeTruthy();
      expect(zip.file(`non_cc_assessments/${quizId}.xml.qti`)).toBeTruthy();

      const meta = parseXml(await readText(zip, metaHref));
      kinds.push(text(meta.documentElement, 'quiz_type'));
      expect(text(meta.documentElement, 'available')).toBe('true');
    }
    expect(kinds).toEqual(['practice_quiz', 'assignment', 'assignment']);
  });

  it('graded quizzes carry an assignment in the Assignments group; the practice quiz does not', async () => {
    const { zip, resources, modules } = await buildFull();
    const groups = parseXml(await readText(zip, 'course_settings/assignment_groups.xml'));
    const groupId = all(groups, 'assignmentGroup')[0].getAttribute('identifier');
    expect(text(all(groups, 'assignmentGroup')[0], 'title')).toBe('Assignments');

    const metas: Document[] = [];
    for (const item of all(modules, 'item').filter((i) => text(i, 'content_type') === 'Quizzes::Quiz')) {
      const quizId = text(item, 'identifierref');
      metas.push(parseXml(await readText(zip, `${quizId}/assessment_meta.xml`)));
      void resources;
    }
    const [practice, inClass, challenge] = metas;
    expect(all(practice, 'assignment')).toHaveLength(0);
    for (const m of [inClass, challenge]) {
      const a = all(m, 'assignment')[0];
      expect(a).toBeTruthy();
      expect(text(a, 'workflow_state')).toBe('published');
      expect(text(a, 'submission_types')).toBe('online_quiz');
      expect(text(a, 'assignment_group_identifierref')).toBe(groupId);
    }
  });

  it('wires correct answers, Canvas question metadata, and drops non-MCQ challenge types', async () => {
    const { zip, modules } = await buildFull();
    const ids = all(modules, 'item')
      .filter((i) => text(i, 'content_type') === 'Quizzes::Quiz')
      .map((i) => text(i, 'identifierref'));
    const [practiceId, inClassId, challengeId] = ids;

    // Practice quiz: two MCQs parsed from markdown; first answer is correct.
    const nativePractice = parseXml(await readText(zip, `non_cc_assessments/${practiceId}.xml.qti`));
    const items = all(nativePractice, 'item');
    expect(items).toHaveLength(2);
    const labels = (el: Element) =>
      all(el, 'qtimetadatafield').map((f) => [text(f, 'fieldlabel'), text(f, 'fieldentry')]);
    const meta0 = Object.fromEntries(labels(items[0]));
    expect(meta0.question_type).toBe('multiple_choice_question');
    expect(meta0.points_possible).toBe('1.0');
    expect(meta0.original_answer_ids).toBe('1,2,3,4');
    expect(meta0.assessment_question_identifierref).toMatch(/^g[0-9a-f]{32}$/);
    // Correct answer ("The platypus") is label 1.
    expect(all(items[0], 'varequal')[0].textContent).toBe('1');
    expect(items[0].textContent).toContain('Which mammal lays eggs?');

    // The CC-profile twin points at the same questions the native file references.
    const cc = parseXml(await readText(zip, `${practiceId}/assessment_qti.xml`));
    expect(all(cc, 'item').map((i) => i.getAttribute('ident'))).toContain(
      meta0.assessment_question_identifierref,
    );

    // In-class: one question.
    expect(all(parseXml(await readText(zip, `non_cc_assessments/${inClassId}.xml.qti`)), 'item')).toHaveLength(1);
    // Challenge: 5 source questions, only mcq + two-stage convert.
    expect(all(parseXml(await readText(zip, `non_cc_assessments/${challengeId}.xml.qti`)), 'item')).toHaveLength(2);
  });

  it('emits published native discussions linked through a topic-meta resource', async () => {
    const { zip, resources, modules } = await buildFull();
    const topics = all(modules, 'item').filter((i) => text(i, 'content_type') === 'DiscussionTopic');
    expect(topics).toHaveLength(2);

    const topicId = text(topics[0], 'identifierref');
    const res = resources.get(topicId)!;
    expect(res.getAttribute('type')).toBe('imsdt_xmlv1p1');
    const topicXml = await readText(zip, `${topicId}.xml`);
    expect(topicXml).toContain('imsdt_v1p1');
    expect(topicXml).toContain('Hot take');
    expect(topicXml).toContain('Are viruses alive?');

    const metaId = all(res, 'dependency')[0].getAttribute('identifierref')!;
    const meta = parseXml(await readText(zip, `${metaId}.xml`));
    expect(text(meta.documentElement, 'topic_id')).toBe(topicId);
    expect(text(meta.documentElement, 'workflow_state')).toBe('active');
    expect(text(meta.documentElement, 'discussion_type')).toBe('threaded');
  });

  it('module_meta items mirror the manifest organization, in order, and resolve to resources', async () => {
    const { manifest, resources, modules } = await buildFull();

    const mods = all(modules, 'module');
    expect(mods).toHaveLength(1);
    expect(text(mods[0], 'title')).toBe('Chapter 1: Chapter One');
    expect(text(mods[0], 'workflow_state')).toBe('active');

    const metaItems = all(mods[0], 'item');
    expect(metaItems.map((i) => text(i, 'content_type'))).toEqual([
      'WikiPage',
      'Quizzes::Quiz',
      'Quizzes::Quiz',
      'Quizzes::Quiz',
      'DiscussionTopic',
      'DiscussionTopic',
      'Attachment', // teaching-resources.docx
      'Attachment', // interactive reading, download
    ]);
    expect(metaItems.map((i) => text(i, 'position'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);

    // Every module item resolves to a manifest resource…
    for (const i of metaItems) expect(resources.has(text(i, 'identifierref'))).toBe(true);

    // …and the manifest organization lists the same item identifiers.
    const org = all(manifest, 'organization')[0];
    const orgItemIds = all(org, 'item')
      .map((i) => i.getAttribute('identifier'))
      .filter((id): id is string => !!id && id !== 'LearningModules');
    for (const i of metaItems) expect(orgItemIds).toContain(i.getAttribute('identifier'));
  });

  it('is internally consistent: unique ids, every referenced file exists, deps resolve', async () => {
    const { zip, manifest, resources } = await buildFull();

    const allIds = [...all(manifest, 'resource'), ...all(manifest, 'item')]
      .map((e) => e.getAttribute('identifier'))
      .filter(Boolean);
    expect(new Set(allIds).size).toBe(allIds.length);

    for (const res of resources.values()) {
      for (const f of all(res, 'file')) expect(zip.file(f.getAttribute('href')!), f.getAttribute('href')!).toBeTruthy();
      const href = res.getAttribute('href');
      if (href) expect(zip.file(href), href).toBeTruthy();
      for (const d of all(res, 'dependency')) expect(resources.has(d.getAttribute('identifierref')!)).toBe(true);
    }
    // Every XML part is well-formed.
    for (const name of Object.keys(zip.files)) {
      if (/\.(xml|qti)$/.test(name)) parseXml(await readText(zip, name));
    }
  });

  it('is deterministic: exporting the same course twice yields identical identifiers', async () => {
    const chapter = makeChapter({ practiceQuizData: practiceQuizMd });
    const a = await readText(await unzipBlob(await assembleImscc(makeSyllabus(), [chapter])), 'imsmanifest.xml');
    const b = await readText(await unzipBlob(await assembleImscc(makeSyllabus(), [chapter])), 'imsmanifest.xml');
    expect(a).toBe(b);
  });

  it('escapes HTML in prompts and discussion text instead of injecting markup', async () => {
    const chapter = makeChapter({
      inClassQuizData: [
        {
          question: 'Is <b>bold</b> & "quoted" safe?',
          correctAnswer: 'Yes <i>indeed</i>',
          correctFeedback: 'Because <script>x</script>',
          distractors: [{ text: 'No', feedback: 'n' }],
        },
      ],
      discussionData: [{ hook: 'A&B', prompt: 'Use <em>care</em>' }],
    });
    const zip = await unzipBlob(await assembleImscc(makeSyllabus(), [chapter]));
    const quizPath = Object.keys(zip.files).find((n) => n.endsWith('.xml.qti'))!;
    const qti = parseXml(await readText(zip, quizPath));
    // The prompt is stored as escaped HTML text — decoded once by the XML parser.
    const prompt = all(qti, 'mattext')[0].textContent!;
    expect(prompt).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(prompt).not.toContain('<b>');

    const topicNames = Object.keys(zip.files).filter((n) => /^g[0-9a-f]{32}\.xml$/.test(n));
    const topicXml = (await Promise.all(topicNames.map((n) => readText(zip, n)))).find((x) => x.includes('<topic '))!;
    expect(topicXml).toContain('&amp;lt;em&amp;gt;care');
  });

  it('adds a Course resources module for the curriculum matrix', async () => {
    const zip = await unzipBlob(
      await assembleImscc(makeSyllabus(), [makeChapter()], { curriculumCsv: 'a,b\n1,2\n' }),
    );
    expect(await readText(zip, 'web_resources/course/curriculum-alignment-matrix.csv')).toContain('a,b');
    const modules = parseXml(await readText(zip, 'course_settings/module_meta.xml'));
    expect(all(modules, 'module').map((m) => text(m, 'title'))).toEqual([
      'Chapter 1: Chapter One',
      'Course resources',
    ]);
    const files = await readText(zip, 'course_settings/files_meta.xml');
    expect(files).toContain('curriculum-alignment-matrix.csv');
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
