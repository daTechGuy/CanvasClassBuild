import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TemplateModuleTab } from '../../src/components/build/tabs/TemplateModuleTab';
import type { TemplateChapterContent } from '../../src/types/course';

describe('<TemplateModuleTab />', () => {
  const dummyContent: TemplateChapterContent = {
    chapterNumber: 1,
    chapterTitle: 'Introduction',
    moduleOverviewHtml: '<p>Overview safe content</p><script>alert("xss")</script>',
    instructorNotes: [
      {
        title: 'Note 1',
        htmlContent: '<p>Note safe</p><img src="x" onerror="alert(1)" />',
      },
    ],
    discussion: {
      title: 'Discussion 1',
      promptHtml: '<p>Prompt safe</p><a href="javascript:alert(2)">link</a>',
    },
  };

  it('sanitizes malicious tags and attributes while retaining safe markup', () => {
    const { container } = render(
      <TemplateModuleTab
        chapterNum={1}
        content={dummyContent}
        isGenerating={false}
        canGenerate={true}
        onGenerate={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    // <script> is stripped
    expect(container.querySelector('script')).toBeNull();

    // onerror attribute is stripped from <img>
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('onerror')).toBeNull();

    // javascript: is stripped from href
    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBeNull();

    // Safe textual and HTML content is preserved
    expect(container.textContent).toContain('Overview safe content');
    expect(container.textContent).toContain('Note safe');
    expect(container.textContent).toContain('Prompt safe');
  });
});

