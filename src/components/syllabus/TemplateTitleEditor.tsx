import { useMemo, useState } from 'react';
import type { Syllabus } from '../../types/course';
import { Button } from '../shared/Button';

interface TemplateTitleEditorProps {
  syllabus: Syllabus;
  setSyllabus: (s: Syllabus) => void;
}

const MODULE_PREFIX_RE = /^(Module\s+\d+:)\s*(.*)$/i;

interface ParsedTitle {
  index: number;
  prefix: string;
  suffix: string;
  raw: string;
}

function parseTitle(idx: number, title: string): ParsedTitle {
  const m = title.match(MODULE_PREFIX_RE);
  if (m) return { index: idx, prefix: m[1], suffix: (m[2] ?? '').trim(), raw: title };
  // Title doesn't conform to template format — treat the whole thing as a
  // suffix under a synthesized `Module N:` prefix so the editor can still
  // normalize it on save.
  return { index: idx, prefix: `Module ${idx + 1}:`, suffix: title, raw: title };
}

export function TemplateTitleEditor({ syllabus, setSyllabus }: TemplateTitleEditorProps) {
  const initialParsed = useMemo<ParsedTitle[]>(
    () => syllabus.chapters.map((c, i) => parseTitle(i, c.title)),
    [syllabus],
  );

  const [drafts, setDrafts] = useState<string[]>(initialParsed.map((p) => p.suffix));
  const [open, setOpen] = useState(false);

  const dirty = drafts.some((s, i) => s !== initialParsed[i].suffix);

  const reset = () => setDrafts(initialParsed.map((p) => p.suffix));

  const save = () => {
    const updated: Syllabus = {
      ...syllabus,
      chapters: syllabus.chapters.map((ch, i) => {
        const prefix = initialParsed[i].prefix;
        const suffix = drafts[i].trim();
        const title = suffix ? `${prefix} ${suffix}` : prefix;
        return { ...ch, title };
      }),
    };
    setSyllabus(updated);
  };

  return (
    <div className="mb-8 rounded-xl border border-violet-500/15 bg-bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-violet-500/5 transition-colors"
      >
        <div>
          <h3 className="text-sm font-medium text-text-primary">
            Template chapter titles
          </h3>
          <p className="text-xs text-text-muted">
            <code className="text-violet-300">Module N:</code> prefix is locked. Edit the topic suffix per chapter — leave blank to keep just the locked prefix.
          </p>
        </div>
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
        <div className="border-t border-violet-500/10 px-5 py-4 space-y-3">
          {initialParsed.map((p, i) => (
            <div key={p.index} className="flex items-center gap-3">
              <span className="text-violet-300 font-mono text-sm w-24 shrink-0">{p.prefix}</span>
              <input
                type="text"
                value={drafts[i]}
                onChange={(e) => {
                  const next = [...drafts];
                  next[i] = e.target.value;
                  setDrafts(next);
                }}
                placeholder="Topic for this chapter"
                className="flex-1 rounded-md bg-bg-base border border-violet-500/10 px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500/40"
              />
            </div>
          ))}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={reset} disabled={!dirty}>
              Reset
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty}>
              Save titles
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
