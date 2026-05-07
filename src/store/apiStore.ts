import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_OLLAMA_MODEL } from '../services/claude/client';
import type { LlmProvider } from '../services/llm/types';

interface ApiState {
  provider: LlmProvider;

  claudeApiKey: string;
  geminiApiKey: string;
  ollamaApiKey: string;
  ollamaModel: string;

  claudeKeyValid: boolean | null;
  geminiKeyValid: boolean | null;
  ollamaKeyValid: boolean | null;

  isValidatingClaude: boolean;
  isValidatingGemini: boolean;
  isValidatingOllama: boolean;

  setProvider: (p: LlmProvider) => void;
  setClaudeApiKey: (key: string) => void;
  setGeminiApiKey: (key: string) => void;
  setOllamaApiKey: (key: string) => void;
  setOllamaModel: (m: string) => void;
  setClaudeKeyValid: (valid: boolean | null) => void;
  setGeminiKeyValid: (valid: boolean | null) => void;
  setOllamaKeyValid: (valid: boolean | null) => void;
  setIsValidatingClaude: (v: boolean) => void;
  setIsValidatingGemini: (v: boolean) => void;
  setIsValidatingOllama: (v: boolean) => void;
}

export const useApiStore = create<ApiState>()(
  persist(
    (set) => ({
      provider: 'anthropic',
      claudeApiKey: '',
      geminiApiKey: '',
      ollamaApiKey: '',
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      claudeKeyValid: null,
      geminiKeyValid: null,
      ollamaKeyValid: null,
      isValidatingClaude: false,
      isValidatingGemini: false,
      isValidatingOllama: false,

      setProvider: (p) => set({ provider: p }),
      setClaudeApiKey: (key) => set({ claudeApiKey: key, claudeKeyValid: null }),
      setGeminiApiKey: (key) => set({ geminiApiKey: key, geminiKeyValid: null }),
      setOllamaApiKey: (key) => set({ ollamaApiKey: key, ollamaKeyValid: null }),
      setOllamaModel: (m) => set({ ollamaModel: m }),
      setClaudeKeyValid: (valid) => set({ claudeKeyValid: valid }),
      setGeminiKeyValid: (valid) => set({ geminiKeyValid: valid }),
      setOllamaKeyValid: (valid) => set({ ollamaKeyValid: valid }),
      setIsValidatingClaude: (v) => set({ isValidatingClaude: v }),
      setIsValidatingGemini: (v) => set({ isValidatingGemini: v }),
      setIsValidatingOllama: (v) => set({ isValidatingOllama: v }),
    }),
    {
      name: 'classbuild-api-keys',
      partialize: (state) => ({
        provider: state.provider,
        claudeApiKey: state.claudeApiKey,
        geminiApiKey: state.geminiApiKey,
        ollamaApiKey: state.ollamaApiKey,
        ollamaModel: state.ollamaModel,
      }),
    },
  ),
);
