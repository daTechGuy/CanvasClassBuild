import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CourseOutlineUpload } from '../../src/components/setup/CourseOutlineUpload';
import { useCourseStore } from '../../src/store/courseStore';
import { useApiStore } from '../../src/store/apiStore';

describe('<CourseOutlineUpload />', () => {
  beforeEach(() => {
    useCourseStore.getState().reset();
    // The component reads claudeApiKey to gate uploads; provide one so any
    // tests that exercise the gate work the same way as the running app.
    useApiStore.getState().setClaudeApiKey('sk-test');
  });

  it('renders the upload section with the file input visible', () => {
    render(<CourseOutlineUpload />);
    expect(screen.getByRole('heading', { name: /course outline/i })).toBeInTheDocument();
    // The file input doesn't have a name attribute, but it's the only one.
    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs).toHaveLength(1);
  });

  it('does not show extracted-fields preview when no outline has been parsed', () => {
    render(<CourseOutlineUpload />);
    expect(screen.queryByText(/extracted fields/i)).not.toBeInTheDocument();
  });

  it('shows extracted-fields preview when outlineFields are populated', () => {
    useCourseStore.getState().setOutlineFields({
      courseTitle: 'Test Title',
      courseDescription: 'Test description',
      courseInformation: '3 credits',
      courseMaterials: 'Bring laptop',
    });
    render(<CourseOutlineUpload />);
    expect(screen.getByText(/extracted fields/i)).toBeInTheDocument();
    expect(screen.getByText(/4 of 4 found/i)).toBeInTheDocument();
  });

  it('shows a "Clear" button when outlineFields are present and clearing resets the store', async () => {
    const user = userEvent.setup();
    useCourseStore.getState().setOutlineFields({ courseTitle: 'X' });
    render(<CourseOutlineUpload />);

    const clear = screen.getByRole('button', { name: /clear/i });
    await user.click(clear);

    expect(useCourseStore.getState().outlineFields).toBeNull();
  });

  it('updating a field textarea writes back to the store', async () => {
    const user = userEvent.setup();
    useCourseStore.getState().setOutlineFields({ courseTitle: 'Original' });
    render(<CourseOutlineUpload />);

    // Expand the preview so the textareas render
    const summary = screen.getByRole('button', { name: /extracted fields/i });
    await user.click(summary);

    const titleArea = screen.getByPlaceholderText(/no course title/i) as HTMLTextAreaElement;
    expect(titleArea.value).toBe('Original');

    await user.clear(titleArea);
    await user.type(titleArea, 'Updated');

    expect(useCourseStore.getState().outlineFields?.courseTitle).toBe('Updated');
  });

  it('clearing a field via textarea deletes the key from outlineFields', async () => {
    const user = userEvent.setup();
    useCourseStore
      .getState()
      .setOutlineFields({ courseTitle: 'X', courseDescription: 'Y' });
    render(<CourseOutlineUpload />);

    const summary = screen.getByRole('button', { name: /extracted fields/i });
    await user.click(summary);

    const titleArea = screen.getByPlaceholderText(/no course title/i) as HTMLTextAreaElement;
    await user.clear(titleArea);

    expect(useCourseStore.getState().outlineFields?.courseTitle).toBeUndefined();
    // Other fields are unaffected
    expect(useCourseStore.getState().outlineFields?.courseDescription).toBe('Y');
  });
});
