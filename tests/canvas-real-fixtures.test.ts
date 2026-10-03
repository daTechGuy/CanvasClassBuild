import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { parseImsccTemplate } from '../src/services/template/parser';
import { assembleTemplateImscc } from '../src/services/template/templateImsccExporter';
import { validateImscc } from '../src/services/export/validateImscc';
import type { Syllabus, GeneratedChapter } from '../src/types/course';

/**
 * These run our template parser + exporter against a template that Canvas's OWN
 * exporter wrote (tests/fixtures/canvas-instructor-template.imscc), not against a
 * hand-built fixture. Hand-built fixtures encode our assumptions; this one encodes
 * Canvas's behaviour — e.g. discussion resources there have no `href`, and an
 * external link keeps its URL inline. Each assertion below was a real bug once.
 *
 * Template contents: "Instructor Information: Do not publish" (unpublished),
 * "Begin Here: Introductory Module" (page, sub-header, external link, page with an
 * **EDIT** marker, image), "Module 1: Example Topic" (real authored content) and
 * "Module 2: (Example to Edit)" (placeholders).
 */
const bytes = () => new Uint8Array(readFileSync('tests/fixtures/canvas-instructor-template.imscc'));

const syllabus: Syllabus = {
  courseTitle: 'Cell Biology (Template Test)',
  courseOverview: 'A short course on cells.',
  chapters: [1, 2, 3].map((n) => ({
    number: n,
    title: `Module ${n}: ${['The Cell', 'Genes', 'Proteins'][n - 1]}`,
    narrative: 'n',
    keyConcepts: ['c'],
    widgets: [],
    scienceAnnotations: [],
    spacingConnections: [],
  })),
};

const chapters = syllabus.chapters.map((c) => ({
  number: c.number,
  title: c.title,
  htmlContent: '',
  templateContent: {
    moduleOverviewHtml: `<h2>${c.title} overview</h2><p>What you will learn in module ${c.number}.</p>`,
    instructorNotes: [
      { title: `Pacing for ${c.title}`, htmlContent: `<p>Warm up for module ${c.number}.</p>` },
      { title: `Common misconceptions ${c.number}`, htmlContent: '<p>Students confuse X with Y.</p>' },
    ],
    discussion: { title: `Big question ${c.number}`, promptHtml: `<p>Discuss module ${c.number}.</p>` },
  },
})) as GeneratedChapter[];

async function exported() {
  const template = await parseImsccTemplate({ file: bytes(), name: 'Instructor Template' });
  const blob = await assembleTemplateImscc({
    syllabus,
    chapters,
    template,
    templateBlob: bytes(),
    outlineFields: {
      courseTitle: 'Cell Biology 101',
      courseDescription: 'Outline-provided description.',
      courseInformation: 'Meets Tue/Thu.',
      courseMaterials: 'Textbook: Cells.',
    },
  });
  const out = new Uint8Array(await blob.arrayBuffer());
  return { template, out, zip: await JSZip.loadAsync(out) };
}

describe('parser — a template written by Canvas itself', () => {
  it('classifies the four modules correctly', async () => {
    const t = await parseImsccTemplate({ file: bytes(), name: 'real' });
    expect(t.modules.map((m) => [m.title, m.classification])).toEqual([
      ['Instructor Information: Do not publish', 'verbatim'],
      ['Begin Here: Introductory Module', 'verbatim'],
      ['Module 1: Example Topic', 'example-pattern'],
      ['Module 2: (Example to Edit)', 'pattern'],
    ]);
    expect(t.modules[0].workflowState).toBe('unpublished');
  });

  it('reads every kind of item in Begin Here, incl. sub-header, external link and EDIT marker', async () => {
    const t = await parseImsccTemplate({ file: bytes(), name: 'real' });
    const begin = t.modules[1];
    expect(begin.items.map((i) => i.contentType)).toEqual([
      'WikiPage',
      'ContextModuleSubHeader',
      'ExternalUrl',
      'WikiPage',
      'Attachment',
    ]);
    expect(begin.items[3].editMarker).toBe('EDIT');
    expect(t.images).toHaveLength(1);
  });

  it('extracts the example module as few-shot content INCLUDING its discussion', async () => {
    // Regression: Canvas writes discussion resources without an href; the discussion was silently lost.
    const t = await parseImsccTemplate({ file: bytes(), name: 'real' });
    const ex = t.examplePatternContent!;
    expect(ex.sourceModuleTitle).toBe('Module 1: Example Topic');
    expect(ex.moduleOverviewHtml).toContain('explore the topic');
    expect(ex.instructorNotes).toHaveLength(1);
    expect(ex.instructorNotes[0].title).toBe('Teaching tips for week one');
    expect(ex.discussion?.title).toBe('What surprised you?');
    expect(ex.discussion?.promptHtml).toContain('surprised you');
  });
});

