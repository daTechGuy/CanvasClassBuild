import { useNavigate } from 'react-router-dom';
import { useCourseStore } from '../../store/courseStore';
import { useTemplateStore } from '../../store/templateStore';
import { Button } from '../shared/Button';

const DEFAULT_NUM_CHAPTERS_WITH_TEMPLATE = 16;

export function TemplatePicker() {
  const navigate = useNavigate();
  const { setup, updateSetup } = useCourseStore();
  const { templates } = useTemplateStore();

  const activeTemplate = templates.find((t) => t.id === setup.templateId);

  const selectTemplate = (id: string | null) => {
    if (id === null) {
      updateSetup({ templateId: undefined });
      return;
    }
    // Selecting a template forces the per-template default chapter count.
    // Instructor can adjust it back in the Course Structure section if needed.
    updateSetup({ templateId: id, numChapters: DEFAULT_NUM_CHAPTERS_WITH_TEMPLATE });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-1">Canvas template (optional)</h3>
          <p className="text-xs text-text-muted">
            Mirror an uploaded Canvas course's module structure. When active, chapter titles lock to <code className="text-violet-300">Module N:</code> and the template's verbatim modules carry through to export.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/templates')}>
          Manage templates
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-violet-500/15 bg-bg-base p-4 text-xs text-text-muted text-center">
          No templates uploaded yet. <button type="button" onClick={() => navigate('/templates')} className="text-violet-400 hover:underline">Upload a Canvas .imscc</button> to enable template mode.
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors border-violet-500/10 hover:border-violet-500/25">
            <input
              type="radio"
              name="template"
              checked={!setup.templateId}
              onChange={() => selectTemplate(null)}
              className="accent-violet-500"
            />
            <span className="text-sm text-text-primary">No template — generate a course from scratch</span>
          </label>
          {templates.map((t) => {
            const checked = t.id === setup.templateId;
            const patternModuleCount = t.modules.filter((m) => m.classification !== 'verbatim').length;
            return (
              <label
                key={t.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  checked
                    ? 'border-violet-500/30 bg-violet-500/5'
                    : 'border-violet-500/10 hover:border-violet-500/25'
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  checked={checked}
                  onChange={() => selectTemplate(t.id)}
                  className="accent-violet-500"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{t.name}</p>
                  <p className="text-xs text-text-muted">
                    {t.modules.length} modules · {patternModuleCount} pattern{patternModuleCount === 1 ? '' : 's'} · {t.images.length} image{t.images.length === 1 ? '' : 's'} · {t.ltiResources.length} LTI link{t.ltiResources.length === 1 ? '' : 's'}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {activeTemplate && (
        <div className="rounded-lg bg-violet-500/5 border border-violet-500/15 px-3.5 py-3 text-xs text-text-secondary leading-relaxed">
          <strong className="text-violet-300">Template active:</strong>{' '}
          {activeTemplate.name}. Default chapter count set to {DEFAULT_NUM_CHAPTERS_WITH_TEMPLATE}; adjust below if you want fewer or more. Chapter titles will be generated as <code className="text-violet-300">Module N: &lt;topic&gt;</code> and you can edit the topic suffix per chapter on the Syllabus page.
        </div>
      )}
    </div>
  );
}
