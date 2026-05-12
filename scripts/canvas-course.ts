#!/usr/bin/env node
/**
 * Headless Canvas-template course generator.
 *
 * Takes a Canvas course template (.imscc) and an optional course-outline
 * (.docx), produces a syllabus + Canvas Module content per chapter (Module
 * Overview + 1+ Instructor Notes + 1 Discussion), then writes a fresh
 * .imscc bundling everything on top of the template's verbatim modules.
 *
 * Mirrors the UI's Setup → Syllabus → Build → Export pipeline, minus the
 * Research stage (CLI defaults to skipping it).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/canvas-course.ts \
 *     --topic "Statistics for Data Science" \
 *     --template ./template.imscc \
 *     --outline ./outline.docx \
 *     --chapters 16 \
 *     --output ./output/stats
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

// Polyfill DOMParser for Node — the template parser and exporter both call
// new DOMParser() at module scope. Must happen before any of those imports.
import { DOMParser as LinkedomDOMParser } from 'linkedom';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DOMParser = LinkedomDOMParser;

import { parseImsccTemplate } from '../src/services/template/parser';
import { docxToText, extractOutlineFields } from '../src/services/template/parseOutlineDocx';
import { generateTemplateChapter } from '../src/services/template/generateChapter';
import { assembleTemplateImscc } from '../src/services/template/templateImsccExporter';
import { streamMessage } from '../src/services/llm';
import { MODELS } from '../src/services/claude/client';
import { buildSyllabusPrompt, parseSyllabusResponse } from '../src/prompts/syllabus';
import type {
  CourseSetup,
  EducationLevel,
  ChapterLength,
  GeneratedChapter,
  Syllabus,
} from '../src/types/course';
import type { OutlineFields } from '../src/types/outline';

// ─── CLI args ─────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    topic: { type: 'string' },
    template: { type: 'string' },
    outline: { type: 'string' },
    chapters: { type: 'string', default: '16' },
    output: { type: 'string', default: './output' },
    level: { type: 'string', default: 'advanced-undergrad' },
    length: { type: 'string', default: 'standard' },
    cohort: { type: 'string', default: '60' },
    notes: { type: 'string' },
    'specific-topics': { type: 'string' },
    'avoid-topics': { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    syllabus: { type: 'string' }, // path to existing syllabus.json (skip regeneration)
    'skip-canvas-module': { type: 'boolean', default: false },
    provider: { type: 'string', default: 'anthropic' }, // anthropic | ollama
    'ollama-model': { type: 'string', default: 'gpt-oss:120b-cloud' },
  },
  strict: true,
});

if (!values.topic) {
  console.error('Error: --topic is required');
  printUsage();
  process.exit(1);
}
if (!values.template) {
  console.error('Error: --template is required (path to a Canvas .imscc file)');
  printUsage();
  process.exit(1);
}

type Provider = 'anthropic' | 'ollama';
const PROVIDER: Provider =
  values.provider === 'ollama' ? 'ollama' : 'anthropic';
const OLLAMA_MODEL = values['ollama-model']!;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

if (PROVIDER === 'anthropic' && !ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required for --provider anthropic');
  process.exit(1);
}
if (PROVIDER === 'ollama' && !OLLAMA_API_KEY) {
  console.error('Error: OLLAMA_API_KEY environment variable is required for --provider ollama');
  process.exit(1);
}

// The outline-DOCX extraction step always runs on Claude when available
// (it's a one-shot JSON extraction that benefits from instruction-following
// quality). If Anthropic isn't configured, fall back to Ollama.
const OUTLINE_KEY = ANTHROPIC_API_KEY ?? OLLAMA_API_KEY!;
const OUTLINE_PROVIDER: Provider = ANTHROPIC_API_KEY ? 'anthropic' : 'ollama';

const setup: CourseSetup = {
  topic: values.topic,
  numChapters: parseInt(values.chapters!, 10),
  educationLevel: values.level as EducationLevel,
  chapterLength: values.length as ChapterLength,
  widgetsPerChapter: 2, // not surfaced in template flow but kept for shape
  cohortSize: parseInt(values.cohort!, 10),
  priorKnowledge: 'some',
  teachingEnvironment: 'lecture-theatre',
  themeId: 'midnight',
  voiceId: 'Kore',
  specificTopics: values['specific-topics'],
  avoidTopics: values['avoid-topics'],
  textbookReference: undefined,
  learnerNotes: values.notes,
  templateId: 'cli', // sentinel — enables template-mode prompt branch in buildSyllabusPrompt
};

const OUTPUT_DIR = values.output!;
const CONCURRENCY = parseInt(values.concurrency!, 10);

function printUsage() {
  console.error(
    'Usage:\n' +
      '  ANTHROPIC_API_KEY=sk-... npx tsx scripts/canvas-course.ts \\\n' +
      '    --topic "Course topic" \\\n' +
      '    --template ./template.imscc \\\n' +
      '    [--outline ./outline.docx] \\\n' +
      '    [--chapters 16] \\\n' +
      '    [--output ./output/dir] \\\n' +
      '    [--level advanced-undergrad] \\\n' +
      '    [--length concise|standard|comprehensive] \\\n' +
      '    [--notes "Additional learner context"] \\\n' +
      '    [--provider anthropic|ollama] \\\n' +
      '    [--ollama-model gpt-oss:120b-cloud] \\\n' +
      '    [--concurrency 3] \\\n' +
      '    [--syllabus ./existing-syllabus.json]\n' +
      '\nFor Ollama: set OLLAMA_API_KEY (and optionally ANTHROPIC_API_KEY for\noutline extraction quality if you have it).',
  );
}

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

// ─── Concurrency helper ──────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: Array<{ label: string; fn: () => Promise<T> }>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        const v = await tasks[i].fn();
        results[i] = { status: 'fulfilled', value: v };
        log(`✓ ${tasks[i].label}`);
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
        log(`✗ ${tasks[i].label} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => worker()));
  return results;
}

// ─── Pipeline ─────────────────────────────────────────────────────

async function main() {
  await ensureDir(OUTPUT_DIR);

  // 1. Parse template
  log(`Parsing template ${basename(values.template!)}…`);
  const templateBuf = await readFile(values.template!);
  // Pass the Uint8Array directly — JSZip accepts it natively in Node, and
  // wrapping in a Node Blob has known compatibility issues with JSZip.
  const templateBytes = new Uint8Array(
    templateBuf.buffer,
    templateBuf.byteOffset,
    templateBuf.byteLength,
  );
  const template = await parseImsccTemplate({
    file: templateBytes,
    name: basename(values.template!).replace(/\.imscc$/i, ''),
  });
  log(
    `  ${template.modules.length} modules · ${template.images.length} images · ${template.ltiResources.length} LTI links`,
  );
  if (template.examplePatternContent) {
    const ex = template.examplePatternContent;
    log(
      `  example-pattern: ${ex.sourceModuleTitle} (${ex.instructorNotes.length} notes${ex.discussion ? ', 1 discussion' : ''})`,
    );
  }

  // 2. Parse outline DOCX (optional)
  let outlineFields: OutlineFields | null = null;
  if (values.outline) {
    log(`Parsing outline ${basename(values.outline)}…`);
    const docxBuf = await readFile(values.outline);
    const docxBlob = new Blob([
      new Uint8Array(docxBuf.buffer, docxBuf.byteOffset, docxBuf.byteLength),
    ]);
    const rawText = await docxToText(docxBlob);
    const result = await extractOutlineFields({
      apiKey: OUTLINE_KEY,
      rawText,
      provider: OUTLINE_PROVIDER,
      ollamaApiKey: OUTLINE_PROVIDER === 'ollama' ? OLLAMA_API_KEY ?? undefined : undefined,
      ollamaModel: OUTLINE_PROVIDER === 'ollama' ? OLLAMA_MODEL : undefined,
    });
    outlineFields = result.fields;
    const found = Object.keys(outlineFields).filter(
      (k) => outlineFields![k as keyof OutlineFields],
    ).length;
    log(`  extracted ${found}/4 outline fields`);
  }

  // 3. Build syllabus (or load from --syllabus path)
  let syllabus: Syllabus;
  if (values.syllabus) {
    log(`Loading syllabus from ${values.syllabus}…`);
    const json = await readFile(values.syllabus, 'utf-8');
    syllabus = JSON.parse(json);
  } else {
    log(`Generating syllabus via ${PROVIDER}…`);
    const { systemPrompt, userMessage } = buildSyllabusPrompt(setup);
    const fullText = await streamMessage(
      {
        apiKey: PROVIDER === 'anthropic' ? ANTHROPIC_API_KEY! : '',
        // Anthropic uses Opus for syllabus; on Ollama we let the user's
        // chosen --ollama-model handle it.
        model: PROVIDER === 'anthropic' ? MODELS.opus : undefined,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        thinkingBudget: 'high',
        maxTokens: 16000,
        provider: PROVIDER,
        ollamaApiKey: PROVIDER === 'ollama' ? OLLAMA_API_KEY! : undefined,
        ollamaModel: PROVIDER === 'ollama' ? OLLAMA_MODEL : undefined,
      },
      {},
    );
    const parsed = parseSyllabusResponse(fullText);
    if (!parsed) {
      throw new Error('Failed to parse syllabus response from Claude.');
    }
    syllabus = parsed;
    await writeFile(join(OUTPUT_DIR, 'syllabus.json'), JSON.stringify(syllabus, null, 2));
    log(`  saved syllabus.json (${syllabus.chapters.length} chapters)`);
  }

  // 4. Generate Canvas Module content per chapter (parallel)
  const chapters: GeneratedChapter[] = syllabus.chapters.map((c) => ({
    number: c.number,
    title: c.title,
    htmlContent: '', // template path doesn't use this — assembleTemplateImscc reads templateContent
  }));

  if (!values['skip-canvas-module']) {
    log(`Generating Canvas Module content for ${chapters.length} chapters (concurrency=${CONCURRENCY})…`);
    const tasks = syllabus.chapters.map((ch) => ({
      label: `Module ${ch.number}: ${ch.title.slice(0, 40)}`,
      fn: async () => {
        const { content } = await generateTemplateChapter({
          apiKey: PROVIDER === 'anthropic' ? ANTHROPIC_API_KEY! : '',
          setup,
          chapter: ch,
          courseTitle: syllabus.courseTitle,
          courseOverview: syllabus.courseOverview,
          examplePatternContent: template.examplePatternContent,
          provider: PROVIDER,
          ollamaApiKey: PROVIDER === 'ollama' ? OLLAMA_API_KEY! : undefined,
          ollamaModel: PROVIDER === 'ollama' ? OLLAMA_MODEL : undefined,
        });
        const target = chapters.find((c) => c.number === ch.number);
        if (target) target.templateContent = content;
        return content;
      },
    }));
    const results = await runWithConcurrency(tasks, CONCURRENCY);
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0) {
      log(`⚠️  ${failures} chapter(s) failed Canvas Module generation — proceeding with what we have.`);
    }
  }

  // 5. Build the IMSCC
  log('Bundling .imscc…');
  const imsccBlob = await assembleTemplateImscc({
    syllabus,
    chapters,
    template,
    templateBlob: templateBytes,
    outlineFields,
  });
  const courseSlug = syllabus.courseTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'course';
  const outPath = join(OUTPUT_DIR, `${courseSlug}.imscc`);
  await writeFile(outPath, Buffer.from(await imsccBlob.arrayBuffer()));
  log(`✅ Wrote ${outPath} (${(imsccBlob.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
