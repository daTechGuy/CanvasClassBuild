import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mock holder — vi.mock factories can't reference outer scope unless
// the binding is created via vi.hoisted.
const { mockStreamMessage } = vi.hoisted(() => ({
  mockStreamMessage: vi.fn<(opts: unknown, cbs: unknown) => Promise<string>>(),
}));

vi.mock('../src/services/llm', () => ({
  streamMessage: mockStreamMessage,
  streamWithRetry: mockStreamMessage,
  sendMessage: vi.fn(),
}));

import { extractOutlineFields } from '../src/services/template/parseOutlineDocx';

describe('extractOutlineFields', () => {
  beforeEach(() => {
    mockStreamMessage.mockReset();
  });

  it('parses a clean JSON response into all four fields', async () => {
    mockStreamMessage.mockResolvedValueOnce(
      JSON.stringify({
        courseTitle: 'SD203NF Statistics',
        courseDescription: 'A descriptive course.',
        courseInformation: '3 credits, online.',
        courseMaterials: 'OpenIntro Statistics PDF.',
      }),
    );

    const result = await extractOutlineFields({
      apiKey: 'sk-test',
      rawText: 'Course outline raw text here.',
    });

    expect(result.fields.courseTitle).toBe('SD203NF Statistics');
    expect(result.fields.courseDescription).toBe('A descriptive course.');
    expect(result.fields.courseInformation).toBe('3 credits, online.');
    expect(result.fields.courseMaterials).toBe('OpenIntro Statistics PDF.');
    expect(result.rawText).toBe('Course outline raw text here.');
  });

  it('strips a leading ```json code fence the model often emits', async () => {
    mockStreamMessage.mockResolvedValueOnce(
      '```json\n{ "courseTitle": "Fenced Title", "courseDescription": "fenced" }\n```',
    );

    const result = await extractOutlineFields({ apiKey: 'k', rawText: 'x' });
    expect(result.fields.courseTitle).toBe('Fenced Title');
    expect(result.fields.courseDescription).toBe('fenced');
  });

  it('omits fields the model left blank or absent', async () => {
    mockStreamMessage.mockResolvedValueOnce(
      JSON.stringify({ courseTitle: 'Just a title', courseDescription: '   ' }),
    );

    const result = await extractOutlineFields({ apiKey: 'k', rawText: 'x' });
    expect(result.fields.courseTitle).toBe('Just a title');
    // Empty / whitespace-only description should be dropped, not stored as ''
    expect(result.fields.courseDescription).toBeUndefined();
    expect(result.fields.courseInformation).toBeUndefined();
    expect(result.fields.courseMaterials).toBeUndefined();
  });

  it('returns empty fields when the response is unparseable', async () => {
    mockStreamMessage.mockResolvedValueOnce('not json at all just prose');

    const result = await extractOutlineFields({ apiKey: 'k', rawText: 'x' });
    expect(result.fields).toEqual({});
  });

  it('trims input rawText to maxChars to avoid blowing the prompt budget', async () => {
    mockStreamMessage.mockResolvedValueOnce('{}');
    const longText = 'x'.repeat(50_000);

    await extractOutlineFields({ apiKey: 'k', rawText: longText, maxChars: 1000 });

    // The user message passed into streamMessage should contain the trimmed
    // text, not the full 50k.
    const callArgs = mockStreamMessage.mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    const userMessage = callArgs.messages[0].content;
    expect(userMessage).toContain('x'.repeat(1000));
    expect(userMessage.length).toBeLessThan(2000);
  });

  it('forwards provider + ollama overrides to the LLM facade (CLI path)', async () => {
    mockStreamMessage.mockResolvedValueOnce('{}');

    await extractOutlineFields({
      apiKey: 'unused-in-ollama-mode',
      rawText: 'x',
      provider: 'ollama',
      ollamaApiKey: 'ollama-key',
      ollamaModel: 'gpt-oss:120b-cloud',
    });

    const callArgs = mockStreamMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.provider).toBe('ollama');
    expect(callArgs.ollamaApiKey).toBe('ollama-key');
    expect(callArgs.ollamaModel).toBe('gpt-oss:120b-cloud');
  });
});
