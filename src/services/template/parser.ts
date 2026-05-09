import type {
  Template,
  TemplateModule,
  TemplateModuleItem,
  TemplateImage,
  TemplateLtiResource,
  TemplateCourseSettings,
  ModuleClassification,
  ModuleItemContentType,
  EditMarker,
} from '../../types/template';

// ── Title-prefix patterns that lock the prefix and let the instructor edit
//    only the suffix. Order matters: longer / more-specific patterns first.

const ITEM_PREFIX_PATTERNS: Array<{ prefix: RegExp; capture: RegExp }> = [
  { prefix: /^(M\d+\s+Instructor\s+Notes:)\s*/i, capture: /^(M\d+\s+Instructor\s+Notes:)\s*(.*)$/i },
  { prefix: /^(M\d+\s+Discussion:)\s*/i, capture: /^(M\d+\s+Discussion:)\s*(.*)$/i },
  { prefix: /^(Module\s+\d+\s+Overview)$/i, capture: /^(Module\s+\d+\s+Overview)$/i },
];

const MODULE_PREFIX_PATTERN = /^(Module\s+\d+:)\s*(.*)$/i;

const EDIT_MARKER_PATTERN = /\*\*\s*(EDIT(?:\s+OR\s+REMOVE)?)\s*\*\*/i;

// ── Verbatim-module detection.
//    Any module whose title matches one of these is bundled untouched.

const VERBATIM_TITLE_NEEDLES = [
  'Do not publish', // "Instructor Information: Do not publish"
  'Begin Here',      // "Begin Here: Introductory Module"
];

function classifyModule(title: string, items: TemplateModuleItem[]): ModuleClassification {
  if (VERBATIM_TITLE_NEEDLES.some((n) => title.toLowerCase().includes(n.toLowerCase()))) {
    return 'verbatim';
  }
  // A module that uses the locked "Module N:" prefix is a pattern. Distinguish
  // a placeholder pattern (mostly empty) from an example-pattern (items with
  // descriptive suffixes that imply real content).
  if (MODULE_PREFIX_PATTERN.test(title)) {
    const filledSuffixCount = items.filter((it) => {
      // An item has descriptive content if its title has a non-empty editable
      // suffix and it's not a sub-header.
      if (it.contentType === 'ContextModuleSubHeader') return false;
      const suffix = it.titleEditableSuffix?.trim();
      return suffix !== undefined && suffix.length > 0;
    }).length;
    return filledSuffixCount >= 2 ? 'example-pattern' : 'pattern';
  }
  // Default: treat as verbatim (we don't know how to replicate it).
  return 'verbatim';
}

function detectItemPrefix(title: string): { lockedPrefix?: string; editableSuffix?: string } {
  for (const { capture } of ITEM_PREFIX_PATTERNS) {
    const m = title.match(capture);
    if (m) {
      const lockedPrefix = m[1];
      // The "Module N Overview" pattern has no editable portion; capture group
      // 2 will be undefined.
      const editableSuffix = (m[2] ?? '').trim();
      return { lockedPrefix, editableSuffix };
    }
  }
  return {};
}

function detectModulePrefix(title: string): { lockedPrefix?: string; editableSuffix?: string } {
  const m = title.match(MODULE_PREFIX_PATTERN);
  if (!m) return {};
  return { lockedPrefix: m[1], editableSuffix: (m[2] ?? '').trim() };
}

function detectEditMarker(title: string): EditMarker | undefined {
  const m = title.match(EDIT_MARKER_PATTERN);
  if (!m) return undefined;
  const tag = m[1].toUpperCase().replace(/\s+/g, ' ');
  return tag === 'EDIT' ? 'EDIT' : 'EDIT OR REMOVE';
}

function asContentType(raw: string): ModuleItemContentType {
  switch (raw) {
    case 'WikiPage':
    case 'DiscussionTopic':
    case 'ContextModuleSubHeader':
    case 'Assignment':
    case 'Quiz':
    case 'ExternalUrl':
    case 'ExternalTool':
    case 'Attachment':
    case 'ContextExternalTool':
      return raw;
    default:
      return 'Other';
  }
}

function textOf(parent: Element, tag: string): string {
  const el = parent.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() ?? '';
}

