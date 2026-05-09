import type { CourseSetup, ChapterSyllabus, TemplateChapterContent } from '../types/course';

export interface BuildTemplateChapterPromptInput {
  setup: CourseSetup;
  chapter: ChapterSyllabus;
  courseTitle: string;
  courseOverview: string;
}

export function buildTemplateChapterPrompt({
  setup,
  chapter,
  courseTitle,
  courseOverview,
}: BuildTemplateChapterPromptInput): { systemPrompt: string; userMessage: string } {
  const wordTarget =
    setup.chapterLength === 'concise'
      ? '~600–900'
      : setup.chapterLength === 'comprehensive'
        ? '~1,500–2,200'
        : '~1,000–1,500';

  const systemPrompt = `You are CanvasClassBuild generating Canvas course module content for a single chapter. The output must populate three Canvas-shaped artifacts that an instructor will import as a Common Cartridge: a Module Overview wiki page, one or more Instructor Notes wiki pages, and a single Discussion prompt.

## Output format

Respond with ONLY valid JSON (no markdown code fences, no preamble, no commentary). The JSON must match this exact shape:

{
  "moduleOverview": "<html body content for the module overview wiki page>",
  "instructorNotes": [
    {
      "title": "Specific subject of this notes page (no 'MN Instructor Notes:' prefix — that is added at export time)",
      "html": "<html body content for this notes page>"
    }
  ],
  "discussion": {
    "title": "Specific discussion topic (no 'MN Discussion:' prefix — that is added at export time)",
    "promptHtml": "<html body content for the discussion prompt>"
  }
}

## Rules

- **moduleOverview**: A short orienting page (~300–500 words). Tell the student what this module covers, why it matters, and how it connects to the course arc. Plain HTML body content (no <html>, <head>, or <body> tags — start directly with content tags like <h2>, <p>, <ul>, etc.).
- **instructorNotes**: One OR MORE pages. Decide how many based on the topic — most chapters need 2–4 pages, complex topics may justify more. Each page is ${wordTarget} words of substantive instructional content. Use clear headings (<h2>, <h3>), paragraphs, lists, and tables where useful. Each page should focus on a coherent sub-topic of the chapter. Plain HTML body content (no html/head/body wrappers).
- **discussion**: ONE discussion prompt that invites student reflection or application. The promptHtml should pose a thought-provoking question, give 2–4 sub-questions students can pick from, and close with brief etiquette/expectations (e.g., "respond to two classmates").
- **Title field**: Plain text only, no leading colons or prefixes. The Canvas-import pipeline prepends the locked prefix (\`M${chapter.number} Instructor Notes:\` / \`M${chapter.number} Discussion:\`) automatically.
- **HTML quality**: Render cleanly when imported as a Canvas Page. No inline scripts, no <script>, no inline event handlers. Use semantic markup. <hr> between major sections is fine. Do not embed images.
- **Tone**: Pitched at ${setup.educationLevel.replace(/-/g, ' ')} students with ${setup.priorKnowledge === 'none' ? 'no prior knowledge' : setup.priorKnowledge === 'some' ? 'some foundational knowledge' : 'significant background'} in this domain.
- **Single chapter only**: Do not reference other module numbers in your output unless explicitly relevant.

Output ONLY the JSON.`;

  const userMessage = `Course: "${courseTitle}"
Course overview: ${courseOverview}

Generate the Canvas module content for this chapter:

**Module ${chapter.number}**: ${chapter.title}
**Narrative**: ${chapter.narrative}
**Key concepts**: ${chapter.keyConcepts.join(', ')}

Audience: ${setup.educationLevel.replace(/-/g, ' ')} students (~${setup.cohortSize} students per cohort)
${setup.learnerNotes ? `Additional learner context: ${setup.learnerNotes}` : ''}

Output ONLY valid JSON in the schema described.`;

  return { systemPrompt, userMessage };
}

export function parseTemplateChapterResponse(text: string): TemplateChapterContent | null {
  try {
    let jsonStr = text.trim();
    const fence = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fence) jsonStr = fence[1];
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first === -1 || last === -1) return null;
    jsonStr = jsonStr.slice(first, last + 1);

    const raw = JSON.parse(jsonStr);
    if (typeof raw !== 'object' || raw === null) return null;

    const moduleOverview = typeof raw.moduleOverview === 'string' ? raw.moduleOverview.trim() : '';
    if (!moduleOverview) return null;

    const notesRaw = Array.isArray(raw.instructorNotes) ? raw.instructorNotes : [];
    const instructorNotes = notesRaw
      .map((n: Record<string, unknown>) => ({
        title: typeof n.title === 'string' ? n.title.trim() : '',
        htmlContent: typeof n.html === 'string' ? n.html.trim() : '',
      }))
      .filter((n: { title: string; htmlContent: string }) => n.title.length > 0 && n.htmlContent.length > 0);
    if (instructorNotes.length === 0) return null;

    const discussionRaw = (raw.discussion ?? {}) as Record<string, unknown>;
    const discussion = {
      title: typeof discussionRaw.title === 'string' ? discussionRaw.title.trim() : '',
      promptHtml: typeof discussionRaw.promptHtml === 'string' ? discussionRaw.promptHtml.trim() : '',
    };
    if (!discussion.title || !discussion.promptHtml) return null;

    return { moduleOverviewHtml: moduleOverview, instructorNotes, discussion };
  } catch {
    return null;
  }
}
