import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_OLLAMA_MODEL } from '../services/claude/client';
import type { LlmProvider } from '../services/llm/types';
import type { ResearchBackend } from '../services/research/types';

interface ApiState {
  provider: LlmProvider;
  researchBackend: ResearchBackend;

  claudeApiKey: string;
  geminiApiKey: string;
  ollamaApiKey: string;
  ollamaModel: string;
  tavilyApiKey: string;

  claudeKeyValid: boolean | null;
  geminiKeyValid: boolean | null;
  ollamaKeyValid: boolean | null;
  tavilyKeyValid: boolean | null;

  isValidatingClaude: boolean;
  isValidatingGemini: boolean;
  isValidatingOllama: boolean;
  isValidatingTavily: boolean;

  setProvider: (p: LlmProvider) => void;
  setResearchBackend: (b: ResearchBackend) => void;
  setClaudeApiKey: (key: string) => void;
  setGeminiApiKey: (key: string) => void;
  setOllamaApiKey: (key: string) => void;
  setOllamaModel: (m: string) => void;
  setTavilyApiKey: (key: string) => void;
  setClaudeKeyValid: (valid: boolean | null) => void;
  setGeminiKeyValid: (valid: boolean | null) => void;
  setOllamaKeyValid: (valid: boolean | null) => void;
  setTavilyKeyValid: (valid: boolean | null) => void;
  setIsValidatingClaude: (v: boolean) => void;
  setIsValidatingGemini: (v: boolean) => void;
  setIsValidatingOllama: (v: boolean) => void;
  setIsValidatingTavily: (v: boolean) => void;
}

export const useApiStore = create<ApiState>()(
  persist(
    (set) => ({
      provider: 'anthropic',
      researchBackend: 'anthropic',
      claudeApiKey: '',
      geminiApiKey: '',
      ollamaApiKey: '',
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      tavilyApiKey: '',
      claudeKeyValid: null,
      geminiKeyValid: null,
      ollamaKeyValid: null,
      tavilyKeyValid: null,
      isValidatingClaude: false,
      isValidatingGemini: false,
      isValidatingOllama: false,
      isValidatingTavily: false,

      setProvider: (p) => set({ provider: p }),
      setResearchBackend: (b) => set({ researchBackend: b }),
      setClaudeApiKey: (key) => set({ claudeApiKey: key, claudeKeyValid: null }),
      setGeminiApiKey: (key) => set({ geminiApiKey: key, geminiKeyValid: null }),
      setOllamaApiKey: (key) => set({ ollamaApiKey: key, ollamaKeyValid: null }),
      setOllamaModel: (m) => set({ ollamaModel: m }),
      setTavilyApiKey: (key) => set({ tavilyApiKey: key, tavilyKeyValid: null }),
      setClaudeKeyValid: (valid) => set({ claudeKeyValid: valid }),
      setGeminiKeyValid: (valid) => set({ geminiKeyValid: valid }),
      setOllamaKeyValid: (valid) => set({ ollamaKeyValid: valid }),
      setTavilyKeyValid: (valid) => set({ tavilyKeyValid: valid }),
      setIsValidatingClaude: (v) => set({ isValidatingClaude: v }),
      setIsValidatingGemini: (v) => set({ isValidatingGemini: v }),
      setIsValidatingOllama: (v) => set({ isValidatingOllama: v }),
      setIsValidatingTavily: (v) => set({ isValidatingTavily: v }),
    }),
    {
      name: 'classbuild-api-keys',
      partialize: (state) => ({
        provider: state.provider,
        researchBackend: state.researchBackend,
        claudeApiKey: state.claudeApiKey,
        geminiApiKey: state.geminiApiKey,
        ollamaApiKey: state.ollamaApiKey,
        ollamaModel: state.ollamaModel,
        tavilyApiKey: state.tavilyApiKey,
      }),
    },
  ),
);
