import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ExportPage } from '../../src/pages/ExportPage';
import { useCourseStore } from '../../src/store/courseStore';
import { useUiStore } from '../../src/store/uiStore';
import { useApiStore } from '../../src/store/apiStore';
import { assembleImscc } from '../../src/services/export/imsccExporter';
import type { Syllabus, GeneratedChapter } from '../../src/types/course';

// Keep these heavy modules out of the test path — they're only exercised on
// click handlers and we're testing render behavior.
vi.mock('../../src/services/claude/streaming', () => ({
  streamMessage: vi.fn(),
}));

// The cartridge build + save are exercised in their own tests; here we only
// care how the page decides to call them.
vi.mock('../../src/services/export/imsccExporter', () => ({
  assembleImscc: vi.fn(async () => new Blob(['imscc'])),
}));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

function makeSyllabus(numChapters: number): Syllabus {
  return {
    courseTitle: 'Intro to Statistics',
    courseOverview: 'A first course in stats.',
    chapters: Array.from({ length: numChapters }, (_, i) => ({
      number: i + 1,
      title: `Chapter ${i + 1}`,
      narrative: 'Narrative text.',
      keyConcepts: ['concept'],
      widgets: [],
      scienceAnnotations: [],
      spacingConnections: [],
    })),
  };
}

function makeChapter(overrides: Partial<GeneratedChapter> & { number: number; title: string }): GeneratedChapter {
  return {
    htmlContent: '<html><body>chapter</body></html>',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ExportPage />
    </MemoryRouter>,
  );
}