describe('template exporter — output for a template written by Canvas itself', () => {
  it('produces a cartridge the validator accepts', async () => {
    const { out } = await exported();
    const r = await validateImscc(out);
    expect(r.problems).toEqual([]);
  });

  it('keeps the verbatim external link, URL and all (it used to vanish on import)', async () => {
    const { zip } = await exported();
    const mm = await zip.file('course_settings/module_meta.xml')!.async('string');
    expect(mm).toContain('<url>https://example.edu/help</url>');
    const begin = mm.slice(mm.indexOf('Begin Here: Introductory Module'), mm.indexOf('Module 1: The Cell'));
    expect(begin.match(/<content_type>/g)).toHaveLength(5);
    expect(begin).toContain('<content_type>ExternalUrl</content_type>');
  });

  it('keeps the unpublished instructor module unpublished and in front', async () => {
    const { zip } = await exported();
    const mm = await zip.file('course_settings/module_meta.xml')!.async('string');
    const first = mm.slice(mm.indexOf('<module '), mm.indexOf('</module>'));
    expect(first).toContain('Instructor Information: Do not publish');
    expect(first).toMatch(/<workflow_state>unpublished<\/workflow_state>/);
  });

  it('replaces the pattern modules with one module per chapter, locked prefixes intact', async () => {
    const { zip } = await exported();
    const mm = await zip.file('course_settings/module_meta.xml')!.async('string');
    const titles = [...mm.matchAll(/<module [^>]*>\s*<title>([^<]+)<\/title>/g)].map((m) => m[1]);
    expect(titles).toEqual([
      'Instructor Information: Do not publish',
      'Begin Here: Introductory Module',
      'Module 1: The Cell',
      'Module 2: Genes',
      'Module 3: Proteins',
    ]);
    expect(mm).toContain('M1 Instructor Notes: Pacing for Module 1: The Cell');
    expect(mm).toContain('M3 Discussion: Big question 3');
  });

  it('leaves no stray pages from the replaced modules (Canvas imports every file in wiki_content/)', async () => {
    const { zip } = await exported();
    const pages = Object.keys(zip.files).filter((n) => n.startsWith('wiki_content/') && n.endsWith('.html'));
    // welcome, checklist, contact + 3 overviews + 6 notes
    expect(pages).toHaveLength(12);
    const bodies = await Promise.all(pages.map((p) => zip.file(p)!.async('string')));
    expect(bodies.join('\n')).not.toMatch(/Example to Edit|explore the topic through readings|Describe the module here|retrieval-practice warmup/);
  });

  it('puts the outline fields into the syllabus', async () => {
    const { zip } = await exported();
    const html = await zip.file('course_settings/syllabus.html')!.async('string');
    expect(html).toContain('Cell Biology 101');
    expect(html).toContain('Outline-provided description.');
    expect(html).toContain('Meets Tue/Thu.');
    expect(html).toContain('Textbook: Cells.');
  });

  it('carries the template image through to web_resources', async () => {
    const { zip } = await exported();
    expect(Object.keys(zip.files).some((n) => /web_resources\/.*banner\.png$/.test(n))).toBe(true);
  });
});
