import type {
  Template,
  TemplateModule,
  TemplateModuleItem,
  TemplateImage,
  TemplateLtiResource,
  TemplateCourseSettings,
  TemplateExamplePatternContent,
  TemplateExampleNote,
  ModuleClassification,
  ModuleItemContentType,
  EditMarker,
} from '../../types/template';
import type JSZip from 'jszip';

// ── Title-prefix patterns that lock the prefix and let the instructor edit
//    only the suffix. Order matters: longer / more-specific patterns first.
//    `hasEditableSuffix` distinguishes "fully locked" (Module N Overview) from
//    "editable suffix slot present" (M1 Discussion: <topic>). The two render
//    differently in the preview: the former shows just the prefix, the latter
//    shows "(awaiting topic)" until filled.

const ITEM_PREFIX_PATTERNS: Array<{ capture: RegExp; hasEditableSuffix: boolean }> = [
  { capture: /^(M\d+\s+Instructor\s+Notes:)\s*(.*)$/i, hasEditableSuffix: true },
  { capture: /^(M\d+\s+Discussion:)\s*(.*)$/i, hasEditableSuffix: true },
  { capture: /^(Module\s+\d+\s+Overview)$/i, hasEditableSuffix: false },
];

const MODULE_PREFIX_PATTERN = /^(Module\s+\d+:)\s*(.*)$/i;

const EDIT_MARKER_PATTERN = /\*\*\s*(EDIT(?:\s+OR\s+REMOVE)?)\s*\*\*/i;

// Suffixes like "(Example to Edit)" / "(Example to edit)" tag an item as a
// demo placeholder rather than real authored content.
const PLACEHOLDER_SUFFIX_MARKER = /\(Example\s+to\s+Edit\)/i;

function isPlaceholderSuffix(suffix: string | undefined): boolean {
  if (suffix === undefined) return true;
  if (suffix.trim() === '') return true;
  return PLACEHOLDER_SUFFIX_MARKER.test(suffix);
}

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
  // a placeholder pattern (suffixes empty or "(Example to Edit)") from an
  // example-pattern (suffixes carry real authored content).
  if (MODULE_PREFIX_PATTERN.test(title)) {
    const filledCount = items.filter((it) => {
      if (it.contentType === 'ContextModuleSubHeader') return false;
      // Items with no editable suffix slot at all (e.g. "Module N Overview")
      // tell us nothing about whether the module has been filled in.
      if (it.titleEditableSuffix === undefined) return false;
      return !isPlaceholderSuffix(it.titleEditableSuffix);
    }).length;
    return filledCount >= 2 ? 'example-pattern' : 'pattern';
  }
  // Default: treat as verbatim (we don't know how to replicate it).
  return 'verbatim';
}

function detectItemPrefix(title: string): { lockedPrefix?: string; editableSuffix?: string } {
  for (const { capture, hasEditableSuffix } of ITEM_PREFIX_PATTERNS) {
    const m = title.match(capture);
    if (m) {
      const lockedPrefix = m[1];
      // For "fully locked" patterns (Module N Overview), editableSuffix stays
      // undefined so the UI knows there is no slot to fill.
      const editableSuffix = hasEditableSuffix ? (m[2] ?? '').trim() : undefined;
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

/**
 * Bump on any change to classification, prefix detection, or surfaced fields.
 * Stored templates with a lower version are auto-reparsed from their Blob.
 *
 * v1 — initial parser
 * v2 — recognize "(Example to Edit)" as placeholder; distinguish fully-locked
 *      titles (undefined editableSuffix) from empty editable slots ('')
 * v3 — extract examplePatternContent (wiki bodies + discussion text from
 *      the first example-pattern module) for prompt few-shot
 */
export const PARSER_VERSION = 3;

// ── Few-shot extraction (example-pattern module content) ──

/**
 * Walk imsmanifest.xml's <resource> list and build a map from each resource
 * identifier to the file path it points at. Used to resolve item.identifierRef
 * when extracting example-pattern wiki bodies and discussion topics.
 */
function parseManifestResourceMap(manifestText: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!manifestText) return map;
  try {
    const doc = new DOMParser().parseFromString(manifestText, 'text/xml');
    for (const el of Array.from(doc.getElementsByTagName('resource'))) {
      const id = el.getAttribute('identifier');
      const href = el.getAttribute('href');
      if (id && href) map.set(id, href);
    }
  } catch {
    /* fall through */
  }
  return map;
}

function extractWikiBody(html: string): string {
  // Strip the surrounding <html><head>...</head><body>...</body></html>
  // wrapper that Canvas writes around every wiki page. Falls back to the
  // raw input if the wrapper isn't present.
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1].trim() : html.trim();
}

function extractDiscussionText(xml: string): { title: string; bodyHtml: string } | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const titleEl = doc.getElementsByTagName('title')[0];
    const textEl = doc.getElementsByTagName('text')[0];
    const title = titleEl?.textContent?.trim() ?? '';
    // <text texttype="text/html"> wraps HTML that's already entity-escaped
    // when stored in the IMSDT XML — textContent gives us the un-escaped
    // HTML body directly.
    const bodyHtml = textEl?.textContent?.trim() ?? '';
    if (!title && !bodyHtml) return null;
    return { title, bodyHtml };
  } catch {
    return null;
  }
}

