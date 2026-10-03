import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SetupPage } from '../../src/pages/SetupPage';
import { useCourseStore } from '../../src/store/courseStore';
import { useApiStore } from '../../src/store/apiStore';
import { useUiStore } from '../../src/store/uiStore';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <SetupPage />
    </MemoryRouter>,
  );
}

const TOPIC = 'Cognitive Load Theory and how working memory shapes good teaching.';

describe('<SetupPage /> provider / key gating', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    useCourseStore.getState().reset();
    useUiStore.setState({ openKeysOnNextSetupVisit: false });
    useApiStore.setState({
      provider: 'anthropic',
      researchBackend: 'anthropic',
      advancedMode: false,
      claudeApiKey: '',
      ollamaApiKey: '',
      tavilyApiKey: '',
      claudeKeyValid: null,
      ollamaKeyValid: null,
    });
  });

  it('asks for a topic and an Anthropic key, and disables Begin, when both are missing', () => {
    renderPage();

    expect(screen.getByText(/add a course topic and your anthropic key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /begin · syllabus/i })).toBeDisabled();
  });

  it('enables Begin once there is a topic and a Claude key (Claude provider)', () => {
    useCourseStore.getState().updateSetup({ topic: TOPIC });
    useApiStore.setState({ claudeApiKey: 'sk-ant-x' });
    renderPage();

    expect(screen.getByRole('button', { name: /begin · syllabus/i })).toBeEnabled();
  });

  it('gates Begin on the Ollama key when Ollama is the active provider', () => {
    useCourseStore.getState().updateSetup({ topic: TOPIC });
    // A Claude key alone is not enough on the Ollama provider.
    useApiStore.setState({ provider: 'ollama', claudeApiKey: 'sk-ant-x', ollamaApiKey: '' });
    const { unmount } = renderPage();

    expect(screen.getByText(/add your ollama key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /begin · syllabus/i })).toBeDisabled();
    unmount();

    useApiStore.setState({ ollamaApiKey: 'ollama-key' });
    renderPage();
    expect(screen.getByRole('button', { name: /begin · syllabus/i })).toBeEnabled();
  });

  it('clicking Begin completes setup and navigates to the syllabus', async () => {
    const user = userEvent.setup();
    useCourseStore.getState().updateSetup({ topic: TOPIC });
    useApiStore.setState({ claudeApiKey: 'sk-ant-x' });
    renderPage();

    await user.click(screen.getByRole('button', { name: /begin · syllabus/i }));

    expect(navigateMock).toHaveBeenCalledWith('/syllabus');
    expect(useCourseStore.getState().completedStages).toContain('setup');
  });

  it('shows the optional Canvas template + outline section', () => {
    renderPage();
    expect(screen.getByText(/canvas template · optional/i)).toBeInTheDocument();
  });
});

describe('<SetupPage /> API keys modal', () => {
  beforeEach(() => {
    // Opening the modal auto-validates any stored key — keep that off the network.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    useCourseStore.getState().reset();
    useUiStore.setState({ openKeysOnNextSetupVisit: false });
    useApiStore.setState({
      provider: 'anthropic',
      researchBackend: 'anthropic',
      advancedMode: false,
      claudeApiKey: '',
      ollamaApiKey: '',
      tavilyApiKey: '',
      ollamaModel: 'gpt-oss:120b-cloud',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openModal() {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /set keys/i }));
    const dialog = await screen.findByRole('dialog');
    return { user, dialog };
  }

  it('switches the course-content provider to Ollama Cloud', async () => {
    const { user, dialog } = await openModal();

    await user.click(within(dialog).getByRole('button', { name: /ollama cloud/i }));

    expect(useApiStore.getState().provider).toBe('ollama');
  });

  it('switches the research backend between Claude, Tavily and Wikipedia', async () => {
    const { user, dialog } = await openModal();

    await user.click(within(dialog).getByRole('button', { name: /^tavily/i }));
    expect(useApiStore.getState().researchBackend).toBe('tavily');

    await user.click(within(dialog).getByRole('button', { name: /^wikipedia/i }));
    expect(useApiStore.getState().researchBackend).toBe('wikipedia');

    await user.click(within(dialog).getByRole('button', { name: /^claude search/i }));
    expect(useApiStore.getState().researchBackend).toBe('anthropic');
  });

  it('toggles advanced build outputs', async () => {
    const { user, dialog } = await openModal();
    expect(useApiStore.getState().advancedMode).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: /^everything/i }));
    expect(useApiStore.getState().advancedMode).toBe(true);

    await user.click(within(dialog).getByRole('button', { name: /^canvas-focused/i }));
    expect(useApiStore.getState().advancedMode).toBe(false);
  });

  it('shows the Ollama model field only on the Ollama provider once a key is entered', async () => {
    useApiStore.setState({ provider: 'ollama', ollamaApiKey: 'ollama-key' });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /manage keys/i }));
    const dialog = await screen.findByRole('dialog');

    const model = within(dialog).getByLabelText(/ollama model/i);
    await user.clear(model);
    await user.type(model, 'qwen3-coder:480b-cloud');

    expect(useApiStore.getState().ollamaModel).toBe('qwen3-coder:480b-cloud');
  });

  it('keeps focus in a key field while typing (modal must not steal focus on re-render)', async () => {
    const { user, dialog } = await openModal();

    const claude = within(dialog).getByLabelText(/anthropic/i);
    await user.type(claude, 'sk-ant-abc');

    expect(useApiStore.getState().claudeApiKey).toBe('sk-ant-abc');
  });
});
