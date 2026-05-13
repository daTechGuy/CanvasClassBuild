import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateTitleEditor } from '../../src/components/syllabus/TemplateTitleEditor';
import type { Syllabus, ChapterSyllabus } from '../../src/types/course';

function makeChapter(num: number, title: string): ChapterSyllabus {
  return {
    number: num,
    title,
    narrative: '',
    keyConcepts: [],
    widgets: [],
    scienceAnnotations: [],
    spacingConnections: [],
  };
}

function makeSyllabus(chapters: ChapterSyllabus[]): Syllabus {
  return { courseTitle: 'Test', courseOverview: '', chapters };
}

describe('<TemplateTitleEditor />', () => {
  it('shows each chapter with its locked prefix + editable suffix when expanded', async () => {
    const user = userEvent.setup();
    const syllabus = makeSyllabus([
      makeChapter(1, 'Module 1: Introduction'),
      makeChapter(2, 'Module 2: Data Frames'),
    ]);

    render(<TemplateTitleEditor syllabus={syllabus} setSyllabus={() => {}} />);

    // Expand the editor
    await user.click(screen.getByRole('button', { name: /template chapter titles/i }));

    // Prefix labels visible
    const prefixes = screen.getAllByText(/Module \d+:/);
    expect(prefixes.length).toBeGreaterThanOrEqual(2);

    // Each chapter's suffix in its input
    expect(screen.getByDisplayValue('Introduction')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Data Frames')).toBeInTheDocument();
  });

  it('saving a renamed suffix reassembles the title with the locked prefix intact', async () => {
    const user = userEvent.setup();
    const syllabus = makeSyllabus([
      makeChapter(1, 'Module 1: Introduction'),
      makeChapter(2, 'Module 2: Data Frames'),
    ]);
    const setSyllabus = vi.fn();

    render(<TemplateTitleEditor syllabus={syllabus} setSyllabus={setSyllabus} />);

    await user.click(screen.getByRole('button', { name: /template chapter titles/i }));

    const introInput = screen.getByDisplayValue('Introduction') as HTMLInputElement;
    await user.clear(introInput);
    await user.type(introInput, 'Welcome to Stats');

    await user.click(screen.getByRole('button', { name: /^save titles$/i }));

    expect(setSyllabus).toHaveBeenCalledTimes(1);
    const updated = setSyllabus.mock.calls[0][0] as Syllabus;
    expect(updated.chapters[0].title).toBe('Module 1: Welcome to Stats');
    // The other chapter's title is preserved verbatim
    expect(updated.chapters[1].title).toBe('Module 2: Data Frames');
  });

  it('preserves the locked prefix even if the instructor blanks the suffix', async () => {
    const user = userEvent.setup();
    const syllabus = makeSyllabus([makeChapter(1, 'Module 1: Introduction')]);
    const setSyllabus = vi.fn();

    render(<TemplateTitleEditor syllabus={syllabus} setSyllabus={setSyllabus} />);

    await user.click(screen.getByRole('button', { name: /template chapter titles/i }));

    const input = screen.getByDisplayValue('Introduction') as HTMLInputElement;
    await user.clear(input);

    await user.click(screen.getByRole('button', { name: /^save titles$/i }));

    const updated = setSyllabus.mock.calls[0][0] as Syllabus;
    // Empty suffix collapses to just the locked prefix — never strips it
    expect(updated.chapters[0].title).toBe('Module 1:');
  });

  it('synthesizes a Module N: prefix for chapters whose title does not match the pattern', async () => {
    const user = userEvent.setup();
    const syllabus = makeSyllabus([
      makeChapter(1, 'Some Off-Pattern Title'),
    ]);
    const setSyllabus = vi.fn();

    render(<TemplateTitleEditor syllabus={syllabus} setSyllabus={setSyllabus} />);

    await user.click(screen.getByRole('button', { name: /template chapter titles/i }));

    // The whole off-pattern title becomes the suffix under a synthesized prefix
    const input = screen.getByDisplayValue('Some Off-Pattern Title') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'A New Topic');

    await user.click(screen.getByRole('button', { name: /^save titles$/i }));

    const updated = setSyllabus.mock.calls[0][0] as Syllabus;
    expect(updated.chapters[0].title).toBe('Module 1: A New Topic');
  });

  it('Reset rolls drafts back to the original suffixes', async () => {
    const user = userEvent.setup();
    const syllabus = makeSyllabus([makeChapter(1, 'Module 1: Introduction')]);
    const setSyllabus = vi.fn();

    render(<TemplateTitleEditor syllabus={syllabus} setSyllabus={setSyllabus} />);

    await user.click(screen.getByRole('button', { name: /template chapter titles/i }));

    const input = screen.getByDisplayValue('Introduction') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Changed');
    expect(input.value).toBe('Changed');

    await user.click(screen.getByRole('button', { name: /^reset$/i }));

    // Draft is back to the original — and Save is disabled (no dirty drafts).
    expect(input.value).toBe('Introduction');
    expect(setSyllabus).not.toHaveBeenCalled();
  });
});
