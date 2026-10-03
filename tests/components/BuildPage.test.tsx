import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BuildPage } from '../../src/pages/BuildPage';
import { useCourseStore } from '../../src/store/courseStore';
import { useApiStore } from '../../src/store/apiStore';
import { useUiStore } from '../../src/store/uiStore';
import { useTemplateStore } from '../../src/store/templateStore';
import { generateTemplateChapter } from '../../src/services/template/generateChapter';
import type { Syllabus, GeneratedChapter, ResearchDossier } from '../../src/types/course';

// Network/streaming + any backend the page can fire on mount: stub so tests
// never touch the network.
vi.mock('../../src/services/claude/streaming', () => ({
  streamMessage: vi.fn(() => new Promise(() => {})),
  streamWithRetry: vi.fn(() => new Promise(() => {})),
}));

// BuildPage dynamic-imports this for the Canvas Module tab.
vi.mock('../../src/services/template/generateChapter', () => ({
  generateTemplateChapter: vi.fn(async () => ({
    content: {
      moduleOverviewHtml: '<p>Overview body</p>',
      instructorNotes: [{ title: 'Note one', htmlContent: '<p>note</p>' }],
      discussion: { title: 'Talk it over', promptHtml: '<p>prompt</p>' },
    },
    rawText: '',
  })),
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
      narrative: 'Narrative.',
      keyConcepts: ['mean'],
      widgets: [],
      scienceAnnotations: [],
      spacingConnections: [],
    })),
  };
}

function makeChapter(overrides: Partial<GeneratedChapter> & { number: number; title: string }): GeneratedChapter {
  return {
    htmlContent: '<html>chapter content</html>',
    ...overrides,
  };
}

function makeDossier(chapterNumber: number): ResearchDossier {
  return {
    chapterNumber,
    sources: [
      { title: 'Smith 2020', authors: 'Smith', year: '2020', summary: 'A paper.', relevance: 'Foundational.', isVerified: true },
    ],
    synthesisNotes: 'Synthesis.',
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BuildPage />
    </MemoryRouter>,
  );
}

function activateTemplate() {
  useCourseStore.setState({
    setup: { ...useCourseStore.getState().setup, templateId: 'tpl-1' },
  });
  useTemplateStore.setState({
    templates: [
      {
        id: 'tpl-1',
        parserVersion: 3,
        name: 'Stats Template',
        uploadedAt: new Date().toISOString(),
        fileSizeBytes: 1234,
        modules: [],
        images: [],
        ltiResources: [],
        courseSettings: {},
        totalFiles: 5,
      },
    ],
    activeTemplateId: 'tpl-1',
  });
}

