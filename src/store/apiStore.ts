import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_OLLAMA_MODEL } from '../services/claude/client';
import type { LlmProvider } from '../services/llm/types';
import type { ResearchBackend } from '../services/research/types';

interface ApiState {
  provider: LlmProvider;
  researchBackend: ResearchBackend;
  /** When true, surfaces optional artifacts (audio, slides, infographic, weekly challenge, activities) that aren't part of the Canvas-focused happy path. */
  advancedMode: boolean;

  claudeApiKey: string;
  ollamaApiKey: string;
  ollamaModel: string;
  tavilyApiKey: string;

  claudeKeyValid: boolean | null;
  ollamaKeyValid: boolean | null;
  tavilyKeyValid: boolean | null;

  isValidatingClaude: boolean;
  isValidatingOllama: boolean;
  isValidatingTavily: boolean;
  openaiApiKey: string;
  elevenLabsApiKey: string;
  openaiKeyValid: boolean | null;
  elevenLabsKeyValid: boolean | null;
  isValidatingOpenai: boolean;
  isValidatingElevenLabs: boolean;

  setProvider: (p: LlmProvider) => void;
  setResearchBackend: (b: ResearchBackend) => void;
  setAdvancedMode: (v: boolean) => void;
  setClaudeApiKey: (key: string) => void;
  setOllamaApiKey: (key: string) => void;
  setOllamaModel: (m: string) => void;
  setTavilyApiKey: (key: string) => void;
  setClaudeKeyValid: (valid: boolean | null) => void;
  setOllamaKeyValid: (valid: boolean | null) => void;
  setTavilyKeyValid: (valid: boolean | null) => void;
  setIsValidatingClaude: (v: boolean) => void;
  setIsValidatingOllama: (v: boolean) => void;
  setIsValidatingTavily: (v: boolean) => void;
  setOpenaiApiKey: (key: string) => void;
  setElevenLabsApiKey: (key: string) => void;
  setOpenaiKeyValid: (valid: boolean | null) => void;
  setElevenLabsKeyValid: (valid: boolean | null) => void;
  setIsValidatingOpenai: (v: boolean) => void;
  setIsValidatingElevenLabs: (v: boolean) => void;
}

export const useApiStore = create<ApiState>()(
  persist(
    (set) => ({
      provider: 'anthropic',
      researchBackend: 'anthropic',
      advancedMode: false,
      claudeApiKey: '',
      ollamaApiKey: '',
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      tavilyApiKey: '',
      claudeKeyValid: null,
      ollamaKeyValid: null,
      tavilyKeyValid: null,
      isValidatingClaude: false,
      isValidatingOllama: false,
      isValidatingTavily: false,
      openaiApiKey: '',
      elevenLabsApiKey: '',
      openaiKeyValid: null,
      elevenLabsKeyValid: null,
      isValidatingOpenai: false,
      isValidatingElevenLabs: false,

      setProvider: (p) => set({ provider: p }),
      setResearchBackend: (b) => set({ researchBackend: b }),
      setAdvancedMode: (v) => set({ advancedMode: v }),
      setClaudeApiKey: (key) => set({ claudeApiKey: key, claudeKeyValid: null }),
      setOllamaApiKey: (key) => set({ ollamaApiKey: key, ollamaKeyValid: null }),
      setOllamaModel: (m) => set({ ollamaModel: m }),
      setTavilyApiKey: (key) => set({ tavilyApiKey: key, tavilyKeyValid: null }),
      setClaudeKeyValid: (valid) => set({ claudeKeyValid: valid }),
      setOllamaKeyValid: (valid) => set({ ollamaKeyValid: valid }),
      setTavilyKeyValid: (valid) => set({ tavilyKeyValid: valid }),
      setIsValidatingClaude: (v) => set({ isValidatingClaude: v }),
      setIsValidatingOllama: (v) => set({ isValidatingOllama: v }),
      setIsValidatingTavily: (v) => set({ isValidatingTavily: v }),
      setOpenaiApiKey: (key) => set({ openaiApiKey: key, openaiKeyValid: null }),
      setElevenLabsApiKey: (key) =>
        set({ elevenLabsApiKey: key, elevenLabsKeyValid: null }),
      setOpenaiKeyValid: (valid) => set({ openaiKeyValid: valid }),
      setElevenLabsKeyValid: (valid) => set({ elevenLabsKeyValid: valid }),
      setIsValidatingOpenai: (v) => set({ isValidatingOpenai: v }),
      setIsValidatingElevenLabs: (v) => set({ isValidatingElevenLabs: v }),
    }),
    {
      name: 'classbuild-api-keys',
      version: 4,
      migrate(persisted, version) {
        const state = persisted as Record<string, unknown>;
        // v0/v1 → v2: drop the retired geminiApiKey.
        if (version === undefined || version < 2) {
          delete state.geminiApiKey;
          delete state.geminiKeyValid;
          delete state.isValidatingGemini;
          if (typeof state.openaiApiKey !== 'string') state.openaiApiKey = '';
          if (typeof state.elevenLabsApiKey !== 'string') {
            state.elevenLabsApiKey = '';
          }
        }
        // v3 introduced addedVoiceIds for shared-library voices; v4 retires it
        // (we now use premade-only voices that don't require an add step).
        if (version === undefined || version < 4) {
          delete state.addedVoiceIds;
        }
        return state;
      },
      partialize: (state) => ({
        provider: state.provider,
        researchBackend: state.researchBackend,
        advancedMode: state.advancedMode,
        claudeApiKey: state.claudeApiKey,
        ollamaApiKey: state.ollamaApiKey,
        ollamaModel: state.ollamaModel,
        tavilyApiKey: state.tavilyApiKey,
        openaiApiKey: state.openaiApiKey,
        elevenLabsApiKey: state.elevenLabsApiKey,
      }),
    },
  ),
);
