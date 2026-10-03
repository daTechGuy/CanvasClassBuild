import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ResearchPage } from '../../src/pages/ResearchPage';
import { runResearch } from '../../src/services/research';
import { useCourseStore } from '../../src/store/courseStore';
import { useApiStore } from '../../src/store/apiStore';
import { useUiStore } from '../../src/store/uiStore';
import type { Syllabus, ResearchDossier } from '../../src/types/course';

// runResearch is what triggers network + LLM work; we stub it so the
// auto-start effect doesn't actually run when a key is present.
vi.mock('../../src/services/research', () => ({
  runResearch: vi.fn(() => new Promise(() => {})),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function makeSyllabus(numChapters: number): Syllabus {
  return {
    courseTitle: 'Intro to Statistics',
    courseOverview: 'A first course in stats.',
    chapters: Array.from({ length: numChapters }, (_, i) => ({
      number: i + 1,
      title: `Topic ${i + 1}`,
      narrative: 'A short narrative for the chapter that introduces the topic and motivates it.',
      keyConcepts: ['concept'],
      widgets: [],
      scienceAnnotations: [],
      spacingConnections: [],
    })),
  };
}

function makeDossier(chapterNumber: number, overrides: Partial<ResearchDossier> = {}): ResearchDossier {
  return {
    chapterNumber,
    sources: [
      { title: 'Smith 2020', authors: 'Smith, A.', year: '2020', summary: 'A study.', relevance: 'Foundational.', isVerified: true },
    ],
    synthesisNotes: 'Synthesis notes for chapter.',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ResearchPage />
    </MemoryRouter>,
  );
}

describe('<ResearchPage />', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    vi.mocked(runResearch).mockClear();
    useCourseStore.getState().reset();
    useUiStore.setState({ error: null, isGenerating: false });
    // Default test state: anthropic backend, no claude key → backend-not-ready
    // gate fires. Tests opt into the ready state by setting claudeApiKey.
    useApiStore.setState({
      claudeApiKey: '',
      ollamaApiKey: '',
      tavilyApiKey: '',
      provider: 'anthropic',
      researchBackend: 'anthropic',
    });
  });

  it('shows the no-syllabus empty state with a Back to Syllabus button', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText(/no syllabus generated yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to syllabus/i }));
    expect(navigateMock).toHaveBeenCalledWith('/syllabus');
  });

  it('shows the anthropic backend-not-ready notice when claude key is missing', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();

    expect(screen.getByRole('heading', { name: /research backend not configured/i })).toBeInTheDocument();
    expect(screen.getByText(/claude web-search backend needs an anthropic api key/i)).toBeInTheDocument();
  });

  it('shows the tavily backend-not-ready notice when only the tavily key is missing', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    useApiStore.setState({ researchBackend: 'tavily', claudeApiKey: 'sk-x', tavilyApiKey: '' });
    renderPage();

    expect(screen.getByText(/tavily backend needs both a tavily key and an llm key/i)).toBeInTheDocument();
  });

  it('shows the wikipedia backend-not-ready notice when llm key is missing', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    useApiStore.setState({ researchBackend: 'wikipedia', claudeApiKey: '' });
    renderPage();

    expect(screen.getByText(/wikipedia backend needs an llm key/i)).toBeInTheDocument();
  });

  it('lets the user Skip to Build from the backend-not-ready screen', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();

    await user.click(screen.getByRole('button', { name: /skip to build/i }));

    expect(navigateMock).toHaveBeenCalledWith('/build');
    expect(useCourseStore.getState().completedStages).toContain('research');
    expect(useCourseStore.getState().currentStage).toBe('build');
  });

  it('renders the dossier header + a sidebar entry per chapter when the backend is ready', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(
      screen.getByRole('heading', { name: /what does classbuild know about this material/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 of 3 chapters complete/i)).toBeInTheDocument();
    // Dossier sidebar — one entry per chapter.
    expect(screen.getByRole('button', { name: /topic 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /topic 2/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /topic 3/i })).toBeInTheDocument();
  });

  it('auto-starts research for the first chapter when the backend is ready', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(runResearch).toHaveBeenCalledTimes(1);
    expect(runResearch).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({ chapterNumber: 1, chapterTitle: 'Topic 1' }),
      expect.any(Function),
    );
  });

  it('does not auto-start research while the backend is not configured', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();

    expect(runResearch).not.toHaveBeenCalled();
  });

  it('shows Skip research only until a dossier exists', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [makeDossier(1)],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.queryAllByRole('button', { name: /^skip research$/i })).toHaveLength(0);
  });

  it('shows a completed dossier with its source and synthesis', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [makeDossier(1)],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByText(/smith 2020/i)).toBeInTheDocument();
    expect(screen.getByText(/synthesis notes for chapter/i)).toBeInTheDocument();
    // Verified sources carry no warning tag.
    expect(screen.queryByText(/^unverified$/i)).not.toBeInTheDocument();
  });

  it('flags AI-generated sources as unverified', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      researchDossiers: [
        makeDossier(1, {
          sources: [
            { title: 'Unverified Paper', authors: 'AI', year: '2026', summary: 'Made up.', relevance: 'Maybe.', isVerified: false },
          ],
        }),
      ],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByText(/^unverified$/i)).toBeInTheDocument();
    expect(screen.getByText(/drafted from the model's knowledge/i)).toBeInTheDocument();
  });

  it('selecting an unresearched chapter in the sidebar starts research for it', async () => {
    const user = userEvent.setup();
    // A dossier already exists, so nothing auto-starts on mount.
    useCourseStore.setState({
      syllabus: makeSyllabus(3),
      researchDossiers: [makeDossier(1)],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();
    expect(runResearch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /topic 2/i }));

    expect(runResearch).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({ chapterNumber: 2 }),
      expect.any(Function),
    );
  });

  it('shows the empty-state Start research button for a chapter that has no dossier yet', () => {
    // 3 chapters, dossier already exists for chapter 2 → the auto-start
    // effect skips (researchDossiers.length !== 0). The page lands on
    // chapter 1, which has no dossier and isn't being researched.
    useCourseStore.setState({
      syllabus: makeSyllabus(3),
      researchDossiers: [makeDossier(2)],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByText(/no research yet for this chapter/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start research/i })).toBeInTheDocument();
  });

  it('Begin build advances to the build stage and navigates', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [makeDossier(1)],
    });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    await user.click(screen.getByRole('button', { name: /begin build/i }));

    expect(navigateMock).toHaveBeenCalledWith('/build');
    expect(useCourseStore.getState().completedStages).toContain('research');
    expect(useCourseStore.getState().currentStage).toBe('build');
  });

  it('shows the "Research all remaining" button when more than one chapter is still unresearched', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(4) });
    useApiStore.setState({ claudeApiKey: 'sk-x' });
    renderPage();

    expect(screen.getByRole('button', { name: /research all remaining/i })).toBeInTheDocument();
  });
});
