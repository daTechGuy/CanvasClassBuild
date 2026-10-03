import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CourseOutlineUpload } from '../../src/components/setup/CourseOutlineUpload';
import { SyllabusPage } from '../../src/pages/SyllabusPage';
import { ExportPage } from '../../src/pages/ExportPage';
import { ResearchPage } from '../../src/pages/ResearchPage';
import { useCourseStore } from '../../src/store/courseStore';
import { useApiStore } from '../../src/store/apiStore';
import { useUiStore } from '../../src/store/uiStore';
import { streamMessage } from '../../src/services/claude/streaming';
import { runResearch } from '../../src/services/research';
import type { Syllabus } from '../../src/types/course';

/**
 * Several screens used to gate on `claudeApiKey` being present, so anyone on Ollama or
 * Gemini WITHOUT a Claude key was silently blocked (e.g. the syllabus never auto-started).
 * They now ask the ACTIVE provider's key. These tests pin that for every provider.
 */
vi.mock('../../src/services/claude/streaming', () => ({
  streamMessage: vi.fn(() => new Promise(() => {})),
  streamWithRetry: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../src/services/research', () => ({
  runResearch: vi.fn(() => new Promise(() => {})),
}));
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const NO_KEYS = {
  claudeApiKey: '',
  ollamaApiKey: '',
  geminiApiKey: '',
  tavilyApiKey: '',
  provider: 'anthropic' as const,
  researchBackend: 'anthropic' as const,
};

function setKeys(partial: Partial<typeof NO_KEYS> & Record<string, unknown>) {
  useApiStore.setState({ ...NO_KEYS, ...partial });
}

function syllabus(n = 2): Syllabus {
  return {
    courseTitle: 'Intro to Statistics',
    courseOverview: 'A first course in stats.',
    chapters: Array.from({ length: n }, (_, i) => ({
      number: i + 1,
      title: `Topic ${i + 1}`,
      narrative: 'A short narrative for the chapter.',
      keyConcepts: ['concept'],
      widgets: [],
      scienceAnnotations: [],
      spacingConnections: [],
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  navigateMock.mockClear();
  useCourseStore.getState().reset();
  useUiStore.setState({ error: null, isGenerating: false });
  setKeys({});
});

describe('outline upload gate', () => {
  async function upload() {
    const user = userEvent.setup();
    render(<CourseOutlineUpload />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['not really a docx'], 'outline.docx'));
  }

  it('names the active provider when its key is missing, even if another provider has one', async () => {
    setKeys({ provider: 'gemini', claudeApiKey: 'sk-ant-present', geminiApiKey: '' });
    await upload();
    expect(await screen.findByText(/add your gemini api key before uploading/i)).toBeInTheDocument();
  });

  it('passes the gate with only a Gemini key (the failure is then about the file, not the key)', async () => {
    setKeys({ provider: 'gemini', claudeApiKey: '', geminiApiKey: 'AIza-x' });
    await upload();
    await waitFor(() => expect(screen.queryByText(/before uploading/i)).not.toBeInTheDocument());
    expect(await screen.findByText(/could not parse|couldn.t|failed|error/i)).toBeInTheDocument();
  });
});

describe('syllabus auto-start', () => {
  const renderSyllabus = () => render(<MemoryRouter><SyllabusPage /></MemoryRouter>);

  it.each([
    ['gemini', { geminiApiKey: 'AIza-x' }],
    ['ollama', { ollamaApiKey: 'ollama-x' }], // was silently blocked before the fix
    ['anthropic', { claudeApiKey: 'sk-ant-x' }],
  ] as const)('starts drafting with only the %s key set', (provider, keys) => {
    setKeys({ provider, ...keys });
    renderSyllabus();
    expect(streamMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['gemini', { claudeApiKey: 'sk-ant-x', ollamaApiKey: 'o' }],
    ['ollama', { claudeApiKey: 'sk-ant-x', geminiApiKey: 'g' }],
    ['anthropic', { ollamaApiKey: 'o', geminiApiKey: 'g' }],
  ] as const)('does NOT start for %s when only OTHER providers have keys', (provider, keys) => {
    setKeys({ provider, ...keys });
    renderSyllabus();
    expect(streamMessage).not.toHaveBeenCalled();
  });
});

describe('export: learning outcomes', () => {
  const generateButton = () => screen.getByRole('button', { name: /generate learning outcomes/i });
  const renderExport = () => {
    useCourseStore.setState({ syllabus: syllabus() });
    return render(<MemoryRouter><ExportPage /></MemoryRouter>);
  };

  it('is enabled with only a Gemini key', () => {
    setKeys({ provider: 'gemini', geminiApiKey: 'AIza-x' });
    renderExport();
    expect(generateButton()).toBeEnabled();
  });

  it('is disabled when only another provider has a key', () => {
    setKeys({ provider: 'gemini', claudeApiKey: 'sk-ant-x' });
    renderExport();
    expect(generateButton()).toBeDisabled();
  });

  it('is enabled with only an Ollama key', () => {
    setKeys({ provider: 'ollama', ollamaApiKey: 'ollama-x' });
    renderExport();
    expect(generateButton()).toBeEnabled();
  });
});

describe('research: which key each backend needs', () => {
  const renderResearch = () => {
    useCourseStore.setState({ syllabus: syllabus() });
    return render(<MemoryRouter><ResearchPage /></MemoryRouter>);
  };

  it('Wikipedia research runs on a Gemini-only setup and hands Gemini\'s key to the synthesiser', () => {
    setKeys({ provider: 'gemini', researchBackend: 'wikipedia', geminiApiKey: 'AIza-synth' });
    renderResearch();

    expect(screen.queryByRole('heading', { name: /research backend not configured/i })).not.toBeInTheDocument();
    expect(runResearch).toHaveBeenCalledWith(
      'wikipedia',
      expect.objectContaining({ llmApiKey: 'AIza-synth' }),
      expect.any(Function),
    );
  });

  it('Tavily research needs the Tavily key AND the active LLM\'s key', () => {
    setKeys({ provider: 'gemini', researchBackend: 'tavily', geminiApiKey: 'AIza-x', tavilyApiKey: '' });
    const { unmount } = renderResearch();
    expect(screen.getByText(/tavily backend needs both a tavily key and an llm key/i)).toBeInTheDocument();
    expect(runResearch).not.toHaveBeenCalled();
    unmount();

    setKeys({ provider: 'gemini', researchBackend: 'tavily', geminiApiKey: 'AIza-x', tavilyApiKey: 'tvly-x' });
    renderResearch();
    expect(runResearch).toHaveBeenCalledWith(
      'tavily',
      expect.objectContaining({ llmApiKey: 'AIza-x', tavilyApiKey: 'tvly-x' }),
      expect.any(Function),
    );
  });

  it('"Claude web search" still needs a Claude key — Gemini cannot run Anthropic\'s search tool', () => {
    setKeys({ provider: 'gemini', researchBackend: 'anthropic', geminiApiKey: 'AIza-x' });
    renderResearch();
    expect(screen.getByRole('heading', { name: /research backend not configured/i })).toBeInTheDocument();
    expect(screen.getByText(/claude web-search backend needs an anthropic api key/i)).toBeInTheDocument();
    expect(runResearch).not.toHaveBeenCalled();
  });
});