describe('<BuildPage />', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    vi.mocked(generateTemplateChapter).mockClear();
    useCourseStore.getState().reset();
    useUiStore.setState({
      error: null,
      isGenerating: false,
      activeTab: 'chapter',
      batchGenerating: false,
      batchCurrentChapter: null,
      batchPhase: null,
      batchMaterial: null,
    });
    useApiStore.setState({
      claudeApiKey: 'sk-x',
      advancedMode: false,
    });
    useTemplateStore.setState({ templates: [], activeTemplateId: null });
    // jsdom/happy-dom stubs for the download path.
    if (!('createObjectURL' in URL)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).revokeObjectURL = vi.fn();
    }
  });

  it('shows an empty state with a Back to syllabus button when no syllabus is in the store', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText(/no syllabus generated yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to syllabus/i }));
    expect(navigateMock).toHaveBeenCalledWith('/syllabus');
  });

  it('renders the Build header, progress, and Go to Export button once a syllabus is loaded', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Intro to Statistics' })).toBeInTheDocument();
    expect(screen.getByText(/0 of 3 chapters built/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to export/i })).toBeDisabled();
  });

  it('enables Go to Export and navigates to /export once at least one chapter exists', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();

    const exportBtn = screen.getByRole('button', { name: /go to export/i });
    expect(exportBtn).toBeEnabled();
    await user.click(exportBtn);

    expect(navigateMock).toHaveBeenCalledWith('/export');
    expect(useCourseStore.getState().completedStages).toContain('build');
    expect(useCourseStore.getState().currentStage).toBe('export');
  });

  it('shows "Draft all chapters" when none exist, "Draft remaining chapters" once some do', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    const { unmount } = renderPage();
    expect(screen.getByRole('button', { name: /draft all chapters/i })).toBeInTheDocument();

    unmount();
    useCourseStore.setState({
      syllabus: makeSyllabus(3),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();
    expect(screen.getByRole('button', { name: /draft remaining chapters/i })).toBeInTheDocument();
  });

  it('shows the "Draft this chapter" call-to-action when a chapter has research but no content yet', async () => {
    const user = userEvent.setup();
    // Chapter 1 already generated; chapter 2 has research but no content —
    // that's the state we want to land on.
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [makeDossier(2)],
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();

    // Click the sidebar entry for chapter 2 to switch to it.
    await user.click(screen.getByRole('button', { name: /topic 2/i }));

    expect(screen.getByRole('button', { name: /view dossier/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft this chapter/i })).toBeInTheDocument();
  });

  it('warns the user when the chapter has no research, offering both "Go to Research" and "Draft anyway"', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      researchDossiers: [],
      chapters: [],
    });
    renderPage();

    expect(screen.getByText(/no research yet for this chapter/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft anyway/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /go to research/i }));
    expect(navigateMock).toHaveBeenCalledWith('/research');
  });

  it('shows the default tab set (Reading / Practice / Quizzes / Discussion) for a generated chapter', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();

    expect(screen.getByRole('tab', { name: /^reading/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^practice/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^quizzes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^discussion/i })).toBeInTheDocument();
    // Advanced tabs hidden by default.
    expect(screen.queryByRole('tab', { name: /^challenge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^activities/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^audio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^slides/i })).not.toBeInTheDocument();
  });

  it('reveals the advanced tabs (Challenge / Activities / Audio / Slides) when advancedMode is on', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    useApiStore.setState({ advancedMode: true });
    renderPage();

    expect(screen.getByRole('tab', { name: /^challenge/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^activities/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^audio/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^slides/i })).toBeInTheDocument();
  });

  it('prepends the Canvas Module tab when a Canvas template is active', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    activateTemplate();
    renderPage();

    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent(/^canvas module/i);
    expect(screen.getByRole('button', { name: /generate all canvas modules/i })).toBeInTheDocument();
  });

  it('does not show the Canvas Module tab without a template', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();

    expect(screen.queryByRole('tab', { name: /^canvas module/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /canvas modules?/i })).not.toBeInTheDocument();
  });

  it('generates a Canvas module from the Canvas Module tab and stores it on the chapter', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    activateTemplate();
    useUiStore.setState({ activeTab: 'template-module' });
    renderPage();

    await user.click(screen.getByRole('button', { name: /generate canvas module/i }));

    await waitFor(() => expect(generateTemplateChapter).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useCourseStore.getState().chapters[0].templateContent?.discussion.title).toBe(
        'Talk it over',
      ),
    );
    expect(await screen.findByText(/overview body/i)).toBeInTheDocument();
  });

  it('renders the chapter sidebar with one entry per chapter in the syllabus', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(4) });
    renderPage();

    expect(screen.getByRole('button', { name: /topic 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /topic 4/i })).toBeInTheDocument();
  });

  it('links to the research dossier for a chapter that has one', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      researchDossiers: [makeDossier(1)],
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /view dossier/i })).toBeInTheDocument();
  });

  it('renders a UI error banner from useUiStore.error', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
    });
    useUiStore.setState({ error: 'Generation failed for chapter 1.' });
    renderPage();

    expect(screen.getByText(/generation failed for chapter 1/i)).toBeInTheDocument();
  });

  describe('advanced-mode gating of batch generation', () => {
    function seedResearched() {
      useCourseStore.setState({
        syllabus: makeSyllabus(2),
        researchDossiers: [makeDossier(1), makeDossier(2)],
        // Chapter 1 exists so the page's auto-draft-on-mount effect stays idle.
        chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
      });
    }

    it('Canvas-focused mode: the batch dialog offers Canvas materials only', async () => {
      const user = userEvent.setup();
      seedResearched();
      renderPage();

      await user.click(screen.getByRole('button', { name: /draft remaining chapters/i }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(/build all canvas materials/i);
      expect(dialog).toHaveTextContent(/reading, quizzes, and discussion/i);
      expect(dialog).not.toHaveTextContent(/audiobook/i);
    });

    it('Everything mode: the batch dialog offers the full set', async () => {
      const user = userEvent.setup();
      useApiStore.setState({ advancedMode: true });
      seedResearched();
      renderPage();

      await user.click(screen.getByRole('button', { name: /draft remaining chapters/i }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(/build everything/i);
      expect(dialog).toHaveTextContent(/weekly challenge, discussion, activities, audiobook, slides/i);
    });

    it('sidebar counts only the visible materials (of 4) in Canvas-focused mode, of 8 in Everything mode', () => {
      useCourseStore.setState({
        syllabus: makeSyllabus(1),
        chapters: [makeChapter({ number: 1, title: 'Topic 1' })],
      });
      const { unmount } = renderPage();
      expect(screen.getByText(/1 of 4 drafted/i)).toBeInTheDocument();
      unmount();

      useApiStore.setState({ advancedMode: true });
      renderPage();
      expect(screen.getByText(/1 of 8 drafted/i)).toBeInTheDocument();
    });

    it('a chapter with all four Canvas materials reads as fully drafted without the advanced ones', () => {
      useCourseStore.setState({
        syllabus: makeSyllabus(1),
        chapters: [
          makeChapter({
            number: 1,
            title: 'Topic 1',
            practiceQuizData: 'Q',
            inClassQuizData: [{ question: 'q', correctAnswer: 'a', correctFeedback: 'f', distractors: [] }],
            discussionData: [{ prompt: 'p', hook: 'h' }],
          }),
        ],
      });
      renderPage();

      // Fully drafted → the sidebar swaps the "N of M" count for a ready marker.
      expect(screen.queryByText(/of 8 drafted/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/\d of 4 drafted/i)).not.toBeInTheDocument();
    });
  });
});
