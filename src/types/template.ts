/**
 * Whole-module classification.
 *
 * - `verbatim` — bundle into the export untouched. Used for the Instructor
 *   Information module and the Begin Here / Introductory module.
 * - `pattern` — empty placeholder shape (e.g. the template's "Module 1:") that
 *   CanvasClassBuild should replicate one-per-chapter, replacing it with generated
 *   content.
 * - `example-pattern` — same structural shape as `pattern` but with content
 *   already filled in (e.g. the template's "Module 2: Data Visualization").
 *   Used as a few-shot exemplar for the AI when generating new modules.
 */
export type ModuleClassification = 'verbatim' | 'pattern' | 'example-pattern';

export type ModuleItemContentType =
  | 'WikiPage'
  | 'DiscussionTopic'
  | 'ContextModuleSubHeader'
  | 'Assignment'
  | 'Quiz'
  | 'ExternalUrl'
  | 'ExternalTool'
  | 'Attachment'
  | 'ContextExternalTool'
  | 'Other';

export type EditMarker = 'EDIT' | 'EDIT OR REMOVE';

export interface TemplateModuleItem {
  identifier: string;
  contentType: ModuleItemContentType;
  title: string;
  /** Title prefix that the instructor (and CanvasClassBuild) must keep intact. */
  titleLockedPrefix?: string;
  /** The editable portion the instructor / CanvasClassBuild fills in. */
  titleEditableSuffix?: string;
  /** When the title carries an `**EDIT**` / `**EDIT OR REMOVE**` marker. */
  editMarker?: EditMarker;
  position: number;
  indent: number;
  workflowState: 'active' | 'unpublished';
  /** Resource ID pointing at the underlying content file (wiki XML, etc.). */
  identifierRef?: string;
}

export interface TemplateModule {
  identifier: string;
  title: string;
  position: number;
  workflowState: 'active' | 'unpublished';
  classification: ModuleClassification;
  /** Title prefix (e.g. "Module 1:") that must remain intact. */
  titleLockedPrefix?: string;
  titleEditableSuffix?: string;
  items: TemplateModuleItem[];
}

export interface TemplateImage {
  filename: string;
  pathInZip: string;
  sizeBytes: number;
}

export interface TemplateLtiResource {
  identifier: string;
  pathInZip: string;
}

export interface TemplateCourseSettings {
  title?: string;
  courseCode?: string;
  syllabusHtmlPathInZip?: string;
}

export interface TemplateExampleNote {
  /** Title minus the locked prefix (e.g. "What is Data Visualization?"). */
  title: string;
  /** Wiki body innerHTML — the actual instructional content. */
  htmlContent: string;
}

export interface TemplateExampleDiscussion {
  /** Title minus the locked prefix. */
  title: string;
  /** Discussion prompt body, HTML. */
  promptHtml: string;
}

/**
 * Content extracted from the template's example-pattern module — used as a
 * few-shot exemplar in the Canvas Module generation prompt so generated
 * chapters mirror the template's tone, depth, and section structure.
 */
export interface TemplateExamplePatternContent {
  /** Source module title (e.g. "Module 2: Data Visualization") for prompt context. */
  sourceModuleTitle: string;
  /** Body of the "Module N Overview" wiki page. */
  moduleOverviewHtml?: string;
  /** Each "MN Instructor Notes:" wiki page's title + body. */
  instructorNotes: TemplateExampleNote[];
  /** Optional — some example modules (e.g. with 3rd-party LTI assignments) have no discussion. */
  discussion?: TemplateExampleDiscussion;
}

export interface Template {
  /** Stable id assigned at upload time. */
  id: string;
  /**
   * Version of the parser that produced this metadata. Bumped whenever the
   * classifier or prefix detection changes; older stored templates are
   * automatically re-parsed from their persisted Blob on next hydration.
   */
  parserVersion: number;
  /** Display name — filename minus extension. */
  name: string;
  uploadedAt: string;
  fileSizeBytes: number;
  modules: TemplateModule[];
  images: TemplateImage[];
  ltiResources: TemplateLtiResource[];
  courseSettings: TemplateCourseSettings;
  /** Total file count in the source zip (for the preview pane). */
  totalFiles: number;
  /**
   * Few-shot exemplar pulled from the first example-pattern module (e.g.
   * Module 2 in the test template). Embedded in the Canvas Module
   * generation prompt to anchor tone/depth/section structure.
   */
  examplePatternContent?: TemplateExamplePatternContent;
}