function intOf(parent: Element, tag: string, fallback = 0): number {
  const t = textOf(parent, tag);
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : fallback;
}

function workflowStateOf(parent: Element): 'active' | 'unpublished' {
  return textOf(parent, 'workflow_state') === 'unpublished' ? 'unpublished' : 'active';
}

function parseModuleMeta(xmlText: string): TemplateModule[] {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const modules: TemplateModule[] = [];

  for (const moduleEl of Array.from(doc.getElementsByTagName('module'))) {
    const identifier = moduleEl.getAttribute('identifier') ?? '';
    const title = textOf(moduleEl, 'title');
    const position = intOf(moduleEl, 'position');
    const workflowState = workflowStateOf(moduleEl);

    const itemsContainer = moduleEl.getElementsByTagName('items')[0];
    const items: TemplateModuleItem[] = [];
    if (itemsContainer) {
      for (const itemEl of Array.from(itemsContainer.getElementsByTagName('item'))) {
        const itemTitle = textOf(itemEl, 'title');
        const { lockedPrefix, editableSuffix } = detectItemPrefix(itemTitle);
        items.push({
          identifier: itemEl.getAttribute('identifier') ?? '',
          contentType: asContentType(textOf(itemEl, 'content_type')),
          title: itemTitle,
          titleLockedPrefix: lockedPrefix,
          titleEditableSuffix: editableSuffix,
          editMarker: detectEditMarker(itemTitle),
          position: intOf(itemEl, 'position'),
          indent: intOf(itemEl, 'indent'),
          workflowState: workflowStateOf(itemEl),
          identifierRef: textOf(itemEl, 'identifierref') || undefined,
        });
      }
    }

    const { lockedPrefix, editableSuffix } = detectModulePrefix(title);
    modules.push({
      identifier,
      title,
      position,
      workflowState,
      classification: classifyModule(title, items),
      titleLockedPrefix: lockedPrefix,
      titleEditableSuffix: editableSuffix,
      items,
    });
  }

  modules.sort((a, b) => a.position - b.position);
  return modules;
}

function parseCourseSettings(xmlText: string): TemplateCourseSettings {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    const root = doc.getElementsByTagName('course')[0];
    if (!root) return {};
    return {
      title: textOf(root, 'title') || undefined,
      courseCode: textOf(root, 'course_code') || undefined,
    };
  } catch {
    return {};
  }
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface ParseTemplateInput {
  file: File | Blob;
  /** Display name, typically the upload filename minus extension. */
  name: string;
}

export async function parseImsccTemplate(input: ParseTemplateInput): Promise<Template> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(input.file);

  const moduleMetaFile = zip.file('course_settings/module_meta.xml');
  const moduleMetaText = moduleMetaFile ? await moduleMetaFile.async('string') : '';
  const modules = moduleMetaText ? parseModuleMeta(moduleMetaText) : [];

  const courseSettingsFile = zip.file('course_settings/course_settings.xml');
  const courseSettingsText = courseSettingsFile ? await courseSettingsFile.async('string') : '';
  const courseSettings: TemplateCourseSettings = courseSettingsText
    ? parseCourseSettings(courseSettingsText)
    : {};
  if (zip.file('course_settings/syllabus.html')) {
    courseSettings.syllabusHtmlPathInZip = 'course_settings/syllabus.html';
  }

  const images: TemplateImage[] = [];
  const ltiResources: TemplateLtiResource[] = [];
  let totalFiles = 0;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    totalFiles++;
    if (path.startsWith('web_resources/') && isImagePath(path)) {
      const filename = path.slice(path.lastIndexOf('/') + 1);
      const data = await entry.async('uint8array');
      images.push({ filename, pathInZip: path, sizeBytes: data.byteLength });
    } else if (path.startsWith('lti_resource_links/') && path.endsWith('.xml')) {
      const filename = path.slice(path.lastIndexOf('/') + 1);
      const identifier = filename.replace(/\.xml$/, '');
      ltiResources.push({ identifier, pathInZip: path });
    }
  }

  const id = `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: input.name,
    uploadedAt: new Date().toISOString(),
    fileSizeBytes: input.file instanceof Blob ? input.file.size : 0,
    modules,
    images,
    ltiResources,
    courseSettings,
    totalFiles,
  };
}
