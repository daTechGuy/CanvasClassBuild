import type { Syllabus, GeneratedChapter } from '../../types/course';
import type {
  Template,
  TemplateModule,
  TemplateModuleItem,
  ModuleItemContentType,
} from '../../types/template';
import type { OutlineFields } from '../../types/outline';
import type { TemplateFileInput } from './parser';

// ── Helpers ──

function escXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function genCanvasId(): string {
  // Canvas-style identifier: "g" + 32 hex chars (mirrors what Canvas's exporter
  // emits). Generated from crypto.randomUUID() then dashes stripped.
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`).replace(/-/g, '');
  return `g${uuid.slice(0, 32).padEnd(32, '0')}`;
}

function slug(s: string, max = 60): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max);
}

function wikiPageHtml(title: string, identifier: string, bodyHtml: string): string {
  return `<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>${escXml(title)}</title>
<meta name="identifier" content="${identifier}"/>
<meta name="editing_roles" content="teachers"/>
<meta name="workflow_state" content="active"/>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function discussionTopicXml(title: string, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1  http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_imsdt_v1p1.xsd">
  <title>${escXml(title)}</title>
  <text texttype="text/html">${escXml(bodyHtml)}</text>
</topic>`;
}

/**
 * Canvas-proprietary sidecar that flips imported discussion topics from
 * `unpublished` to `active` so instructors don't have to bulk-publish after
 * import. Bundled alongside each IMSDT topic XML.
 */
function topicMetaXml(topicId: string, title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<topicMeta identifier="${escXml(topicId)}_meta" xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <topic_id>${escXml(topicId)}</topic_id>
  <title>${escXml(title)}</title>
  <type>topic</type>
  <discussion_type>threaded</discussion_type>
  <workflow_state>active</workflow_state>
  <published>true</published>
  <pinned>false</pinned>
  <require_initial_post>false</require_initial_post>
</topicMeta>`;
}

// ── Outline-driven content overrides ──

/**
 * Build the HTML body for course_settings/syllabus.html — what students see
 * on Canvas's "Syllabus" tab. Composed from the outline fields, with sensible
 * fallbacks to the syllabus's own title/overview when the outline DOCX
 * doesn't provide a value.
 */
function buildSyllabusHtml(args: {
  title: string;
  description?: string;
  information?: string;
  materials?: string;
}): string {
  const parts: string[] = [];
  parts.push(`<h1>${escXml(args.title)}</h1>`);
  if (args.description) {
    parts.push(`<p>${escXml(args.description).replace(/\n+/g, '</p><p>')}</p>`);
  }
  if (args.information) {
    parts.push('<h2>Course Information</h2>');
    parts.push(`<p>${escXml(args.information).replace(/\n+/g, '</p><p>')}</p>`);
  }
  if (args.materials) {
    parts.push('<h2>Course Materials</h2>');
    parts.push(`<p>${escXml(args.materials).replace(/\n+/g, '</p><p>')}</p>`);
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>${escXml(args.title)}</title>
</head>
<body>
${parts.join('\n')}
</body>
</html>`;
}

/**
 * Update the `<title>` element inside Canvas's course_settings/course_settings.xml
 * so the imported course shows the new course title in Course Details. All
 * other settings (storage_quota, license, etc.) pass through untouched.
 */
function overrideCourseSettingsTitle(originalXml: string, newTitle: string): string {
  // Replace the first <title>...</title> at any nesting level — Canvas's
  // course_settings.xml has it only at the root level so the regex is safe.
  return originalXml.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escXml(newTitle)}</title>`,
  );
}

// ── Manifest parsing ──

interface ResourceRecord {
  identifier: string;
  type: string;
  href?: string;
  files: string[];
}

function parseManifestResources(xmlText: string): Map<string, ResourceRecord> {
  const map = new Map<string, ResourceRecord>();
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const resourceEls = doc.getElementsByTagName('resource');
  for (const el of Array.from(resourceEls)) {
    const identifier = el.getAttribute('identifier') ?? '';
    if (!identifier) continue;
    const fileEls = el.getElementsByTagName('file');
    const files = Array.from(fileEls)
      .map((f) => f.getAttribute('href') ?? '')
      .filter(Boolean);
    map.set(identifier, {
      identifier,
      type: el.getAttribute('type') ?? '',
      href: el.getAttribute('href') ?? undefined,
      files,
    });
  }
  return map;
}

// ── New module-item builders ──

interface NewItem {
  identifier: string;
  contentType: ModuleItemContentType;
  title: string;
  identifierRef?: string;
  position: number;
  indent: number;
}

interface NewModule {
  identifier: string;
  title: string;
  position: number;
  items: NewItem[];
}

interface NewResource {
  identifier: string;
  type: string;
  href: string;
  files: string[];
}

interface ChapterEmissionResult {
  module: NewModule;
  resources: NewResource[];
  /** Files to write into the zip: { path → content } */
  files: Record<string, string>;
}

const QTI_RESOURCE_TYPE = 'imsqti_xmlv1p2/imscc_xmlv1p1/assessment'; // unused for now but reserved
const WEBCONTENT_TYPE = 'webcontent';
const DISCUSSION_RESOURCE_TYPE = 'imsdt_xmlv1p1';
void QTI_RESOURCE_TYPE;

function emitChapterModule(
  position: number,
  chapter: GeneratedChapter,
): ChapterEmissionResult | null {
  const tc = chapter.templateContent;
  if (!tc) return null;

  const moduleId = genCanvasId();
  const items: NewItem[] = [];
  const resources: NewResource[] = [];
  const files: Record<string, string> = {};

  let pos = 1;

  // 1. Sub-header: "Review the module overview:"
  items.push({
    identifier: genCanvasId(),
    contentType: 'ContextModuleSubHeader',
    title: 'Review the module overview:',
    position: pos++,
    indent: 0,
  });

  // 2. Module N Overview wiki
  const overviewId = genCanvasId();
  const overviewSlug = slug(`module-${chapter.number}-overview-${moduleId.slice(1, 9)}`);
  const overviewPath = `wiki_content/${overviewSlug}.html`;
  files[overviewPath] = wikiPageHtml(
    `Module ${chapter.number} Overview`,
    overviewId,
    tc.moduleOverviewHtml,
  );
  resources.push({
    identifier: overviewId,
    type: WEBCONTENT_TYPE,
    href: overviewPath,
    files: [overviewPath],
  });
  items.push({
    identifier: genCanvasId(),
    contentType: 'WikiPage',
    title: `Module ${chapter.number} Overview`,
    identifierRef: overviewId,
    position: pos++,
    indent: 0,
  });

  // 3. Sub-header: "Read/View the following materials:"
  items.push({
    identifier: genCanvasId(),
    contentType: 'ContextModuleSubHeader',
    title: 'Read/View the following materials:',
    position: pos++,
    indent: 0,
  });

  // 4. MN Instructor Notes pages (≥1)
  for (const note of tc.instructorNotes) {
    const noteId = genCanvasId();
    const fullTitle = `M${chapter.number} Instructor Notes: ${note.title}`;
    const notePath = `wiki_content/${slug(`m${chapter.number}-instructor-notes-${note.title}-${noteId.slice(1, 9)}`)}.html`;
    files[notePath] = wikiPageHtml(fullTitle, noteId, note.htmlContent);
    resources.push({
      identifier: noteId,
      type: WEBCONTENT_TYPE,
      href: notePath,
      files: [notePath],
    });
    items.push({
      identifier: genCanvasId(),
      contentType: 'WikiPage',
      title: fullTitle,
      identifierRef: noteId,
      position: pos++,
      indent: 0,
    });
  }

  // 5. Sub-header: "Complete the following items by the due date:"
  items.push({
    identifier: genCanvasId(),
    contentType: 'ContextModuleSubHeader',
    title: 'Complete the following items by the due date:',
    position: pos++,
    indent: 0,
  });

  // 6. MN Discussion (always 1)
  const discId = genCanvasId();
  const fullDiscTitle = `M${chapter.number} Discussion: ${tc.discussion.title}`;
  const discPath = `${discId}.xml`;
  const discMetaPath = `${discId}-meta.xml`;
  files[discPath] = discussionTopicXml(fullDiscTitle, tc.discussion.promptHtml);
  files[discMetaPath] = topicMetaXml(discId, fullDiscTitle);
  resources.push({
    identifier: discId,
    type: DISCUSSION_RESOURCE_TYPE,
    href: discPath,
    files: [discPath, discMetaPath],
  });
  items.push({
    identifier: genCanvasId(),
    contentType: 'DiscussionTopic',
    title: fullDiscTitle,
    identifierRef: discId,
    position: pos++,
    indent: 1,
  });

  return {
    module: {
      identifier: moduleId,
      title: chapter.title, // e.g. "Module N: <topic>" — comes pre-formatted from syllabus
      position,
      items,
    },
    resources,
    files,
  };
}

// ── Manifest + module_meta emission ──

function moduleMetaItem(item: NewItem | TemplateModuleItem, isVerbatim: boolean): string {
  const identifier = item.identifier;
  const contentType = item.contentType;
  const title = item.title;
  const position = item.position;
  const indent = item.indent;
  const ref = (item as { identifierRef?: string }).identifierRef;
  const refXml = ref ? `\n        <identifierref>${escXml(ref)}</identifierref>` : '';
  const workflow = isVerbatim
    ? (item as TemplateModuleItem).workflowState ?? 'active'
    : 'active';
  return `      <item identifier="${escXml(identifier)}">
        <content_type>${escXml(contentType)}</content_type>
        <workflow_state>${escXml(workflow)}</workflow_state>
        <title>${escXml(title)}</title>${refXml}
        <position>${position}</position>
        <new_tab>false</new_tab>
        <indent>${indent}</indent>
        <link_settings_json>null</link_settings_json>
      </item>`;
}

function moduleMetaModule(
  mod: NewModule | TemplateModule,
  isVerbatim: boolean,
): string {
  const itemsXml = mod.items.map((it) => moduleMetaItem(it, isVerbatim)).join('\n');
  const workflow = isVerbatim
    ? (mod as TemplateModule).workflowState ?? 'active'
    : 'active';
  return `  <module identifier="${escXml(mod.identifier)}">
    <title>${escXml(mod.title)}</title>
    <workflow_state>${escXml(workflow)}</workflow_state>
    <position>${mod.position}</position>
    <require_sequential_progress>false</require_sequential_progress>
    <locked>false</locked>
    <items>
${itemsXml}
    </items>
  </module>`;
}

function buildModuleMeta(modules: Array<{ mod: NewModule | TemplateModule; isVerbatim: boolean }>): string {
  const xml = modules
    .map((m, i) => moduleMetaModule({ ...m.mod, position: i + 1 } as NewModule | TemplateModule, m.isVerbatim))
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<modules xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
${xml}
</modules>`;
}

function organizationItem(item: NewItem | TemplateModuleItem): string {
  const ref = (item as { identifierRef?: string }).identifierRef;
  const refAttr = ref ? ` identifierref="${escXml(ref)}"` : '';
  return `          <item identifier="${escXml(item.identifier)}"${refAttr}>
            <title>${escXml(item.title)}</title>
          </item>`;
}

function organizationModule(mod: NewModule | TemplateModule): string {
  const itemsXml = mod.items.map(organizationItem).join('\n');
  return `        <item identifier="${escXml(mod.identifier)}">
          <title>${escXml(mod.title)}</title>
${itemsXml}
        </item>`;
}

function buildManifest(
  effectiveTitle: string,
  effectiveDescription: string,
  modules: Array<NewModule | TemplateModule>,
  allResources: Array<NewResource | ResourceRecord>,
): string {
  const courseId = `canvasclassbuild-${slug(effectiveTitle) || 'course'}`;
  const orgItems = modules.map(organizationModule).join('\n');
  const resourceXml = allResources
    .map((r) => {
      const files = r.files.map((f) => `<file href="${escXml(f)}"/>`).join('');
      const hrefAttr = r.href ? ` href="${escXml(r.href)}"` : '';
      return `    <resource identifier="${escXml(r.identifier)}" type="${escXml(r.type)}"${hrefAttr}>${files}</resource>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${escXml(courseId)}"
  xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"
  xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_imscp_v1p2_v1p0.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lommanifest_v1p0.xsd">
  <metadata>
    <schema>IMS Common Cartridge</schema>
    <schemaversion>1.1.0</schemaversion>
    <lomimscc:lom>
      <lomimscc:general>
        <lomimscc:title><lomimscc:string>${escXml(effectiveTitle)}</lomimscc:string></lomimscc:title>
        <lomimscc:description><lomimscc:string>${escXml(effectiveDescription)}</lomimscc:string></lomimscc:description>
      </lomimscc:general>
    </lomimscc:lom>
  </metadata>
  <organizations>
    <organization identifier="O_1" structure="rooted-hierarchy">
      <item identifier="LearningModules">
${orgItems}
      </item>
    </organization>
  </organizations>
  <resources>
${resourceXml}
  </resources>
</manifest>`;
}

// ── Main entry point ──

export interface AssembleTemplateImsccInput {
  syllabus: Syllabus;
  chapters: GeneratedChapter[];
  template: Template;
  /** The original .imscc the user uploaded — passes through as the starting
   *  workspace so verbatim modules / LTI / web_resources carry over.
   *  Accepts Blob/File (browser) or Uint8Array/ArrayBuffer (Node CLI). */
  templateBlob: TemplateFileInput;
  /** Course-outline fields extracted from the instructor's DOCX (Phase 3).
   *  When present, the title/description/info/materials populate Canvas's
   *  Syllabus tab body and the manifest LOM metadata. */
  outlineFields?: OutlineFields | null;
}

export async function assembleTemplateImscc(
  input: AssembleTemplateImsccInput,
): Promise<Blob> {
  const { syllabus, chapters, template, templateBlob, outlineFields } = input;

  const { default: JSZip } = await import('jszip');
  // JSZip TS types are conservative; runtime accepts all TemplateFileInput
  // variants. Cast to satisfy the checker without forcing a Blob round-trip.
  const zip = await JSZip.loadAsync(templateBlob as Blob);

  // Resolve the effective course title + description by preferring the
  // outline DOCX fields (instructor-curated) over the AI-generated syllabus
  // values. Both fall back gracefully when missing.
  const effectiveTitle = (outlineFields?.courseTitle?.trim() || syllabus.courseTitle).trim();
  const effectiveDescription = (
    outlineFields?.courseDescription?.trim() ||
    syllabus.courseOverview ||
    ''
  ).trim();

  // Parse the original manifest's resources so we can carry through the ones
  // referenced by verbatim modules.
  const manifestEntry = zip.file('imsmanifest.xml');
  if (!manifestEntry) {
    throw new Error('Template is missing imsmanifest.xml — cannot export.');
  }
  const originalManifestText = await manifestEntry.async('string');
  const originalResources = parseManifestResources(originalManifestText);

  // Verbatim modules from the parsed Template metadata.
  const verbatimModules = template.modules.filter((m) => m.classification === 'verbatim');

  // Resources to keep: every resource referenced by verbatim modules, plus
  // every resource that isn't tied to any module (course settings, LTI links,
  // web_resources, etc.).
  const verbatimRefs = new Set<string>();
  for (const mod of verbatimModules) {
    for (const item of mod.items) {
      if (item.identifierRef) verbatimRefs.add(item.identifierRef);
    }
  }
  // Refs explicitly used by pattern/example modules — drop unless also used by
  // a verbatim module.
  const patternRefs = new Set<string>();
  for (const mod of template.modules) {
    if (mod.classification === 'verbatim') continue;
    for (const item of mod.items) {
      if (item.identifierRef) patternRefs.add(item.identifierRef);
    }
  }

  const keptResources: ResourceRecord[] = [];
  for (const r of originalResources.values()) {
    if (patternRefs.has(r.identifier) && !verbatimRefs.has(r.identifier)) continue;
    keptResources.push(r);
  }

  // Emit new chapter modules from each chapter that has templateContent.
  const newModules: NewModule[] = [];
  const newResources: NewResource[] = [];
  let positionCursor = verbatimModules.length + 1;
  for (const ch of chapters) {
    const result = emitChapterModule(positionCursor, ch);
    if (!result) continue;
    newModules.push(result.module);
    newResources.push(...result.resources);
    for (const [path, content] of Object.entries(result.files)) {
      zip.file(path, content);
    }
    positionCursor++;
  }

  // Build the new module ordering: verbatim modules first (in their original
  // order), then the new chapter modules.
  const orderedModules: Array<{ mod: NewModule | TemplateModule; isVerbatim: boolean }> = [
    ...verbatimModules.map((m) => ({ mod: m, isVerbatim: true })),
    ...newModules.map((m) => ({ mod: m, isVerbatim: false })),
  ];

  // Rebuild course_settings/module_meta.xml.
  zip.file('course_settings/module_meta.xml', buildModuleMeta(orderedModules));

  // Outline-driven overrides: replace syllabus.html body and update the
  // <title> in course_settings.xml. Both are no-ops when outlineFields is
  // null AND the syllabus carries no overview, but the syllabus.html still
  // gets rewritten with at least the course title.
  zip.file(
    'course_settings/syllabus.html',
    buildSyllabusHtml({
      title: effectiveTitle,
      description: effectiveDescription || undefined,
      information: outlineFields?.courseInformation,
      materials: outlineFields?.courseMaterials,
    }),
  );

  const courseSettingsEntry = zip.file('course_settings/course_settings.xml');
  if (courseSettingsEntry) {
    const originalCs = await courseSettingsEntry.async('string');
    zip.file(
      'course_settings/course_settings.xml',
      overrideCourseSettingsTitle(originalCs, effectiveTitle),
    );
  }

  // Rebuild imsmanifest.xml.
  const allModulesForManifest: Array<NewModule | TemplateModule> = orderedModules.map((x) => x.mod);
  const allResourcesForManifest: Array<NewResource | ResourceRecord> = [
    ...keptResources,
    ...newResources,
  ];
  zip.file(
    'imsmanifest.xml',
    buildManifest(effectiveTitle, effectiveDescription, allModulesForManifest, allResourcesForManifest),
  );

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
