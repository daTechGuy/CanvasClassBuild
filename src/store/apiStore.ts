import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ApiState {
  claudeApiKey: string;
  geminiApiKey: string;
  claudeKeyValid: boolean | null;
  geminiKeyValid: boolean | null;
  isValidatingClaude: boolean;
  isValidatingGemini: boolean;

  setClaudeApiKey: (key: string) => void;
  setGeminiApiKey: (key: string) => void;
  setClaudeKeyValid: (valid: boolean | null) => void;
  setGeminiKeyValid: (valid: boolean | null) => void;
  setIsValidatingClaude: (v: boolean) => void;
  setIsValidatingGemini: (v: boolean) => void;
}

export const useApiStore = create<ApiState>()(
  persist(
    (set) => ({
      claudeApiKey: '',
      geminiApiKey: '',
      claudeKeyValid: null,
      geminiKeyValid: null,
      isValidatingClaude: false,
      isValidatingGemini: false,

      setClaudeApiKey: (key) => set({ claudeApiKey: key, claudeKeyValid: null }),
      setGeminiApiKey: (key) => set({ geminiApiKey: key, geminiKeyValid: null }),
      setClaudeKeyValid: (valid) => set({ claudeKeyValid: valid }),
      setGeminiKeyValid: (valid) => set({ geminiKeyValid: valid }),
      setIsValidatingClaude: (v) => set({ isValidatingClaude: v }),
      setIsValidatingGemini: (v) => set({ isValidatingGemini: v }),
    }),
    {
      name: 'classbuild-api-keys',
      partialize: (state) => ({
        claudeApiKey: state.claudeApiKey,
        geminiApiKey: state.geminiApiKey,
      }),
    }
  )
);