async function extractExamplePatternContent(
  zip: JSZip,
  modules: TemplateModule[],
  resourceHref: Map<string, string>,
): Promise<TemplateExamplePatternContent | undefined> {
  const example = modules.find((m) => m.classification === 'example-pattern');
  if (!example) return undefined;

  let moduleOverviewHtml: string | undefined;
  const instructorNotes: TemplateExampleNote[] = [];
  let discussion: TemplateExamplePatternContent['discussion'];

  for (const item of example.items) {
    if (item.contentType === 'ContextModuleSubHeader') continue;
    if (!item.identifierRef) continue;
    const path = resourceHref.get(item.identifierRef);
    if (!path) continue;
    const entry = zip.file(path);
    if (!entry) continue;

    if (item.contentType === 'WikiPage') {
      const html = await entry.async('string');
      const body = extractWikiBody(html);
      if (!body) continue;

      // "Module N Overview" → moduleOverviewHtml.
      // "MN Instructor Notes: <suffix>" → instructorNotes[].
      // Anything else is captured as a note as a fallback.
      if (/^Module\s+\d+\s+Overview$/i.test(item.title)) {
        moduleOverviewHtml = body;
      } else {
        const noteTitle = (item.titleEditableSuffix?.trim() || item.title).trim();
        instructorNotes.push({ title: noteTitle, htmlContent: body });
      }
    } else if (item.contentType === 'DiscussionTopic') {
      const xml = await entry.async('string');
      const parsed = extractDiscussionText(xml);
      if (parsed) {
        discussion = {
          title: (item.titleEditableSuffix?.trim() || parsed.title).trim(),
          promptHtml: parsed.bodyHtml,
        };
      }
    }
  }

  if (!moduleOverviewHtml && instructorNotes.length === 0 && !discussion) return undefined;

  return {
    sourceModuleTitle: example.title,
    moduleOverviewHtml,
    instructorNotes,
    discussion,
  };
}

/** JSZip accepts these natively — Blob/File for browser, Uint8Array/Buffer for Node. */
export type TemplateFileInput = File | Blob | Uint8Array | ArrayBuffer;

export interface ParseTemplateInput {
  file: TemplateFileInput;
  /** Display name, typically the upload filename minus extension. */
  name: string;
}

export async function parseImsccTemplate(input: ParseTemplateInput): Promise<Template> {
  const { default: JSZip } = await import('jszip');
  // JSZip's TS types are conservative; the runtime accepts every variant in
  // TemplateFileInput. Cast to satisfy the type checker.
  const zip = await JSZip.loadAsync(input.file as Blob);

  const moduleMetaFile = zip.file('course_settings/module_meta.xml');
  const moduleMetaText = moduleMetaFile ? await moduleMetaFile.async('string') : '';
  const modules = moduleMetaText ? parseModuleMeta(moduleMetaText) : [];

  const manifestFile = zip.file('imsmanifest.xml');
  const manifestText = manifestFile ? await manifestFile.async('string') : '';
  const resourceHref = parseManifestResourceMap(manifestText);

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

  const examplePatternContent = await extractExamplePatternContent(
    zip,
    modules,
    resourceHref,
  );

  const id = `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    parserVersion: PARSER_VERSION,
    name: input.name,
    uploadedAt: new Date().toISOString(),
    fileSizeBytes: input.file instanceof Blob ? input.file.size : 0,
    modules,
    images,
    ltiResources,
    courseSettings,
    totalFiles,
    examplePatternContent,
  };
}
