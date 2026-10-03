import type {
  Syllabus,
  GeneratedChapter,
  InClassQuizQuestion,
  WeeklyChallengeData,
  ChallengeQuestion,
} from '../../types/course';

// ── Helpers ──

function escXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slug(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ── Quiz model normalization (everything funnels into MCQ for QTI 1.2) ──

interface ParsedMcq {
  prompt: string;
  options: string[];
  correctIndex: number;
  feedback?: string;
}

/**
 * Parse the markdown format used by `practiceQuizData`. Mirrors the parser in
 * `src/templates/quizTemplate.ts` (option `a` is always the correct answer in
 * source; the runtime quiz randomizes order at display time).
 */
function parsePracticeQuizMarkdown(md: string): ParsedMcq[] {
  const out: ParsedMcq[] = [];
  const norm = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sections = norm.split(/\n\s*---\s*\n/);
  for (const sec of sections) {
    const t = sec.trim();
    if (!t) continue;
    const qm = t.match(/^\s*\d+\.\s+\*\*([^*]+)\*\*/);
    if (!qm) continue;
    const prompt = qm[1].trim();
    const opts: { id: string; text: string }[] = [];
    const re = /\s+([a-d])\.\s+(.*?)(?=\s+[a-d]\.\s+|\s+\*\*Answer|\s*$)/gs;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      if (['a', 'b', 'c', 'd'].includes(m[1])) {
        opts.push({ id: m[1], text: m[2].trim() });
      }
      if (opts.length >= 4) break;
    }
    if (opts.length === 0) continue;
    const fbm = t.match(/\*\*Feedback\*\*:\s*([\s\S]*?)(?=\s*$)/);
    out.push({
      prompt,
      options: opts.map((o) => o.text),
      correctIndex: 0,
      feedback: fbm ? fbm[1].trim() : undefined,
    });
  }
  return out;
}

function inClassToMcq(q: InClassQuizQuestion): ParsedMcq {
  return {
    prompt: q.question,
    options: [q.correctAnswer, ...q.distractors.map((d) => d.text)],
    correctIndex: 0,
    feedback: q.correctFeedback,
  };
}

function challengeToMcq(q: ChallengeQuestion): ParsedMcq | null {
  if (q.type === 'mcq' || q.type === 'confidence-weighted') {
    return {
      prompt: q.stem,
      options: q.options,
      correctIndex: q.correctIndex,
      feedback: q.feedback?.correct,
    };
  }
  if (q.type === 'two-stage' || q.type === 'boss') {
    return {
      prompt: q.stem,
      options: q.options,
      correctIndex: q.correctIndex,
      feedback: q.feedback?.correct,
    };
  }
  // assertion-reason / agreement-matrix / slider-estimation: not cleanly
  // representable in QTI 1.2 single-MCQ; the rich HTML version is shipped
  // alongside as a webcontent resource so the content is still usable.
  return null;
}

function weeklyToMcqs(d: WeeklyChallengeData): ParsedMcq[] {
  const out: ParsedMcq[] = [];
  for (const q of d.questions) {
    const mcq = challengeToMcq(q);
    if (mcq) out.push(mcq);
  }
  return out;
}

// ── Deterministic Canvas-style identifiers ──
//
// Canvas's own exporter names every object `g` + 32 hex chars. We derive ours
// from stable seeds so re-exporting the same course yields the same ids (which
// makes re-imports into an existing Canvas course match up instead of
// duplicating).

function hash128(seed: string): string {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
    h3 = Math.imul(h3 ^ c, 3266489917);
    h4 = Math.imul(h4 ^ c, 668265263);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
}

function gid(seed: string): string {
  return `g${hash128(seed)}`;
}

