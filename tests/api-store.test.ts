import { describe, it, expect, beforeEach } from 'vitest';
import { useApiStore, selectActiveLlm } from '../src/store/apiStore';
import { DEFAULT_GEMINI_MODEL } from '../src/services/claude/client';

const state = () => useApiStore.getState();

describe('selectActiveLlm — the key that matters for the active provider', () => {
  beforeEach(() => {
    useApiStore.setState({
      provider: 'anthropic',
      claudeApiKey: '',
      claudeKeyValid: null,
      ollamaApiKey: '',
      ollamaKeyValid: null,
      geminiApiKey: '',
      geminiKeyValid: null,
    });
  });

  it('follows the selected provider, with the label used in messages', () => {
    useApiStore.setState({ claudeApiKey: 'c', ollamaApiKey: 'o', geminiApiKey: 'g' });

    useApiStore.setState({ provider: 'anthropic' });
    expect(selectActiveLlm(state())).toMatchObject({ provider: 'anthropic', label: 'Anthropic', apiKey: 'c' });
    useApiStore.setState({ provider: 'ollama' });
    expect(selectActiveLlm(state())).toMatchObject({ provider: 'ollama', label: 'Ollama', apiKey: 'o' });
    useApiStore.setState({ provider: 'gemini' });
    expect(selectActiveLlm(state())).toMatchObject({ provider: 'gemini', label: 'Gemini', apiKey: 'g' });
  });

  it('hasKey ignores other providers\' keys and whitespace-only keys', () => {
    // A Claude-only key must not satisfy a Gemini user (and vice versa) — the old gates got this wrong.
    useApiStore.setState({ provider: 'gemini', claudeApiKey: 'sk-ant', geminiApiKey: '   ' });
    expect(selectActiveLlm(state()).hasKey).toBe(false);

    useApiStore.setState({ geminiApiKey: 'AIza' });
    expect(selectActiveLlm(state()).hasKey).toBe(true);

    useApiStore.setState({ provider: 'ollama' });
    expect(selectActiveLlm(state()).hasKey).toBe(false);
  });

  it('reports each provider\'s own validation result', () => {
    useApiStore.setState({ claudeKeyValid: true, ollamaKeyValid: false, geminiKeyValid: null });
    useApiStore.setState({ provider: 'anthropic' });
    expect(selectActiveLlm(state()).keyValid).toBe(true);
    useApiStore.setState({ provider: 'ollama' });
    expect(selectActiveLlm(state()).keyValid).toBe(false);
    useApiStore.setState({ provider: 'gemini' });
    expect(selectActiveLlm(state()).keyValid).toBeNull();
  });
});

describe('Gemini fields in the API store', () => {
  it('defaults to the default model and no key', () => {
    // A fresh persisted-state merge (e.g. someone upgrading from v4) falls back to these.
    const fresh = useApiStore.getInitialState();
    expect(fresh.geminiApiKey).toBe('');
    expect(fresh.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(fresh.geminiKeyValid).toBeNull();
    expect(fresh.isValidatingGemini).toBe(false);
  });

  it('changing the key or the model invalidates a previous verification', () => {
    useApiStore.setState({ geminiKeyValid: true });
    state().setGeminiApiKey('AIza-new');
    expect(state().geminiKeyValid).toBeNull();

    useApiStore.setState({ geminiKeyValid: true });
    state().setGeminiModel('gemini-other');
    expect(state().geminiKeyValid).toBeNull();
    expect(state().geminiModel).toBe('gemini-other');
  });

  it('persists the key and model (like the other provider settings)', () => {
    const opts = useApiStore.persist.getOptions();
    const persisted = opts.partialize!(state()) as Record<string, unknown>;
    expect(persisted).toHaveProperty('geminiApiKey');
    expect(persisted).toHaveProperty('geminiModel');
    // …but not transient validation state.
    expect(persisted).not.toHaveProperty('geminiKeyValid');
    expect(persisted).not.toHaveProperty('isValidatingGemini');
  });

  it('upgrading from an older persisted state keeps its keys and fills in Gemini defaults', async () => {
    const opts = useApiStore.persist.getOptions();
    expect(opts.version).toBeGreaterThanOrEqual(5);
    // What a v4 user has in storage: no gemini fields at all.
    const v4 = { provider: 'ollama', claudeApiKey: 'sk-old', ollamaApiKey: 'o', ollamaModel: 'm', researchBackend: 'wikipedia', advancedMode: true };
    const migrated = (await opts.migrate!(v4, 4)) as Record<string, unknown>;
    // The migration must not drop anything the user had…
    expect(migrated).toMatchObject(v4);
    // …and persist's shallow merge over the initial state supplies the new fields.
    const merged = { ...useApiStore.getInitialState(), ...migrated } as ReturnType<typeof useApiStore.getState>;
    expect(merged.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(merged.geminiApiKey).toBe('');
    expect(merged.provider).toBe('ollama');
  });
});