describe('<ExportPage />', () => {
  beforeEach(() => {
    useCourseStore.getState().reset();
    vi.mocked(assembleImscc).mockClear();
    useUiStore.setState({ error: null, isGenerating: false });
    useApiStore.setState({ claudeApiKey: 'sk-x', advancedMode: false });
    // jsdom/happy-dom don't implement URL.createObjectURL; download handlers
    // would blow up the suite if any test wires a click on them.
    if (!('createObjectURL' in URL)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).revokeObjectURL = vi.fn();
    }
  });

  it('shows an empty state when no syllabus is loaded', () => {
    renderPage();
    expect(screen.getByText(/no course in progress/i)).toBeInTheDocument();
  });

  it('renders the course title in the header once a syllabus is loaded', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Intro to Statistics' })).toBeInTheDocument();
    expect(screen.getByText(/0 of 3 chapters drafted/i)).toBeInTheDocument();
  });

  it('shows the header actions: Publish, Export for Canvas, Download, Project file', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    renderPage();

    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export for canvas/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download .*zip/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /project file/i })).toBeInTheDocument();
  });

  it('disables Publish / Export for Canvas / Download when no chapters are generated', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3), chapters: [] });
    renderPage();

    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /export for canvas/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /download .*zip/i })).toBeDisabled();
  });

  it('enables Export for Canvas once at least one chapter exists', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(3),
      chapters: [makeChapter({ number: 1, title: 'Chapter 1' })],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /export for canvas/i })).toBeEnabled();
  });

  it('shows "Download N of M" while not all chapters are ready', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(5),
      chapters: [makeChapter({ number: 1, title: 'Chapter 1' }), makeChapter({ number: 2, title: 'Chapter 2' })],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /download 2 of 5/i })).toBeInTheDocument();
  });

  it('shows "Download all" once every chapter is generated', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      chapters: [
        makeChapter({ number: 1, title: 'Chapter 1' }),
        makeChapter({ number: 2, title: 'Chapter 2' }),
      ],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /download all/i })).toBeInTheDocument();
  });

  it('renders a UI error banner when ui.error is set', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    useUiStore.setState({ error: 'Boom — something went wrong.' });
    renderPage();

    expect(screen.getByText('Boom — something went wrong.')).toBeInTheDocument();
  });

  it('shows a "Draft class" button for chapters that have not been generated yet', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(3),
      chapters: [makeChapter({ number: 1, title: 'Chapter 1' })],
    });
    renderPage();

    // Chapters 2 and 3 are not generated → 2 Draft class buttons.
    expect(screen.getAllByRole('button', { name: /draft class/i })).toHaveLength(2);
  });

  it('disables the Draft class buttons while ui.isGenerating is true', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(2),
      chapters: [],
    });
    useUiStore.setState({ isGenerating: true });
    renderPage();

    for (const btn of screen.getAllByRole('button', { name: /draft class/i })) {
      expect(btn).toBeDisabled();
    }
  });

  it('only shows the Reading row for a chapter that has no extras (just HTML)', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Chapter 1' })],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /^reading/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /practice quiz/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /slides/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /audiobook/i })).not.toBeInTheDocument();
  });

  it('shows the practice-quiz download row when practiceQuizData is present', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [
        makeChapter({
          number: 1,
          title: 'Chapter 1',
          practiceQuizData: 'Q1: ...',
        }),
      ],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /^practice quiz/i })).toBeInTheDocument();
  });

  it('shows both Weekly Challenge HTML and SCORM rows when challenge data is present', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [
        makeChapter({
          number: 1,
          title: 'Chapter 1',
          weeklyChallengeData: { questions: [] } as unknown as GeneratedChapter['weeklyChallengeData'],
        }),
      ],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /^weekly challenge/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /challenge scorm/i })).toBeInTheDocument();
  });

  it('shows the Teaching row when discussions OR activities are present', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [
        makeChapter({
          number: 1,
          title: 'Chapter 1',
          discussionData: [{ prompt: 'p', hook: 'h' }],
        }),
      ],
    });
    renderPage();

    expect(screen.getByRole('button', { name: /^teaching/i })).toBeInTheDocument();
  });

  it('marks a chapter ready when every artifact type is present', () => {
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [
        makeChapter({
          number: 1,
          title: 'Chapter 1',
          practiceQuizData: 'Q',
          inClassQuizData: [
            { question: 'q', correctAnswer: 'a', correctFeedback: 'f', distractors: [] },
          ],
          weeklyChallengeData: { questions: [] } as unknown as GeneratedChapter['weeklyChallengeData'],
          slidesJson: [{ title: 't', body: 'b' }] as unknown as GeneratedChapter['slidesJson'],
          audioUrl: 'blob:audio',
          discussionData: [{ prompt: 'p', hook: 'h' }],
        }),
      ],
    });
    renderPage();

    expect(screen.getByText(/all artifacts ready/i)).toBeInTheDocument();
  });

  it('offers learning-outcomes generation, which replaces the old alignment-matrix card', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();

    expect(screen.getByRole('button', { name: /generate learning outcomes/i })).toBeInTheDocument();
  });

  it('lets a user click the Reading row without crashing (smoke check on the download handler)', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({
      syllabus: makeSyllabus(1),
      chapters: [makeChapter({ number: 1, title: 'Chapter 1' })],
    });
    renderPage();

    await user.click(screen.getByRole('button', { name: /^reading/i }));
    // No assertion needed — we're verifying the click doesn't throw.
  });

  describe('Export for Canvas — slide decks', () => {
    const unrendered = [
      { title: 'A', speakerNotes: '', bullets: [], imagePrompt: 'a' },
      { title: 'B', speakerNotes: '', bullets: [], imagePrompt: 'b' },
    ] as unknown as GeneratedChapter['slidesJson'];

    function seed(slidesJson?: GeneratedChapter['slidesJson']) {
      useCourseStore.setState({
        syllabus: makeSyllabus(1),
        chapters: [makeChapter({ number: 1, title: 'Chapter 1', slidesJson })],
      });
    }

    it('exports straight away when there are no unrendered decks', async () => {
      const user = userEvent.setup();
      seed(undefined);
      renderPage();

      await user.click(screen.getByRole('button', { name: /export for canvas/i }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(assembleImscc).toHaveBeenCalledTimes(1));
      expect(vi.mocked(assembleImscc).mock.calls[0][2]).toMatchObject({ renderMissingSlides: false });
    });

    it('asks before rendering when decks have unrendered images and a key is set', async () => {
      const user = userEvent.setup();
      useApiStore.setState({ openaiApiKey: 'sk-openai' });
      seed(unrendered);
      renderPage();

      await user.click(screen.getByRole('button', { name: /export for canvas/i }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(/2 images/i);
      expect(assembleImscc).not.toHaveBeenCalled();
      expect(within(dialog).getByRole('button', { name: /render & include decks/i })).toBeInTheDocument();
    });

    it('"Export without decks" exports without opting in to rendering', async () => {
      const user = userEvent.setup();
      useApiStore.setState({ openaiApiKey: 'sk-openai' });
      seed(unrendered);
      renderPage();

      await user.click(screen.getByRole('button', { name: /export for canvas/i }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /export without decks/i }));

      await waitFor(() => expect(assembleImscc).toHaveBeenCalledTimes(1));
      expect(vi.mocked(assembleImscc).mock.calls[0][2]).toMatchObject({ renderMissingSlides: false });
    });

    it('"Render & include decks" opts in and passes the OpenAI key', async () => {
      const user = userEvent.setup();
      useApiStore.setState({ openaiApiKey: 'sk-openai' });
      seed(unrendered);
      renderPage();

      await user.click(screen.getByRole('button', { name: /export for canvas/i }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /render & include decks/i }));

      await waitFor(() => expect(assembleImscc).toHaveBeenCalledTimes(1));
      expect(vi.mocked(assembleImscc).mock.calls[0][2]).toMatchObject({
        renderMissingSlides: true,
        openaiApiKey: 'sk-openai',
      });
    });

    it('without an OpenAI key the dialog only offers to export without decks', async () => {
      const user = userEvent.setup();
      useApiStore.setState({ openaiApiKey: '' });
      seed(unrendered);
      renderPage();

      await user.click(screen.getByRole('button', { name: /export for canvas/i }));
      const dialog = await screen.findByRole('dialog');

      expect(within(dialog).queryByRole('button', { name: /render & include decks/i })).not.toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /export without decks/i })).toBeInTheDocument();
    });

    it('cancelling the dialog exports nothing', async () => {
      const user = userEvent.setup();
      useApiStore.setState({ openaiApiKey: 'sk-openai' });
      seed(unrendered);
      renderPage();

      await user.click(screen.getByRole('button', { name: /export for canvas/i }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

      expect(assembleImscc).not.toHaveBeenCalled();
    });
  });
});