/** Plain text -> HTML-safe text (for composing HTML fragments). */
function escHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Native Canvas QTI (CC profile + Canvas's non_cc flavour) ──

const QTI_NS =
  'xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

function qtiField(label: string, entry: string): string {
  return `<qtimetadatafield><fieldlabel>${label}</fieldlabel><fieldentry>${escXml(entry)}</fieldentry></qtimetadatafield>`;
}

/**
 * One multiple-choice item. `canvas` adds the metadata Canvas's native importer
 * reads from non_cc_assessments (question type, points, answer ids and the
 * back-reference to the CC-profile item).
 */
function qtiItem(
  itemId: string,
  mcq: ParsedMcq,
  canvas?: { questionRef: string },
): string {
  const ids = mcq.options.map((_, i) => String(i + 1));
  const choices = mcq.options
    .map(
      (opt, i) =>
        `<response_label ident="${ids[i]}"><material><mattext texttype="text/plain">${escXml(opt)}</mattext></material></response_label>`,
    )
    .join('');
  const fb = mcq.feedback
    ? `<itemfeedback ident="correct_fb"><flow_mat><material><mattext texttype="text/plain">${escXml(mcq.feedback)}</mattext></material></flow_mat></itemfeedback>` +
      `<itemfeedback ident="general_incorrect_fb"><flow_mat><material><mattext texttype="text/plain">${escXml(mcq.feedback)}</mattext></material></flow_mat></itemfeedback>`
    : '';
  const correctFb = mcq.feedback ? '<displayfeedback feedbacktype="Response" linkrefid="correct_fb"/>' : '';
  const incorrectFb = mcq.feedback
    ? '<displayfeedback feedbacktype="Response" linkrefid="general_incorrect_fb"/>'
    : '';
  const meta = canvas
    ? [
        qtiField('question_type', 'multiple_choice_question'),
        qtiField('points_possible', '1.0'),
        qtiField('original_answer_ids', ids.join(',')),
        qtiField('assessment_question_identifierref', canvas.questionRef),
      ].join('')
    : qtiField('cc_profile', 'cc.multiple_choice.v0p1');
  const title = escXml(mcq.prompt.replace(/\s+/g, ' ').slice(0, 80));
  return `<item ident="${itemId}" title="${title}">
  <itemmetadata><qtimetadata>${meta}</qtimetadata></itemmetadata>
  <presentation>
    <material><mattext texttype="text/html">${escXml(`<div><p>${escHtml(mcq.prompt)}</p></div>`)}</mattext></material>
    <response_lid ident="response1" rcardinality="Single"><render_choice>${choices}</render_choice></response_lid>
  </presentation>
  <resprocessing>
    <outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
    <respcondition continue="No">
      <conditionvar><varequal respident="response1">${ids[mcq.correctIndex]}</varequal></conditionvar>
      <setvar action="Set" varname="SCORE">100</setvar>
      ${correctFb}
    </respcondition>
    <respcondition continue="Yes">
      <conditionvar><other/></conditionvar>
      ${incorrectFb}
    </respcondition>
  </resprocessing>
  ${fb}
</item>`;
}

/** The standard CC-profile assessment (what generic LMSes read). */
function qtiAssessmentCc(quizId: string, title: string, mcqs: ParsedMcq[]): string {
  const items = mcqs.map((m, i) => qtiItem(gid(`${quizId}:q:${i}`), m)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop ${QTI_NS} xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_qtiasiv1p2p1_v1p0.xsd">
  <assessment ident="${quizId}" title="${escXml(title)}">
    <qtimetadata>
      ${qtiField('cc_profile', 'cc.exam.v0p1')}
      ${qtiField('qmd_assessmenttype', 'Examination')}
      ${qtiField('qmd_scoretype', 'Percentage')}
      ${qtiField('cc_maxattempts', '1')}
    </qtimetadata>
    <section ident="root_section">${items}</section>
  </assessment>
</questestinterop>`;
}

/** Canvas's native flavour (non_cc_assessments/<id>.xml.qti) — read by the native importer. */
function qtiAssessmentNative(quizId: string, title: string, mcqs: ParsedMcq[]): string {
  const items = mcqs
    .map((m, i) =>
      qtiItem(gid(`${quizId}:nq:${i}`), m, { questionRef: gid(`${quizId}:q:${i}`) }),
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop ${QTI_NS} xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="${quizId}" title="${escXml(title)}">
    <qtimetadata>${qtiField('cc_maxattempts', '1')}</qtimetadata>
    <section ident="root_section">${items}</section>
  </assessment>
</questestinterop>`;
}

// ── Canvas-namespace metadata files ──

const CANVAS_NS =
  'xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd"';

type QuizKind = 'practice_quiz' | 'assignment';

function assessmentMetaXml(opts: {
  quizId: string;
  title: string;
  points: number;
  kind: QuizKind;
  assignmentId: string;
  groupId: string;
}): string {
  const { quizId, title, points, kind, assignmentId, groupId } = opts;
  const pts = points.toFixed(1);
  const assignment =
    kind === 'assignment'
      ? `
  <assignment identifier="${assignmentId}">
    <title>${escXml(title)}</title>
    <due_at/>
    <lock_at/>
    <unlock_at/>
    <module_locked>false</module_locked>
    <assignment_group_identifierref>${groupId}</assignment_group_identifierref>
    <workflow_state>published</workflow_state>
    <assignment_overrides>
    </assignment_overrides>
    <quiz_identifierref>${quizId}</quiz_identifierref>
    <allowed_extensions></allowed_extensions>
    <has_group_category>false</has_group_category>
    <points_possible>${pts}</points_possible>
    <grading_type>points</grading_type>
    <all_day>false</all_day>
    <submission_types>online_quiz</submission_types>
    <position>1</position>
    <omit_from_final_grade>false</omit_from_final_grade>
    <hide_in_gradebook>false</hide_in_gradebook>
    <only_visible_to_overrides>false</only_visible_to_overrides>
    <post_policy>
      <post_manually>false</post_manually>
    </post_policy>
  </assignment>
  <assignment_group_identifierref>${groupId}</assignment_group_identifierref>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<quiz identifier="${quizId}" ${CANVAS_NS}>
  <title>${escXml(title)}</title>
  <description></description>
  <shuffle_answers>false</shuffle_answers>
  <scoring_policy>keep_highest</scoring_policy>
  <hide_results></hide_results>
  <quiz_type>${kind}</quiz_type>
  <points_possible>${pts}</points_possible>
  <require_lockdown_browser>false</require_lockdown_browser>
  <require_lockdown_browser_for_results>false</require_lockdown_browser_for_results>
  <require_lockdown_browser_monitor>false</require_lockdown_browser_monitor>
  <lockdown_browser_monitor_data/>
  <show_correct_answers>true</show_correct_answers>
  <anonymous_submissions>false</anonymous_submissions>
  <could_be_locked>true</could_be_locked>
  <disable_timer_autosubmission>false</disable_timer_autosubmission>
  <allowed_attempts>${kind === 'practice_quiz' ? '-1' : '1'}</allowed_attempts>
  <one_question_at_a_time>false</one_question_at_a_time>
  <cant_go_back>false</cant_go_back>
  <available>true</available>
  <one_time_results>false</one_time_results>
  <show_correct_answers_last_attempt>false</show_correct_answers_last_attempt>
  <only_visible_to_overrides>false</only_visible_to_overrides>
  <module_locked>false</module_locked>
  <assignment_overrides>
  </assignment_overrides>${assignment}
</quiz>`;
}

function discussionTopicXml(title: string, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1  http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_imsdt_v1p1.xsd">
  <title>${escXml(title)}</title>
  <text texttype="text/html">${escXml(bodyHtml)}</text>
</topic>`;
}

function topicMetaXml(metaId: string, topicId: string, title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<topicMeta identifier="${metaId}" ${CANVAS_NS}>
  <topic_id>${topicId}</topic_id>
  <title>${escXml(title)}</title>
  <position/>
  <type>topic</type>
  <discussion_type>threaded</discussion_type>
  <has_group_category>false</has_group_category>
  <workflow_state>active</workflow_state>
  <module_locked>false</module_locked>
  <allow_rating>false</allow_rating>
  <only_graders_can_rate>false</only_graders_can_rate>
  <sort_by_rating>false</sort_by_rating>
  <sort_order>desc</sort_order>
  <sort_order_locked>false</sort_order_locked>
  <expanded>false</expanded>
  <expanded_locked>false</expanded_locked>
  <todo_date/>
</topicMeta>`;
}

function pageHtml(pageId: string, title: string, bodyHtml: string): string {
  return `<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>${escXml(title)}</title>
<meta name="identifier" content="${pageId}"/>
<meta name="workflow_state" content="active"/>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Canvas Pages can't carry <script>/<style> (its sanitizer strips them on
 * import), so reduce the standalone reading document to its body markup. The
 * original interactive HTML is shipped alongside as a file.
 */
function readingBodyHtml(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = m ? m[1] : html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .trim();
}

// ── Cartridge model ──

type ModuleItemType = 'WikiPage' | 'Quizzes::Quiz' | 'DiscussionTopic' | 'Attachment';

interface ModuleItem {
  id: string;
  type: ModuleItemType;
  title: string;
  /** Manifest resource this item points at. */
  refId: string;
}

interface CourseModule {
  id: string;
  title: string;
  items: ModuleItem[];
}

interface FileRecord {
  id: string;
  displayName: string;
}

const LEARNING_APP_TYPE = 'associatedcontent/imscc_xmlv1p1/learning-application-resource';
const QTI_RESOURCE_TYPE = 'imsqti_xmlv1p2/imscc_xmlv1p1/assessment';
const DISCUSSION_RESOURCE_TYPE = 'imsdt_xmlv1p1';

function resourceXml(opts: {
  id: string;
  type: string;
  href?: string;
  files: string[];
  dependencies?: string[];
  intendeduse?: string;
}): string {
  const href = opts.href ? ` href="${escXml(opts.href)}"` : '';
  const use = opts.intendeduse ? ` intendeduse="${opts.intendeduse}"` : '';
  const files = opts.files.map((f) => `<file href="${escXml(f)}"/>`).join('');
  const deps = (opts.dependencies ?? []).map((d) => `<dependency identifierref="${d}"/>`).join('');
  return `<resource identifier="${opts.id}" type="${opts.type}"${href}${use}>${files}${deps}</resource>`;
}

function moduleMetaXml(modules: CourseModule[]): string {
  const mods = modules
    .map((m, mi) => {
      const items = m.items
        .map(
          (it, ii) => `
      <item identifier="${it.id}">
        <content_type>${it.type}</content_type>
        <workflow_state>active</workflow_state>
        <title>${escXml(it.title)}</title>
        <identifierref>${it.refId}</identifierref>
        <position>${ii + 1}</position>
        <new_tab/>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>`,
        )
        .join('');
      return `
  <module identifier="${m.id}">
    <title>${escXml(m.title)}</title>
    <workflow_state>active</workflow_state>
    <position>${mi + 1}</position>
    <locked>false</locked>
    <items>${items}
    </items>
  </module>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<modules ${CANVAS_NS}>${mods}
</modules>`;
}

function courseSettingsXml(courseId: string, syllabus: Syllabus): string {
  const code = slug(syllabus.courseTitle).toUpperCase().slice(0, 20) || 'COURSE';
  return `<?xml version="1.0" encoding="UTF-8"?>
<course identifier="${courseId}" ${CANVAS_NS}>
  <title>${escXml(syllabus.courseTitle)}</title>
  <course_code>${escXml(code)}</course_code>
  <start_at/>
  <conclude_at/>
  <allow_student_wiki_edits>false</allow_student_wiki_edits>
  <lock_all_announcements>false</lock_all_announcements>
  <allow_student_organized_groups>true</allow_student_organized_groups>
  <default_view>modules</default_view>
  <usage_rights_required>false</usage_rights_required>
  <restrict_student_future_view>false</restrict_student_future_view>
  <restrict_student_past_view>false</restrict_student_past_view>
  <homeroom_course>false</homeroom_course>
  <conditional_release>false</conditional_release>
  <grading_standard_enabled>false</grading_standard_enabled>
  <storage_quota>500000000</storage_quota>
  <default_post_policy>
    <post_manually>false</post_manually>
  </default_post_policy>
</course>`;
}

function assignmentGroupsXml(groupId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<assignmentGroups ${CANVAS_NS}>
  <assignmentGroup identifier="${groupId}">
    <title>Assignments</title>
    <position>1</position>
    <group_weight>0.0</group_weight>
  </assignmentGroup>
</assignmentGroups>`;
}

function filesMetaXml(files: FileRecord[]): string {
  const entries = files
    .map(
      (f) => `
    <file identifier="${f.id}">
      <display_name>${escXml(f.displayName)}</display_name>
      <category>uncategorized</category>
    </file>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<fileMeta ${CANVAS_NS}>
  <files>${entries}
  </files>
</fileMeta>`;
}

function syllabusHtml(syllabus: Syllabus): string {
  const overview = syllabus.courseOverview
    ? `<p>${escHtml(syllabus.courseOverview)}</p>`
    : '';
  const outline = syllabus.chapters.length
    ? `<h3>Course outline</h3><ol>${syllabus.chapters
        .map((c) => `<li>${escHtml(c.title)}</li>`)
        .join('')}</ol>`
    : '';
  return `<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>Syllabus</title>
</head>
<body>
<h2>${escHtml(syllabus.courseTitle)}</h2>${overview}${outline}
</body>
</html>`;
}

function manifestXml(opts: {
  courseId: string;
  settingsId: string;
  syllabus: Syllabus;
  modules: CourseModule[];
  resources: string[];
}): string {
  const { courseId, syllabus, modules, resources } = opts;
  const orgItems = modules
    .map((m) => {
      const kids = m.items
        .map(
          (it) =>
            `<item identifier="${it.id}" identifierref="${it.refId}"><title>${escXml(it.title)}</title></item>`,
        )
        .join('');
      return `<item identifier="${m.id}"><title>${escXml(m.title)}</title>${kids}</item>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${courseId}" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource" xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_imscp_v1p2_v1p0.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lomresource_v1p0.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lommanifest_v1p0.xsd">
  <metadata>
    <schema>IMS Common Cartridge</schema>
    <schemaversion>1.1.0</schemaversion>
    <lomimscc:lom>
      <lomimscc:general>
        <lomimscc:title><lomimscc:string>${escXml(syllabus.courseTitle)}</lomimscc:string></lomimscc:title>
        <lomimscc:description><lomimscc:string>${escXml(syllabus.courseOverview || '')}</lomimscc:string></lomimscc:description>
      </lomimscc:general>
    </lomimscc:lom>
  </metadata>
  <organizations>
    <organization identifier="org_1" structure="rooted-hierarchy">
      <item identifier="LearningModules">${orgItems}</item>
    </organization>
  </organizations>
  <resources>${resources.join('')}</resources>
</manifest>`;
}

// ── Public API ──

export interface ImsccOptions {
  themeId?: string;
  /**
   * OpenAI key. The slide deck is image-driven (one gpt-image-2 render per
   * slide), so slides.pptx is only bundled when every slide already has a
   * rendered image — an export click must never silently spend image credits.
   */
  openaiApiKey?: string;
  /**
   * Explicit opt-in to render any missing slide images (spends OpenAI image
   * credits) so the decks can be bundled. Requires openaiApiKey. Rendered
   * images are reported through onSlideRendered so callers can cache them.
   */
  renderMissingSlides?: boolean;
  onSlideRendered?: (chapterNum: number, slideIndex: number, dataUri: string) => void;
  onSlideProgress?: (chapterNum: number, current: number, total: number, phase: string) => void;
  curriculumCsv?: string;
}

/**
 * Bundle a generated course into a **native Canvas course export** (a Common
 * Cartridge 1.1 package in the exact shape Canvas's own exporter writes), so
 * Canvas rebuilds the course faithfully on import:
 *
 *  - one published Module per chapter, in order;
 *  - the reading as a Canvas Page (plus the original interactive HTML as a file);
 *  - Practice quiz (ungraded practice quiz), In-class quiz and Weekly challenge
 *    (graded, in an "Assignments" group), all published, with correct answers;
 *  - discussions (published), slides / infographic / teaching pack as files;
 *  - the course title and a Syllabus page.
 *
 * Shape verified against Canvas's own exporter and an import into a live Canvas.
 * Audio is skipped because blob URLs are non-persistent.
 */
export async function assembleImscc(
  syllabus: Syllabus,
  chapters: GeneratedChapter[],
  opts: ImsccOptions = {},
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const courseId = gid(`course:${slug(syllabus.courseTitle) || 'course'}`);
  const settingsId = gid(`${courseId}:settings`);
  const groupId = gid(`${courseId}:assignment-group`);

  const modules: CourseModule[] = [];
  const resources: string[] = [];
  const fileRecords: FileRecord[] = [];

  /** Add a binary/text file as a web_resources download + module item. */
  const addFile = (
    mod: CourseModule,
    seed: string,
    folder: string,
    fileName: string,
    data: Blob | string,
    itemTitle: string,
    options?: { base64?: boolean },
  ) => {
    const id = gid(`${courseId}:file:${seed}`);
    const href = `web_resources/${folder}/${fileName}`;
    zip.file(href, data, options?.base64 ? { base64: true } : undefined);
    resources.push(resourceXml({ id, type: 'webcontent', href, files: [href] }));
    fileRecords.push({ id, displayName: fileName });
    mod.items.push({ id: gid(`${id}:item`), type: 'Attachment', title: itemTitle, refId: id });
  };

  const addQuiz = (
    mod: CourseModule,
    seed: string,
    title: string,
    mcqs: ParsedMcq[],
    kind: QuizKind,
  ) => {
    const quizId = gid(`${courseId}:quiz:${seed}`);
    const metaResId = gid(`${quizId}:meta`);
    const qtiPath = `${quizId}/assessment_qti.xml`;
    const metaPath = `${quizId}/assessment_meta.xml`;
    const nativePath = `non_cc_assessments/${quizId}.xml.qti`;
    zip.file(qtiPath, qtiAssessmentCc(quizId, title, mcqs));
    zip.file(nativePath, qtiAssessmentNative(quizId, title, mcqs));
    zip.file(
      metaPath,
      assessmentMetaXml({
        quizId,
        title,
        points: mcqs.length,
        kind,
        assignmentId: gid(`${quizId}:assignment`),
        groupId,
      }),
    );
    resources.push(
      resourceXml({ id: quizId, type: QTI_RESOURCE_TYPE, files: [qtiPath], dependencies: [metaResId] }),
      resourceXml({
        id: metaResId,
        type: LEARNING_APP_TYPE,
        href: metaPath,
        files: [metaPath, nativePath],
      }),
    );
    mod.items.push({ id: gid(`${quizId}:item`), type: 'Quizzes::Quiz', title, refId: quizId });
  };

  for (const ch of chapters) {
    const folder = `chapter-${ch.number}-${slug(ch.title)}`;
    const mod: CourseModule = {
      id: gid(`${courseId}:module:${ch.number}`),
      title: `Chapter ${ch.number}: ${ch.title}`,
      items: [],
    };

    // 1. Reading → native Canvas Page. (The standalone document's <style> and
    // <script> can't survive Canvas's sanitizer, so the page carries the body
    // markup; the full interactive HTML is attached further down.)
    if (ch.htmlContent) {
      const pageId = gid(`${courseId}:page:${ch.number}:reading`);
      const title = `${ch.title} — Reading`;
      const href = `wiki_content/${folder}-reading.html`;
      zip.file(href, pageHtml(pageId, title, readingBodyHtml(ch.htmlContent)));
      resources.push(resourceXml({ id: pageId, type: 'webcontent', href, files: [href] }));
      mod.items.push({ id: gid(`${pageId}:item`), type: 'WikiPage', title, refId: pageId });
    }

    // 2. Practice quiz → ungraded Practice Quiz.
    if (ch.practiceQuizData) {
      const mcqs = parsePracticeQuizMarkdown(ch.practiceQuizData);
      if (mcqs.length > 0) {
        addQuiz(mod, `${ch.number}:practice`, `${ch.title} — Practice Quiz`, mcqs, 'practice_quiz');
      }
    }

    // 3. In-class quiz → graded quiz.
    if (ch.inClassQuizData && ch.inClassQuizData.length > 0) {
      addQuiz(
        mod,
        `${ch.number}:inclass`,
        `${ch.title} — In-Class Quiz`,
        ch.inClassQuizData.map(inClassToMcq),
        'assignment',
      );
    }

    // 4. Weekly challenge → graded quiz (MCQ subset; other types are skipped).
    if (ch.weeklyChallengeData) {
      const mcqs = weeklyToMcqs(ch.weeklyChallengeData);
      if (mcqs.length > 0) {
        addQuiz(
          mod,
          `${ch.number}:challenge`,
          `Week ${ch.number} Challenge — ${ch.title}`,
          mcqs,
          'assignment',
        );
      }
    }

    // 5. Discussion prompts → native Canvas Discussions (one per prompt).
    if (ch.discussionData && ch.discussionData.length > 0) {
      ch.discussionData.forEach((d, i) => {
        const idx = i + 1;
        const title = `${ch.title} — Discussion ${idx}: ${d.hook}`;
        const body = `<p><strong>[${escHtml(d.hook)}]</strong></p><p>${escHtml(d.prompt)}</p>`;
        const topicId = gid(`${courseId}:topic:${ch.number}:${idx}`);
        const metaId = gid(`${topicId}:meta`);
        zip.file(`${topicId}.xml`, discussionTopicXml(title, body));
        zip.file(`${metaId}.xml`, topicMetaXml(metaId, topicId, title));
        resources.push(
          resourceXml({
            id: topicId,
            type: DISCUSSION_RESOURCE_TYPE,
            files: [`${topicId}.xml`],
            dependencies: [metaId],
          }),
          resourceXml({
            id: metaId,
            type: LEARNING_APP_TYPE,
            href: `${metaId}.xml`,
            files: [`${metaId}.xml`],
          }),
        );
        mod.items.push({ id: gid(`${topicId}:item`), type: 'DiscussionTopic', title, refId: topicId });
      });
    }

    // 6. Slides PPTX. Only when every imagePrompt slide is already rendered this
    // session (rendered images aren't persisted across reloads) — see openaiApiKey.
    const slidesFullyRendered =
      !!ch.slidesJson &&
      ch.slidesJson.length > 0 &&
      ch.slidesJson.every((sl) => !sl.imagePrompt?.trim() || !!sl.imageDataUri);
    const includeSlides = slidesFullyRendered || (opts.renderMissingSlides && !!ch.slidesJson?.length);
    if (includeSlides && opts.openaiApiKey?.trim() && ch.slidesJson) {
      try {
        const { generatePptx } = await import('./pptxExporter');
        const preRendered: Record<number, string> = {};
        ch.slidesJson.forEach((sl, i) => {
          if (sl.imageDataUri) preRendered[i] = sl.imageDataUri;
        });
        const { blob: pptxBlob } = await generatePptx(
          ch.slidesJson,
          syllabus.courseTitle,
          ch.title,
          opts.themeId,
          opts.openaiApiKey,
          {
            preRendered,
            onSlideRendered: (i, dataUri) => opts.onSlideRendered?.(ch.number, i, dataUri),
            onProgress: (current, total, phase) =>
              opts.onSlideProgress?.(ch.number, current, total, phase),
          },
        );
        addFile(mod, `${ch.number}:slides`, folder, 'slides.pptx', pptxBlob, `${ch.title} — Slides`);
      } catch {
        /* pptx generation failed */
      }
    }

    // 7. Infographic.
    if (ch.infographicDataUri) {
      const m = ch.infographicDataUri.match(/^data:[^;]+;base64,(.+)$/);
      if (m) {
        addFile(mod, `${ch.number}:infographic`, folder, 'infographic.jpg', m[1], `${ch.title} — Infographic`, {
          base64: true,
        });
      }
    }

    // 8. Teaching resources DOCX (kept alongside the native discussions because
    // it also carries the step-by-step activity guides, which have no native analogue).
    const hasTeachingContent =
      (ch.discussionData && ch.discussionData.length > 0) ||
      (ch.activityData && ch.activityData.length > 0);
    if (hasTeachingContent) {
      try {
        const { generateTeachingResourcesDocx } = await import('./teachingResourcesDocx');
        const docxBlob = await generateTeachingResourcesDocx(ch, syllabus);
        if (docxBlob) {
          addFile(
            mod,
            `${ch.number}:teaching`,
            folder,
            'teaching-resources.docx',
            docxBlob,
            `${ch.title} — Teaching Resources`,
          );
        }
      } catch {
        /* docx generation failed */
      }
    }

    // 9. The original interactive reading, for anyone who wants the full-fidelity
    // version (Canvas Pages drop scripts and styles).
    if (ch.htmlContent) {
      addFile(
        mod,
        `${ch.number}:reading-interactive`,
        folder,
        'reading-interactive.html',
        ch.htmlContent,
        `${ch.title} — Reading (interactive HTML, download)`,
      );
    }

    modules.push(mod);
  }

  // Course-level resources.
  if (opts.curriculumCsv) {
    const mod: CourseModule = {
      id: gid(`${courseId}:module:resources`),
      title: 'Course resources',
      items: [],
    };
    addFile(
      mod,
      'curriculum',
      'course',
      'curriculum-alignment-matrix.csv',
      opts.curriculumCsv,
      'Curriculum Alignment Matrix',
    );
    modules.push(mod);
  }

  // Course settings (native shape — same files and resource layout as Canvas's exporter).
  zip.file('course_settings/course_settings.xml', courseSettingsXml(courseId, syllabus));
  zip.file('course_settings/module_meta.xml', moduleMetaXml(modules));
  zip.file('course_settings/assignment_groups.xml', assignmentGroupsXml(groupId));
  zip.file('course_settings/files_meta.xml', filesMetaXml(fileRecords));
  zip.file('course_settings/syllabus.html', syllabusHtml(syllabus));
  zip.file(
    'course_settings/canvas_export.txt',
    'Generated by CanvasClassBuild — native Canvas course export (Common Cartridge 1.1).',
  );
  resources.unshift(
    resourceXml({
      id: `${settingsId}_syllabus`,
      type: LEARNING_APP_TYPE,
      href: 'course_settings/syllabus.html',
      intendeduse: 'syllabus',
      files: ['course_settings/syllabus.html'],
    }),
    resourceXml({
      id: settingsId,
      type: LEARNING_APP_TYPE,
      href: 'course_settings/canvas_export.txt',
      files: [
        'course_settings/course_settings.xml',
        'course_settings/module_meta.xml',
        'course_settings/assignment_groups.xml',
        'course_settings/files_meta.xml',
        'course_settings/canvas_export.txt',
      ],
    }),
  );

  zip.file('imsmanifest.xml', manifestXml({ courseId, settingsId, syllabus, modules, resources }));

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
