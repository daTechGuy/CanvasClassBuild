import { describe, it, expect, vi, beforeEach } from 'vitest';

// The router's job is deciding WHICH backend gets WHICH key and model. Stub the backends
// and assert on what they receive.
vi.mock('../src/services/llm/anthropic', () => ({
  streamMessageAnthropic: vi.fn(async () => 'from-anthropic'),
  sendMessageAnthropic: vi.fn(),
}));
vi.mock('../src/services/llm/ollama', () => ({ streamMessageOllama: vi.fn(async () => 'from-ollama') }));
vi.mock('../src/services/llm/gemini', () => ({ streamMessageGemini: vi.fn(async () => 'from-gemini') }));

import { streamMessage, streamWithRetry } from '../src/services/llm';
import { streamMessageAnthropic } from '../src/services/llm/anthropic';
import { streamMessageOllama } from '../src/services/llm/ollama';
import { streamMessageGemini } from '../src/services/llm/gemini';
import { useApiStore } from '../src/store/apiStore';
import { MODELS, DEFAULT_GEMINI_MODEL } from '../src/services/claude/client';

const base = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('LLM router — provider, key and model resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApiStore.setState({
      provider: 'anthropic',
      claudeApiKey: 'sk-ant',
      ollamaApiKey: 'ollama-key',
      ollamaModel: 'gpt-oss:120b-cloud',
      geminiApiKey: 'AIza-store',
      geminiModel: 'gemini-store-model',
    });
  });

  it('sends Anthropic the key and (Claude) model the call site gave it', async () => {
    expect(await streamMessage({ ...base, apiKey: 'sk-call', model: MODELS.opus }, {})).toBe('from-anthropic');
    expect(streamMessageAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-call', model: MODELS.opus }),
      {},
    );
    expect(streamMessageGemini).not.toHaveBeenCalled();
    expect(streamMessageOllama).not.toHaveBeenCalled();
  });

  it('Gemini: uses the store key + model, ignoring the Claude key and Claude model id call sites pass', async () => {
    useApiStore.setState({ provider: 'gemini' });
    // Every page passes claudeApiKey and MODELS.opus/sonnet/haiku regardless of provider.
    expect(await streamMessage({ ...base, apiKey: 'sk-ant', model: MODELS.opus }, {})).toBe('from-gemini');
    expect(streamMessageGemini).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'AIza-store', model: 'gemini-store-model' }),
      {},
    );
    expect(streamMessageAnthropic).not.toHaveBeenCalled();
  });

  it('Gemini: a Claude model id from a call site never leaks through — the default model is used', async () => {
    useApiStore.setState({ provider: 'gemini', geminiModel: DEFAULT_GEMINI_MODEL });
    await streamMessage({ ...base, apiKey: 'x', model: MODELS.haiku }, {});
    expect(streamMessageGemini).toHaveBeenCalledWith(expect.objectContaining({ model: DEFAULT_GEMINI_MODEL }), {});
  });

  it('Gemini: honours an explicit non-Claude model override', async () => {
    useApiStore.setState({ provider: 'gemini' });
    await streamMessage({ ...base, apiKey: 'x', model: 'gemini-custom' }, {});
    expect(streamMessageGemini).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-custom' }), {});
  });

  it('Gemini: explicit CLI overrides win over the browser store (the CLI never touches it)', async () => {
    await streamMessage(
      { ...base, apiKey: '', provider: 'gemini', geminiApiKey: 'AIza-cli', geminiModel: 'gemini-cli-model' },
      {},
    );
    expect(streamMessageGemini).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'AIza-cli', model: 'gemini-cli-model' }),
      {},
    );
  });

  it('an explicit provider option beats the stored provider', async () => {
    useApiStore.setState({ provider: 'anthropic' });
    expect(await streamMessage({ ...base, apiKey: '', provider: 'gemini' }, {})).toBe('from-gemini');
  });

  it('Ollama keeps working the same way (key + model from the store, Claude ids ignored)', async () => {
    useApiStore.setState({ provider: 'ollama' });
    await streamMessage({ ...base, apiKey: 'sk-ant', model: MODELS.sonnet }, {});
    expect(streamMessageOllama).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'ollama-key', model: 'gpt-oss:120b-cloud' }),
      {},
    );
  });

  it('streamWithRetry backs off on a Gemini 429 and succeeds on the next try', async () => {
    useApiStore.setState({ provider: 'gemini' });
    vi.mocked(streamMessageGemini)
      .mockRejectedValueOnce(new Error('Gemini 429 RESOURCE_EXHAUSTED: Quota exceeded'))
      .mockResolvedValueOnce('recovered');
    vi.useFakeTimers();
    const p = streamWithRetry({ ...base, apiKey: 'x' }, {});
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBe('recovered');
    expect(streamMessageGemini).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('streamWithRetry does not retry other Gemini errors', async () => {
    useApiStore.setState({ provider: 'gemini' });
    vi.mocked(streamMessageGemini).mockRejectedValueOnce(new Error('Gemini 400 INVALID_ARGUMENT: bad key'));
    await expect(streamWithRetry({ ...base, apiKey: 'x' }, {})).rejects.toThrow(/Gemini 400/);
    expect(streamMessageGemini).toHaveBeenCalledTimes(1);
  });
});
