import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TemplatePicker } from '../../src/components/setup/TemplatePicker';
import { useCourseStore } from '../../src/store/courseStore';
import { useTemplateStore } from '../../src/store/templateStore';
import type { Template } from '../../src/types/template';

function makeTemplate(id: string, name: string): Template {
  return {
    id,
    parserVersion: 3,
    name,
    uploadedAt: new Date().toISOString(),
    fileSizeBytes: 1234,
    modules: [
      { identifier: 'm1', title: 'Begin Here', position: 1, workflowState: 'active', classification: 'verbatim', items: [] },
      { identifier: 'm2', title: 'Module 1:', position: 2, workflowState: 'active', classification: 'pattern', items: [], titleLockedPrefix: 'Module 1:', titleEditableSuffix: '' },
    ],
    images: [],
    ltiResources: [],
    courseSettings: {},
    totalFiles: 5,
  };
}

function renderPicker() {
  return render(
    <MemoryRouter>
      <TemplatePicker />
    </MemoryRouter>,
  );
}

describe('<TemplatePicker />', () => {
  beforeEach(() => {
    useCourseStore.getState().reset();
    useTemplateStore.setState({ templates: [], activeTemplateId: null });
  });

  it('shows an empty state with a link to /templates when no templates are uploaded', () => {
    renderPicker();
    expect(screen.getByText(/no templates uploaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload a canvas/i })).toBeInTheDocument();
  });

  it('lists uploaded templates as radio options', () => {
    useTemplateStore.setState({
      templates: [makeTemplate('t1', 'Stats Template'), makeTemplate('t2', 'Bio Template')],
      activeTemplateId: null,
    });
    renderPicker();

    expect(screen.getByText('Stats Template')).toBeInTheDocument();
    expect(screen.getByText('Bio Template')).toBeInTheDocument();
    // "No template" + 2 templates = 3 radio inputs
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('selecting a template sets templateId and bumps numChapters to 16', async () => {
    const user = userEvent.setup();
    useTemplateStore.setState({
      templates: [makeTemplate('t1', 'Stats Template')],
      activeTemplateId: null,
    });
    useCourseStore.getState().updateSetup({ numChapters: 12 });
    renderPicker();

    // Click the row label — radio gets toggled
    await user.click(screen.getByText('Stats Template'));

    expect(useCourseStore.getState().setup.templateId).toBe('t1');
    expect(useCourseStore.getState().setup.numChapters).toBe(16);
  });

  it('selecting "No template" clears templateId without touching numChapters', async () => {
    const user = userEvent.setup();
    useTemplateStore.setState({
      templates: [makeTemplate('t1', 'Stats Template')],
      activeTemplateId: 't1',
    });
    useCourseStore.getState().updateSetup({ templateId: 't1', numChapters: 16 });
    renderPicker();

    await user.click(screen.getByText(/no template/i));

    expect(useCourseStore.getState().setup.templateId).toBeUndefined();
    // numChapters stays where the instructor had it
    expect(useCourseStore.getState().setup.numChapters).toBe(16);
  });

  it('shows an "active template" notice when one is selected', () => {
    useTemplateStore.setState({
      templates: [makeTemplate('t1', 'Stats Template')],
      activeTemplateId: 't1',
    });
    useCourseStore.getState().updateSetup({ templateId: 't1' });
    renderPicker();

    expect(screen.getByText(/template active/i)).toBeInTheDocument();
    // The name appears in both the list row and the active-template notice.
    expect(screen.getAllByText(/Stats Template/).length).toBeGreaterThan(0);
  });
});
