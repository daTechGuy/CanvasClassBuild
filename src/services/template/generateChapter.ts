import type Anthropic from '@anthropic-ai/sdk';
import { streamWithRetry } from '../llm';
import { MODELS } from '../claude/client';
import {
  buildTemplateChapterPrompt,
  parseTemplateChapterResponse,
} from '../../prompts/templateChapter';
import type {
  CourseSetup,
  ChapterSyllabus,
  TemplateChapterContent,
} from '../../types/course';
import type { TemplateExamplePatternContent } from '../../types/template';

export interface GenerateTemplateChapterInput {
  apiKey: string;
  setup: CourseSetup;
  chapter: ChapterSyllabus;
  courseTitle: string;
  courseOverview: string;
  /** Few-shot exemplar from the template's example-pattern module. */
  examplePatternContent?: TemplateExamplePatternContent;
  onText?: (text: string) => void;
  onError?: (err: Error) => void;
}

export interface GenerateTemplateChapterResult {
  content: TemplateChapterContent;
  rawText: string;
}

/**
 * Stream a single chapter's Canvas-template content (Module Overview +
 * 1+ Instructor Notes pages + 1 Discussion). Routes through the standard
 * LLM facade so it works on whichever provider is active.
 */
export async function generateTemplateChapter(
  input: GenerateTemplateChapterInput,
): Promise<GenerateTemplateChapterResult> {
  const { apiKey, setup, chapter, courseTitle, courseOverview, examplePatternContent, onText, onError } = input;

  const { systemPrompt, userMessage } = buildTemplateChapterPrompt({
    setup,
    chapter,
    courseTitle,
    courseOverview,
    examplePatternContent,
  });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

  const rawText = await streamWithRetry(
    {
      apiKey,
      model: MODELS.sonnet,
      system: systemPrompt,
      messages,
      thinkingBudget: 'medium',
      maxTokens: 16000,
    },
    {
      onText,
      onError,
    },
  );

  const content = parseTemplateChapterResponse(rawText);
  if (!content) {
    throw new Error(
      'Could not parse template chapter response. The model may have returned malformed JSON.',
    );
  }
  return { content, rawText };
}
