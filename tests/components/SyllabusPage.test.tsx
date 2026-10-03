import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SyllabusPage } from '../../src/pages/SyllabusPage';
import { useCourseStore } from '../../src/store/courseStore';
import { useApiStore } from '../../src/store/apiStore';
import { useUiStore } from '../../src/store/uiStore';
import type { Syllabus } from '../../src/types/course';

// streamMessage is the auto-firing effect on mount when there's no syllabus +
// a Claude key. We stub it so tests don't accidentally hit the network and so
// the streaming state machine stays inert.
vi.mock('../../src/services/claude/streaming', () => ({
  streamMessage: vi.fn(() => new Promise(() => {})),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function makeSyllabus(numChapters: number, overviewSentences = 1): Syllabus {
  const overview = Array.from({ length: overviewSentences }, (_, i) => `Sentence ${i + 1}.`).join(' ');
  return {
    courseTitle: 'Intro to Statistics',
    courseOverview: overview,
    chapters: Array.from({ length: numChapters }, (_, i) => ({
      number: i + 1,
      title: `Chapter ${i + 1}`,
      narrative: 'Narrative.',
      keyConcepts: ['mean', 'median'],
      widgets: [],
      scienceAnnotations: [],
      spacingConnections: [],
    })),
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SyllabusPage />
    </MemoryRouter>,
  );
}

describe('<SyllabusPage />', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    useCourseStore.getState().reset();
    useUiStore.setState({
      error: null,
      isGenerating: false,
      showScienceOverlay: false,
    });
    // No claude key → the auto-generate effect doesn't fire, so we can test
    // empty/render states without the streaming state machine spinning up.
    useApiStore.setState({ claudeApiKey: '' });
  });

  it('shows the drafting placeholder when no syllabus has arrived yet', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /drafting your syllabus/i })).toBeInTheDocument();
  });

  it('renders the course title and overview once a syllabus is loaded', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(3) });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Intro to Statistics' })).toBeInTheDocument();
    expect(screen.getByText(/sentence 1\./i)).toBeInTheDocument();
  });

  it('renders chapter rows from the syllabus', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(4) });
    renderPage();

    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Chapter 4')).toBeInTheDocument();
  });

  it('disables "Begin research" when no syllabus is loaded yet', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /begin research/i })).toBeDisabled();
  });

  it('enables "Begin research" once the syllabus is in the store', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();
    expect(screen.getByRole('button', { name: /begin research/i })).toBeEnabled();
  });

  it('navigates to /research and advances the stage when "Begin research" is clicked', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();

    await user.click(screen.getByRole('button', { name: /begin research/i }));

    expect(navigateMock).toHaveBeenCalledWith('/research');
    expect(useCourseStore.getState().completedStages).toContain('syllabus');
    expect(useCourseStore.getState().currentStage).toBe('research');
  });

  it('"Edit brief" goes back to the setup page', async () => {
    const user = userEvent.setup();
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();

    await user.click(screen.getByRole('button', { name: /edit brief/i }));

    expect(navigateMock).toHaveBeenCalledWith('/setup');
  });

  it('offers inline editing on drafted chapters', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    renderPage();

    expect(screen.getAllByRole('button', { name: /edit/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('renders the full course overview', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2, 5) });
    renderPage();

    expect(screen.getByText(/sentence 1\./i)).toBeInTheDocument();
    expect(screen.getByText(/sentence 5\./i)).toBeInTheDocument();
  });

  it('shows the Canvas template title editor only when a template is active', () => {
    useCourseStore.setState({ syllabus: makeSyllabus(2) });
    const { unmount } = renderPage();
    expect(screen.queryByText(/template chapter titles/i)).not.toBeInTheDocument();
    unmount();

    useCourseStore.getState().updateSetup({ templateId: 'tpl-1' });
    renderPage();
    expect(screen.getByText(/template chapter titles/i)).toBeInTheDocument();
  });

  it('renders an error banner with a "Try again" link when ui.error is set', () => {
    useUiStore.setState({ error: 'Model returned malformed JSON.' });
    renderPage();

    expect(screen.getByText(/model returned malformed json/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
