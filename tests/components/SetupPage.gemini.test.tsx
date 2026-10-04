import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SetupPage } from '../../src/pages/SetupPage';
import { useCourseStore } from '../../src/store/courseStore';
import { useApiStore } from '../../src/store/apiStore';
import { useUiStore } from '../../src/store/uiStore';
import { DEFAULT_GEMINI_MODEL } from '../../src/services/llm/models';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const TOPIC = 'Cognitive Load Theory and how working memory shapes good teaching.';

function renderPage() {
  return render(
    <MemoryRouter>
      <SetupPage />
    </MemoryRouter>,
  );
}

function resetStores() {
  navigateMock.mockClear();
  useCourseStore.getState().reset();
  useUiStore.setState({ openKeysOnNextSetupVisit: false });
  useApiStore.setState({
    provider: 'anthropic',
    researchBackend: 'anthropic',
    advancedMode: false,
    claudeApiKey: '',
    claudeKeyValid: null,
    ollamaApiKey: '',
    ollamaKeyValid: null,
    geminiApiKey: '',
    geminiModel: DEFAULT_GEMINI_MODEL,
    geminiKeyValid: null,
    tavilyApiKey: '',
  });
}

describe('<SetupPage /> — Gemini as a course-content provider', () => {
  beforeEach(resetStores);
  afterEach(() => vi.unstubAllGlobals());

  describe('Begin gating follows the ACTIVE provider\'s key', () => {
    it('a Claude key does not satisfy a Gemini user, and the message names Gemini', () => {
      useCourseStore.getState().updateSetup({ topic: TOPIC });
      useApiStore.setState({ provider: 'gemini', claudeApiKey: 'sk-ant-x', geminiApiKey: '' });
      renderPage();

      expect(screen.getByText(/add your gemini key to continue/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /begin · syllabus/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /add gemini key/i })).toBeInTheDocument();
    });

    it('a Gemini key alone is enough, with no Claude key at all', () => {
      useCourseStore.getState().updateSetup({ topic: TOPIC });
      useApiStore.setState({ provider: 'gemini', claudeApiKey: '', geminiApiKey: 'AIza-x' });
      renderPage();

      expect(screen.getByRole('button', { name: /begin · syllabus/i })).toBeEnabled();
    });

    it('warns when the Gemini key failed verification', () => {
      useCourseStore.getState().updateSetup({ topic: TOPIC });
      useApiStore.setState({ provider: 'gemini', geminiApiKey: 'AIza-bad', geminiKeyValid: false });
      renderPage();

      expect(screen.getByText(/your gemini key failed verification/i)).toBeInTheDocument();
    });
  });

  describe('API keys dialog', () => {
    async function openModal() {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /set keys|manage keys/i }));
      const dialog = await screen.findByRole('dialog');
      return { user, dialog };
    }

    it('offers Gemini as a third provider and selecting it switches the store', async () => {
      const { user, dialog } = await openModal();
      // ("Claude" also prefixes the "Claude search" research pill, hence getAll.)
      expect(within(dialog).getAllByRole('button', { name: /^claude/i }).length).toBeGreaterThanOrEqual(1);
      expect(within(dialog).getByRole('button', { name: /^ollama cloud/i })).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: /^gemini/i }));

      expect(useApiStore.getState().provider).toBe('gemini');
    });

    it('shows the model field only for the Gemini provider, defaulting to the default model', async () => {
      const { user, dialog } = await openModal();
      expect(within(dialog).queryByLabelText(/gemini model/i)).not.toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: /^gemini/i }));

      expect(within(dialog).getByLabelText(/gemini model/i)).toHaveValue(DEFAULT_GEMINI_MODEL);
    });

    it('labels the Gemini key required only when Gemini is the provider', async () => {
      const { user, dialog } = await openModal();
      expect(within(dialog).getByLabelText(/gemini · optional/i)).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: /^gemini/i }));

      expect(within(dialog).getByLabelText(/gemini · required/i)).toBeInTheDocument();
    });

    it('keeps focus while typing the key and a custom model (the modal must not steal focus)', async () => {
      const { user, dialog } = await openModal();
      await user.click(within(dialog).getByRole('button', { name: /^gemini/i }));

      await user.type(within(dialog).getByLabelText(/gemini · required/i), 'AIza-typed-key');
      const model = within(dialog).getByLabelText(/gemini model/i);
      await user.clear(model);
      await user.type(model, 'gemini-3.1-pro-preview');

      expect(useApiStore.getState().geminiApiKey).toBe('AIza-typed-key');
      expect(useApiStore.getState().geminiModel).toBe('gemini-3.1-pro-preview');
    });

    it('Verify checks the chosen model with the key in a header, not the URL, and shows ✓ on success', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      useApiStore.setState({ provider: 'gemini', geminiApiKey: 'AIza-good', geminiModel: 'gemini-test-model' });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /manage keys/i }));
      const dialog = await screen.findByRole('dialog');
      fetchMock.mockClear(); // ignore the automatic check on open

      await user.click(within(dialog).getByRole('button', { name: /^verify$/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model');
      expect(url).not.toContain('AIza-good');
      expect(init.headers['x-goog-api-key']).toBe('AIza-good');
      await waitFor(() => expect(useApiStore.getState().geminiKeyValid).toBe(true));
      expect(await within(dialog).findByText(/✓ verified/i)).toBeInTheDocument();
    });

    it('marks the key failed when Google rejects it (bad key or unknown model)', async () => {
      const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
      vi.stubGlobal('fetch', fetchMock);
      useApiStore.setState({ provider: 'gemini', geminiApiKey: 'AIza-x', geminiModel: 'no-such-model' });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /manage keys/i }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: /^verify$/i }));

      await waitFor(() => expect(useApiStore.getState().geminiKeyValid).toBe(false));
      expect(await within(dialog).findByText(/✗ failed/i)).toBeInTheDocument();
    });

    it('treats a network failure as failed, not as a crash', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
      useApiStore.setState({ provider: 'gemini', geminiApiKey: 'AIza-x' });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /manage keys/i }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: /^verify$/i }));

      await waitFor(() => expect(useApiStore.getState().geminiKeyValid).toBe(false));
    });

    it('editing the model invalidates an earlier "verified" status', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
      useApiStore.setState({ provider: 'gemini', geminiApiKey: 'AIza-x', geminiKeyValid: true });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /manage keys/i }));
      const dialog = await screen.findByRole('dialog');

      await user.type(within(dialog).getByLabelText(/gemini model/i), 'x');

      expect(useApiStore.getState().geminiKeyValid).toBeNull();
    });

    it('does not disturb the other providers\' fields', async () => {
      useApiStore.setState({ claudeApiKey: 'sk-ant-keep', ollamaApiKey: 'ollama-keep' });
      const { user, dialog } = await openModal();

      await user.click(within(dialog).getByRole('button', { name: /^gemini/i }));
      await user.type(within(dialog).getByLabelText(/gemini · required/i), 'AIza-1');

      expect(useApiStore.getState().claudeApiKey).toBe('sk-ant-keep');
      expect(useApiStore.getState().ollamaApiKey).toBe('ollama-keep');
    });
  });
});
