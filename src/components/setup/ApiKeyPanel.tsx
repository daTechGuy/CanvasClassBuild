import { useCallback, useEffect, useRef } from 'react';
import { useApiStore } from '../../store/apiStore';
import { MODELS } from '../../services/claude/client';
import { ProviderCard } from './ProviderCard';
import { CLAUDE_CONFIG, GEMINI_CONFIG, OLLAMA_CONFIG } from './providerConfigs';

export function ApiKeyPanel() {
  const {
    provider,
    claudeApiKey, geminiApiKey, ollamaApiKey, ollamaModel,
    claudeKeyValid, geminiKeyValid, ollamaKeyValid,
    isValidatingClaude, isValidatingGemini, isValidatingOllama,
    setProvider,
    setClaudeApiKey, setGeminiApiKey, setOllamaApiKey, setOllamaModel,
    setClaudeKeyValid, setGeminiKeyValid, setOllamaKeyValid,
    setIsValidatingClaude, setIsValidatingGemini, setIsValidatingOllama,
  } = useApiStore();

  const validateClaude = useCallback(async () => {
    if (!claudeApiKey.trim()) return;
    setIsValidatingClaude(true);
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({
        apiKey: claudeApiKey.trim(),
        dangerouslyAllowBrowser: true,
      });
      await client.messages.create({
        model: MODELS.haiku,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      setClaudeKeyValid(true);
    } catch {
      setClaudeKeyValid(false);
    } finally {
      setIsValidatingClaude(false);
    }
  }, [claudeApiKey, setClaudeKeyValid, setIsValidatingClaude]);

  const validateGemini = useCallback(async () => {
    if (!geminiApiKey.trim()) return;
    setIsValidatingGemini(true);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey.trim()}`,
      );
      setGeminiKeyValid(res.ok);
    } catch {
      setGeminiKeyValid(false);
    } finally {
      setIsValidatingGemini(false);
    }
  }, [geminiApiKey, setGeminiKeyValid, setIsValidatingGemini]);

  const validateOllama = useCallback(async () => {
    if (!ollamaApiKey.trim()) return;
    setIsValidatingOllama(true);
    try {
      const res = await fetch('https://ollama.com/api/tags', {
        headers: { Authorization: `Bearer ${ollamaApiKey.trim()}` },
      });
      setOllamaKeyValid(res.ok);
    } catch {
      setOllamaKeyValid(false);
    } finally {
      setIsValidatingOllama(false);
    }
  }, [ollamaApiKey, setOllamaKeyValid, setIsValidatingOllama]);

  // Auto-validate stored keys on mount
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (claudeApiKey.trim() && claudeKeyValid === null) validateClaude();
    if (geminiApiKey.trim() && geminiKeyValid === null) validateGemini();
    if (ollamaApiKey.trim() && ollamaKeyValid === null) validateOllama();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-medium text-text-primary">
        Connect Your Services
      </h3>

      <div className="flex items-start gap-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3.5 py-3">
        <svg className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <div>
          <p className="text-xs font-medium text-emerald-400 mb-0.5">Your keys never leave your computer</p>
          <p className="text-xs text-text-muted leading-relaxed">
            ClassBuild has no server and no accounts. Everything happens right here in your browser — we never see, store, or have access to your keys.
          </p>
        </div>
      </div>

      {/* LLM provider segmented control */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-secondary">Course-content provider</p>
        <div className="inline-flex rounded-lg border border-violet-500/15 bg-bg-card p-1 text-xs">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-md transition ${
              provider === 'anthropic'
                ? 'bg-violet-500/15 text-violet-300 font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
            onClick={() => setProvider('anthropic')}
          >
            Claude
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 rounded-md transition ${
              provider === 'ollama'
                ? 'bg-violet-500/15 text-violet-300 font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
            onClick={() => setProvider('ollama')}
          >
            Ollama Cloud
          </button>
        </div>
        <p className="text-xs text-text-muted">
          {provider === 'anthropic'
            ? 'Claude writes syllabus, research, and chapter content. Best quality.'
            : 'Open-weight alternative. The Research stage is disabled — switch to Claude for it.'}
        </p>
      </div>

      <ProviderCard
        config={CLAUDE_CONFIG}
        apiKey={claudeApiKey}
        keyValid={claudeKeyValid}
        isValidating={isValidatingClaude}
        setKey={setClaudeApiKey}
        validate={validateClaude}
        defaultExpanded={!claudeApiKey && provider === 'anthropic'}
      />

      <ProviderCard
        config={OLLAMA_CONFIG}
        apiKey={ollamaApiKey}
        keyValid={ollamaKeyValid}
        isValidating={isValidatingOllama}
        setKey={setOllamaApiKey}
        validate={validateOllama}
        defaultExpanded={!ollamaApiKey && provider === 'ollama'}
      />

      {provider === 'ollama' && ollamaApiKey.trim() && (
        <div className="rounded-lg border border-violet-500/15 bg-bg-card px-3.5 py-3 space-y-1.5">
          <label className="block text-xs font-medium text-text-secondary">Ollama model</label>
          <input
            type="text"
            value={ollamaModel}
            onChange={(e) => setOllamaModel(e.target.value)}
            placeholder="gpt-oss:120b-cloud"
            className="w-full rounded-md bg-bg-base border border-violet-500/10 px-3 py-1.5 text-sm font-mono"
          />
          <p className="text-xs text-text-muted">
            Browse models at <a className="text-violet-400 hover:underline" href="https://ollama.com/search?c=cloud" target="_blank" rel="noreferrer">ollama.com/search?c=cloud</a>.
          </p>
        </div>
      )}

      <ProviderCard
        config={GEMINI_CONFIG}
        apiKey={geminiApiKey}
        keyValid={geminiKeyValid}
        isValidating={isValidatingGemini}
        setKey={setGeminiApiKey}
        validate={validateGemini}
      />
    </div>
  );
}
