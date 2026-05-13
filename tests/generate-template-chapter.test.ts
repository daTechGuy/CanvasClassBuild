import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockStreamWithRetry } = vi.hoisted(() => ({
  mockStreamWithRetry: vi.fn<(opts: unknown, cbs: unknown) => Promise<string>>(),
}));

vi.mock('../src/services/llm', () => ({
  streamMessage: mockStreamWithRetry,
  streamWithRetry: mockStreamWithRetry,
  sendMessage: vi.fn(),
}));

import { generateTemplateChapter } from '../src/services/template/generateChapter';
import type { CourseSetup, ChapterSyllabus } from '../src/types/course';
import type { TemplateExamplePatternContent } from '../src/types/template';

const setup: CourseSetup = {
  topic: 'Statistics',
  numChapters: 8,
  educationLevel: 'advanced-undergrad',
  chapterLength: 'standard',
  widgetsPerChapter: 2,
  cohortSize: 60,
  priorKnowledge: 'some',
  teachingEnvironment: 'lecture-theatre',
  themeId: 'midnight',
  templateId: 'tpl-1',
};

const chapter: ChapterSyllabus = {
  number: 3,
  title: 'Module 3: Confidence Intervals',
  narrative: 'How to reason from a sample to a population.',
  keyConcepts: ['standard error', 'margin of error'],
  widgets: [],
  scienceAnnotations: [],
  spacingConnections: [],
};

const validResponse = JSON.stringify({
  moduleOverview: '<p>This module covers confidence intervals.</p>',
  instructorNotes: [
    { title: 'What is a confidence interval?', html: '<p>CI explanation.</p>' },
    { title: 'How to compute one', html: '<p>Step-by-step.</p>' },
  ],
  discussion: {
    title: 'When have you misread a CI?',
    promptHtml: '<p>Share an example.</p>',
  },
});

describe('generateTemplateChapter', () => {
  beforeEach(() => {
    mockStreamWithRetry.mockReset();
  });

  it('parses a well-formed JSON response into TemplateChapterContent', async () => {
    mockStreamWithRetry.mockResolvedValueOnce(validResponse);

    const result = await generateTemplateChapter({
      apiKey: 'sk-test',
      setup,
      chapter,
      courseTitle: 'Statistics for Data Science',
      courseOverview: 'A 16-chapter course.',
    });

    expect(result.content.moduleOverviewHtml).toContain('confidence intervals');
    expect(result.content.instructorNotes).toHaveLength(2);
    expect(result.content.instructorNotes[0].title).toBe('What is a confidence interval?');
    expect(result.content.discussion.title).toContain('CI');
  });

  it('throws a descriptive error when the response is malformed', async () => {
    mockStreamWithRetry.mockResolvedValueOnce('not even json');

    await expect(
      generateTemplateChapter({
        apiKey: 'k',
        setup,
        chapter,
        courseTitle: 'x',
        courseOverview: 'y',
      }),
    ).rejects.toThrow(/parse template chapter response/i);
  });

  it('throws when required fields are missing (empty instructorNotes)', async () => {
    mockStreamWithRetry.mockResolvedValueOnce(
      JSON.stringify({
        moduleOverview: '<p>Overview.</p>',
        instructorNotes: [], // parser requires at least 1
        discussion: { title: 'x', promptHtml: '<p>y</p>' },
      }),
    );

    await expect(
      generateTemplateChapter({
        apiKey: 'k',
        setup,
        chapter,
        courseTitle: 'x',
        courseOverview: 'y',
      }),
    ).rejects.toThrow();
  });

  it('embeds the example-pattern content as a few-shot in the user message', async () => {
    mockStreamWithRetry.mockResolvedValueOnce(validResponse);

    const example: TemplateExamplePatternContent = {
      sourceModuleTitle: 'Module 2: Data Visualization',
      moduleOverviewHtml: '<p>EXAMPLE_OVERVIEW_SENTINEL</p>',
      instructorNotes: [
        { title: 'Example Note Title', htmlContent: '<p>EXAMPLE_NOTE_BODY</p>' },
      ],
      discussion: {
        title: 'Example Discussion',
        promptHtml: '<p>EXAMPLE_DISCUSSION_BODY</p>',
      },
    };

    await generateTemplateChapter({
      apiKey: 'k',
      setup,
      chapter,
      courseTitle: 'Statistics',
      courseOverview: 'Overview.',
      examplePatternContent: example,
    });

    const call = mockStreamWithRetry.mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    const userMessage = call.messages[0].content;
    expect(userMessage).toContain('Example to mimic');
    expect(userMessage).toContain('Module 2: Data Visualization');
    expect(userMessage).toContain('EXAMPLE_OVERVIEW_SENTINEL');
    expect(userMessage).toContain('EXAMPLE_NOTE_BODY');
    expect(userMessage).toContain('EXAMPLE_DISCUSSION_BODY');
  });

  it('does not include the few-shot block when no example is provided', async () => {
    mockStreamWithRetry.mockResolvedValueOnce(validResponse);

    await generateTemplateChapter({
      apiKey: 'k',
      setup,
      chapter,
      courseTitle: 'x',
      courseOverview: 'y',
    });

    const call = mockStreamWithRetry.mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    expect(call.messages[0].content).not.toContain('Example to mimic');
  });

  it('forwards provider + ollama overrides on the Ollama CLI path', async () => {
    mockStreamWithRetry.mockResolvedValueOnce(validResponse);

    await generateTemplateChapter({
      apiKey: '',
      setup,
      chapter,
      courseTitle: 'x',
      courseOverview: 'y',
      provider: 'ollama',
      ollamaApiKey: 'ollama-key',
      ollamaModel: 'gpt-oss:120b-cloud',
    });

    const call = mockStreamWithRetry.mock.calls[0][0] as Record<string, unknown>;
    expect(call.provider).toBe('ollama');
    expect(call.ollamaApiKey).toBe('ollama-key');
    expect(call.ollamaModel).toBe('gpt-oss:120b-cloud');
    // When provider==='ollama' the chapter generator should NOT force a
    // Claude model name (would 404 on Ollama).
    expect(call.model).toBeUndefined();
  });

  it('uses Sonnet on the default Anthropic path', async () => {
    mockStreamWithRetry.mockResolvedValueOnce(validResponse);

    await generateTemplateChapter({
      apiKey: 'sk-test',
      setup,
      chapter,
      courseTitle: 'x',
      courseOverview: 'y',
    });

    const call = mockStreamWithRetry.mock.calls[0][0] as Record<string, unknown>;
    expect(call.model).toMatch(/sonnet/i);
  });
});
