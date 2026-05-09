import { useRef, useState } from 'react';
import { useCourseStore } from '../../store/courseStore';
import { useApiStore } from '../../store/apiStore';
import { docxToText, extractOutlineFields } from '../../services/template/parseOutlineDocx';
import { Button } from '../shared/Button';
import { friendlyError } from '../../utils/errors';
import type { OutlineFields } from '../../types/outline';

const FIELD_LABELS: Record<keyof OutlineFields, string> = {
  courseTitle: 'Course title',
  courseDescription: 'Course description',
  courseInformation: 'Course information',
  courseMaterials: 'Course materials',
};

const FIELD_HINTS: Record<keyof OutlineFields, string> = {
  courseTitle: 'Becomes the Canvas course title in the Begin Here homepage.',
  courseDescription: 'Short paragraph that goes into the syllabus body.',
  courseInformation: 'Credits, prerequisites, instructor, format, etc.',
  courseMaterials: 'Required textbooks, software, supplies.',
};

export function CourseOutlineUpload() {
  const { outlineFields, outlineRawText, setOutlineFields, setOutlineRawText } = useCourseStore();
  const { provider, claudeApiKey, ollamaApiKey } = useApiStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const llmKey = provider === 'ollama' ? ollamaApiKey : claudeApiKey;

  const handleFile = async (file: File) => {
    if (!llmKey.trim()) {
      setError('Add an API key (Claude or Ollama) before uploading — the outline is parsed by the active LLM provider.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const rawText = await docxToText(file);
      setOutlineRawText(rawText);
      const result = await extractOutlineFields({ apiKey: llmKey, rawText });
      setOutlineFields(result.fields);
      setOpen(true);
    } catch (err) {
      setError(friendlyError(err, 'Could not parse the course outline.'));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateField = (key: keyof OutlineFields, value: string) => {
    const next: OutlineFields = { ...(outlineFields ?? {}), [key]: value || undefined };
    if (!value) delete next[key];
    setOutlineFields(next);
  };

  const clear = () => {
    setOutlineFields(null);
    setOutlineRawText(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-1">Course outline (optional)</h3>
          <p className="text-xs text-text-muted">
            Upload a .docx course outline and the active LLM will pull out the title, description, course information, and materials. These populate the Begin Here homepage at export time.
          </p>
        </div>
        {outlineFields && (
          <Button variant="ghost" size="sm" onClick={clear} className="text-error/80 hover:!text-error">
            Clear
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          disabled={busy}
          className="block text-sm text-text-secondary file:mr-4 file:px-4 file:py-2 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-violet-500/15 file:text-violet-300 hover:file:bg-violet-500/25 file:cursor-pointer"
        />
        {busy && <span className="text-xs text-violet-400">Parsing & extracting fields…</span>}
      </div>

      {error && <p className="text-xs text-error">{error}</p>}

      {outlineFields && (
        <div className="rounded-lg border border-violet-500/15 bg-bg-base">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-violet-500/5 transition-colors"
          >
            <span className="text-text-primary">
              Extracted fields{' '}
              <span className="text-text-muted text-xs">
                ({Object.values(outlineFields).filter(Boolean).length} of 4 found)
              </span>
            </span>
            <svg
              className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {open && (
            <div className="border-t border-violet-500/10 p-4 space-y-4">
              {(Object.keys(FIELD_LABELS) as Array<keyof OutlineFields>).map((key) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    {FIELD_LABELS[key]}
                  </label>
                  <p className="text-[10px] text-text-muted mb-1.5">{FIELD_HINTS[key]}</p>
                  <textarea
                    value={outlineFields[key] ?? ''}
                    onChange={(e) => updateField(key, e.target.value)}
                    rows={key === 'courseTitle' ? 1 : 3}
                    placeholder={`No ${FIELD_LABELS[key].toLowerCase()} extracted — paste manually if needed.`}
                    className="w-full rounded-md bg-bg-card border border-violet-500/10 px-3 py-2 text-sm focus:outline-none focus:border-violet-500/40 resize-y"
                  />
                </div>
              ))}
              {outlineRawText && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-text-muted hover:text-text-secondary">Raw extracted text ({outlineRawText.length.toLocaleString()} chars)</summary>
                  <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-text-muted/80 bg-bg-card rounded-md p-2 font-mono text-[11px] leading-relaxed">
                    {outlineRawText.slice(0, 4000)}
                    {outlineRawText.length > 4000 ? '\n…' : ''}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
