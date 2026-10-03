import { it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { assembleImscc } from '../src/services/export/imsccExporter';
import { parseImsccTemplate } from '../src/services/template/parser';
import { assembleTemplateImscc } from '../src/services/template/templateImsccExporter';
import { demoSyllabus, demoChapters } from '../src/fixtures/demoCourse';
import type { Syllabus, GeneratedChapter } from '../src/types/course';

/**
 * NOT a real test — a generator for the Canvas test harness (tools/canvas-test).
 * It only runs when CCT_BUILD is set, so it is skipped in normal `npm test` / CI.
 * It runs under vitest because the exporters need a browser-like environment
 * (Blob/DOMParser) that plain Node does not provide.
 *
 *   tools/canvas-test/build-demo-cartridge.sh
 *
 * writes output/demo-course-native.imscc (no-template export of the demo course) and
 * output/demo-template-export.imscc (template export, using the Canvas-made template
 * fixture and canned chapter content — no LLM).
 */
const out = (name: string) => `output/${name}`;

it.runIf(process.env.CCT_BUILD)('writes the demo cartridges for the Canvas test harness', async () => {
  mkdirSync('output', { recursive: true });

  const native = await assembleImscc(demoSyllabus, demoChapters, { themeId: 'press', curriculumCsv: 'a,b\n1,2\n' });
  writeFileSync(out('demo-course-native.imscc'), Buffer.from(await native.arrayBuffer()));

  const tplBytes = new Uint8Array(readFileSync('tests/fixtures/canvas-instructor-template.imscc'));
  const template = await parseImsccTemplate({ file: tplBytes, name: 'Instructor Template' });
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
      instructorNotes: [{ title: `Pacing for ${c.title}`, htmlContent: `<p>Warm up for module ${c.number}.</p>` }],
      discussion: { title: `Big question ${c.number}`, promptHtml: `<p>Discuss module ${c.number}.</p>` },
    },
  })) as GeneratedChapter[];
  const tpl = await assembleTemplateImscc({ syllabus, chapters, template, templateBlob: tplBytes });
  writeFileSync(out('demo-template-export.imscc'), Buffer.from(await tpl.arrayBuffer()));
});
