import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTemplateStore } from '../store/templateStore';
import { parseImsccTemplate } from '../services/template/parser';
import { Button } from '../components/shared/Button';
import type { Template, TemplateModule } from '../types/template';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function classificationBadge(c: TemplateModule['classification']): { label: string; tone: string } {
  switch (c) {
    case 'verbatim':
      return { label: 'verbatim', tone: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    case 'pattern':
      return { label: 'pattern (placeholder)', tone: 'bg-violet-500/10 text-violet-300 border-violet-500/20' };
    case 'example-pattern':
      return { label: 'pattern (filled example)', tone: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
  }
}

export function TemplatePreviewPage() {
  const navigate = useNavigate();
  const { templates, activeTemplateId, addTemplate, removeTemplate, setActiveTemplate } = useTemplateStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeTemplate = templates.find((t) => t.id === activeTemplateId) ?? templates[templates.length - 1] ?? null;

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseImsccTemplate({
        file,
        name: file.name.replace(/\.imscc$/i, ''),
      });
      await addTemplate(parsed, file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-5xl mx-auto py-8"
    >
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Canvas Templates</h1>
          <p className="text-text-secondary">
            Upload a Canvas course export (.imscc) so ClassBuild can mirror its module structure when generating new courses.
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate('/')}>← Home</Button>
      </div>

      <div className="rounded-xl border border-violet-500/15 bg-bg-card p-5 mb-6">
        <h2 className="text-sm font-medium text-text-primary mb-3">Upload .imscc</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".imscc,.zip"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          disabled={busy}
          className="block text-sm text-text-secondary file:mr-4 file:px-4 file:py-2 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-violet-500/15 file:text-violet-300 hover:file:bg-violet-500/25 file:cursor-pointer"
        />
        {busy && <p className="mt-3 text-xs text-violet-400">Parsing… large templates can take a few seconds.</p>}
        {error && <p className="mt-3 text-xs text-error">{error}</p>}
      </div>

      {templates.length > 0 && (
        <div className="rounded-xl border border-violet-500/15 bg-bg-card p-5 mb-6">
          <h2 className="text-sm font-medium text-text-primary mb-3">Uploaded templates</h2>
          <div className="space-y-2">
            {templates.map((t) => (
              <div
                key={t.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
                  t.id === (activeTemplate?.id ?? '')
                    ? 'border-violet-500/30 bg-violet-500/5'
                    : 'border-violet-500/10'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTemplate(t.id)}
                  className="flex-1 text-left"
                >
                  <span className="text-sm text-text-primary font-medium">{t.name}</span>
                  <span className="text-xs text-text-muted ml-3">
                    {t.modules.length} modules · {formatBytes(t.fileSizeBytes)} · {new Date(t.uploadedAt).toLocaleString()}
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeTemplate(t.id)}
                  className="text-error/80 hover:!text-error"
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTemplate && <TemplatePreview template={activeTemplate} />}
    </motion.div>
  );
}

function TemplatePreview({ template }: { template: Template }) {
  const totalImageBytes = template.images.reduce((acc, img) => acc + img.sizeBytes, 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Modules" value={String(template.modules.length)} />
        <SummaryCard label="Images" value={`${template.images.length} (${formatBytes(totalImageBytes)})`} />
        <SummaryCard label="LTI links" value={String(template.ltiResources.length)} />
        <SummaryCard label="Files in zip" value={String(template.totalFiles)} />
      </div>

      {/* Course settings */}
      {template.courseSettings.title && (
        <div className="rounded-xl border border-violet-500/15 bg-bg-card p-5">
          <h2 className="text-sm font-medium text-text-primary mb-2">Course settings</h2>
          <p className="text-sm text-text-secondary">
            <span className="text-text-muted">Title: </span>
            {template.courseSettings.title}
          </p>
          {template.courseSettings.courseCode && (
            <p className="text-sm text-text-secondary">
              <span className="text-text-muted">Code: </span>
              {template.courseSettings.courseCode}
            </p>
          )}
          {template.courseSettings.syllabusHtmlPathInZip && (
            <p className="text-xs text-text-muted mt-1">Syllabus body present in <code>{template.courseSettings.syllabusHtmlPathInZip}</code></p>
          )}
        </div>
      )}

      {/* Modules */}
      <div className="rounded-xl border border-violet-500/15 bg-bg-card p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">Module structure</h2>
        <div className="space-y-3">
          {template.modules.map((m) => {
            const badge = classificationBadge(m.classification);
            return (
              <div key={m.identifier} className="rounded-lg border border-violet-500/10 p-3">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-text-muted text-xs">#{m.position}</span>
                  <span className="text-sm font-medium text-text-primary">
                    {m.titleLockedPrefix ? (
                      <>
                        <span className="text-violet-300">{m.titleLockedPrefix}</span>
                        {m.titleEditableSuffix === undefined ? null : (
                          <>
                            {' '}
                            <span className="text-text-secondary">
                              {m.titleEditableSuffix === ''
                                ? <em className="text-text-muted">(awaiting topic)</em>
                                : m.titleEditableSuffix}
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      m.title
                    )}
                  </span>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${badge.tone}`}>
                    {badge.label}
                  </span>
                  {m.workflowState === 'unpublished' && (
                    <span className="text-[10px] uppercase text-text-muted">unpublished</span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {m.items.map((it) => (
                    <div
                      key={it.identifier}
                      className="text-xs text-text-secondary flex items-baseline gap-2"
                      style={{ paddingLeft: `${it.indent * 12}px` }}
                    >
                      <span className="text-text-muted w-32 shrink-0">{it.contentType}</span>
                      <span className="flex-1">
                        {it.titleLockedPrefix ? (
                          <>
                            <span className="text-violet-300">{it.titleLockedPrefix}</span>
                            {it.titleEditableSuffix === undefined ? null : (
                              <>
                                {' '}
                                <span>
                                  {it.titleEditableSuffix === ''
                                    ? <em className="text-text-muted">(awaiting topic)</em>
                                    : it.titleEditableSuffix}
                                </span>
                              </>
                            )}
                          </>
                        ) : (
                          it.title
                        )}
                      </span>
                      {it.editMarker && (
                        <span className="text-[10px] uppercase text-amber-400/80">{it.editMarker}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Images */}
      {template.images.length > 0 && (
        <div className="rounded-xl border border-violet-500/15 bg-bg-card p-5">
          <h2 className="text-sm font-medium text-text-primary mb-3">Images carried through</h2>
          <ul className="text-xs text-text-secondary space-y-1 font-mono">
            {template.images.map((img) => (
              <li key={img.pathInZip}>
                {img.filename} <span className="text-text-muted">({formatBytes(img.sizeBytes)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* LTI summary */}
      {template.ltiResources.length > 0 && (
        <div className="rounded-xl border border-violet-500/15 bg-bg-card p-5">
          <h2 className="text-sm font-medium text-text-primary mb-2">3rd-party LTI links</h2>
          <p className="text-xs text-text-muted">
            {template.ltiResources.length} resource link XMLs detected — these will be passed through to the export untouched (no generation, no removal).
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-violet-500/10 bg-bg-card p-3">
      <p className="text-xs text-text-muted uppercase tracking-wider mb-1">{label}</p>
      <p className="text-lg font-semibold text-text-primary">{value}</p>
    </div>
  );
}
