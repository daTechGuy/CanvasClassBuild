import DOMPurify from 'dompurify';
import { ArtifactShell } from '../ArtifactShell';
import { ArtifactStatusLine, ArtifactEmpty } from '../artifactHelpers';
import { CodexButton } from '../../codex';
import type { TemplateChapterContent } from '../../../types/course';

export interface TemplateModuleTabProps {
  chapterNum: number;
  content: TemplateChapterContent | undefined;
  isGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  /** Cancels the in-flight generation this tab reports on. */
  onStop: () => void;
  elapsedLabel?: string;
}

const proseStyle = {
  fontFamily: 'var(--font-cb-serif)',
  fontSize: 15,
  lineHeight: 1.6,
  color: 'var(--cb-text-default)',
} as const;

const labelStyle = {
  fontSize: 13,
  letterSpacing: '0.12em',
  color: 'var(--cb-text-muted)',
  marginBottom: 8,
} as const;

const cardStyle = {
  background: 'var(--cb-ground-page)',
  border: '1px solid var(--cb-border-default)',
  borderRadius: 2,
  padding: 16,
} as const;

export function TemplateModuleTab({
  chapterNum,
  content,
  isGenerating,
  canGenerate,
  onGenerate,
  onStop,
  elapsedLabel,
}: TemplateModuleTabProps) {
  if (!content) {
    if (isGenerating) {
      return (
        <ArtifactStatusLine onStop={onStop}>
          Drafting the Canvas module for class {chapterNum}
          {elapsedLabel ? ` · ${elapsedLabel}` : ''}
        </ArtifactStatusLine>
      );
    }
    return (
      <ArtifactEmpty
        kicker="Canvas module"
        title="Overview, instructor notes, discussion"
        body="One Module Overview page, one or more Instructor Notes pages, and one Discussion — written to slot into your Canvas template. The locked page-title prefixes are kept verbatim."
        cta="Generate Canvas module"
        onCta={onGenerate}
        disabled={!canGenerate}
      />
    );
  }

  const noteCount = content.instructorNotes.length;

  return (
    <ArtifactShell
      kicker="Canvas module"
      title={`Module ${chapterNum}`}
      meta={`Overview · ${noteCount} instructor note${noteCount === 1 ? '' : 's'} · 1 discussion`}
      actions={
        <CodexButton
          size="sm"
          variant="secondary"
          onClick={onGenerate}
          disabled={!canGenerate || isGenerating}
        >
          {isGenerating ? 'Regenerating…' : 'Regenerate'}
        </CodexButton>
      }
      foot={
        <span className="cb-italic" style={{ fontSize: 13, color: 'var(--cb-text-muted)' }}>
          The locked <code>M{chapterNum} Instructor Notes:</code> /{' '}
          <code>M{chapterNum} Discussion:</code> prefixes are applied on export.
        </span>
      }
    >
      <div style={{ display: 'grid', gap: 24 }}>
        <section>
          <div className="cb-sc" style={labelStyle}>
            Module {chapterNum} Overview
          </div>
          <div
            style={{ ...cardStyle, ...proseStyle }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.moduleOverviewHtml) }}
          />
        </section>

        <section>
          <div className="cb-sc" style={labelStyle}>
            Instructor Notes ({noteCount} page{noteCount === 1 ? '' : 's'})
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {content.instructorNotes.map((note, i) => (
              <details key={i} open={i === 0} style={cardStyle}>
                <summary style={{ cursor: 'pointer', ...proseStyle }}>
                  <code style={{ color: 'var(--cb-accent-emphasis)' }}>
                    M{chapterNum} Instructor Notes:
                  </code>{' '}
                  {note.title}
                </summary>
                <div
                  style={{ ...proseStyle, marginTop: 12 }}
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.htmlContent) }}
                />
              </details>
            ))}
          </div>
        </section>

        <section>
          <div className="cb-sc" style={labelStyle}>
            Discussion
          </div>
          <div style={cardStyle}>
            <p style={{ ...proseStyle, margin: '0 0 10px' }}>
              <code style={{ color: 'var(--cb-accent-emphasis)' }}>
                M{chapterNum} Discussion:
              </code>{' '}
              <strong>{content.discussion.title}</strong>
            </p>
            <div
              style={proseStyle}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.discussion.promptHtml) }}
            />
          </div>
        </section>
      </div>
    </ArtifactShell>
  );
}
