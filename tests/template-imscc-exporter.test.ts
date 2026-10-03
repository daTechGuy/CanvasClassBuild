import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseImsccTemplate } from '../src/services/template/parser';
import { assembleTemplateImscc } from '../src/services/template/templateImsccExporter';
import type { Syllabus, GeneratedChapter, TemplateChapterContent } from '../src/types/course';

/**
 * Mirror of the parser fixture (slightly tighter) — gives us a template
 * blob with 1 verbatim module + 1 placeholder pattern + 1 example pattern.
 */
async function buildFixtureImscc(): Promise<Uint8Array> {
  const zip = new JSZip();
  const verbatimWikiId = 'res_begin_wiki';
  const discIntroId = 'res_disc_intro';
  const m1OverviewId = 'res_m1_overview';
  const m2OverviewId = 'res_m2_overview';
  const m2NotesId = 'res_m2_notes';

  zip.file('course_settings/module_meta.xml', `<?xml version="1.0" encoding="UTF-8"?>
<modules xmlns="http://canvas.instructure.com/xsd/cccv1p0">
  <module identifier="mod_begin">
    <title>Begin Here: Introductory Module</title>
    <workflow_state>active</workflow_state>
    <position>1</position>
    <require_sequential_progress>false</require_sequential_progress>
    <locked>false</locked>
    <items>
      <item identifier="item_begin_wiki">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>Begin Here</title>
        <identifierref>${verbatimWikiId}</identifierref>
        <position>1</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
      <item identifier="item_begin_disc">
        <content_type>DiscussionTopic</content_type>
        <workflow_state>active</workflow_state>
        <title>Student Introductions</title>
        <identifierref>${discIntroId}</identifierref>
        <position>2</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
    </items>
  </module>
  <module identifier="mod_1">
    <title>Module 1:</title>
    <workflow_state>active</workflow_state>
    <position>2</position>
    <require_sequential_progress>false</require_sequential_progress>
    <locked>false</locked>
    <items>
      <item identifier="item_m1_overview">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>Module 1 Overview</title>
        <identifierref>${m1OverviewId}</identifierref>
        <position>1</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
    </items>
  </module>
  <module identifier="mod_2">
    <title>Module 2: Data Visualization</title>
    <workflow_state>active</workflow_state>
    <position>3</position>
    <require_sequential_progress>false</require_sequential_progress>
    <locked>false</locked>
    <items>
      <item identifier="item_m2_overview">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>Module 2 Overview</title>
        <identifierref>${m2OverviewId}</identifierref>
        <position>1</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
      <item identifier="item_m2_notes_a">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>M2 Instructor Notes: What is Data Visualization?</title>
        <identifierref>${m2NotesId}</identifierref>
        <position>2</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
    </items>
  </module>
</modules>`);

  zip.file('course_settings/course_settings.xml', `<?xml version="1.0" encoding="UTF-8"?>
<course identifier="t" xmlns="http://canvas.instructure.com/xsd/cccv1p0">
  <title>Original Course Title</title>
  <course_code>ORIG-1</course_code>
</course>`);

  zip.file('imsmanifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="t" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1">
  <resources>
    <resource identifier="${verbatimWikiId}" type="webcontent" href="wiki_content/begin-here.html">
      <file href="wiki_content/begin-here.html"/>
    </resource>
    <resource identifier="${discIntroId}" type="imsdt_xmlv1p1" href="discussions/intro.xml">
      <file href="discussions/intro.xml"/>
    </resource>
    <resource identifier="${m1OverviewId}" type="webcontent" href="wiki_content/m1-overview.html">
      <file href="wiki_content/m1-overview.html"/>
    </resource>
    <resource identifier="${m2OverviewId}" type="webcontent" href="wiki_content/m2-overview.html">
      <file href="wiki_content/m2-overview.html"/>
    </resource>
    <resource identifier="${m2NotesId}" type="webcontent" href="wiki_content/m2-notes.html">
      <file href="wiki_content/m2-notes.html"/>
    </resource>
  </resources>
</manifest>`);

  zip.file('wiki_content/begin-here.html', `<html><body><p>Begin Here body — should pass through verbatim.</p></body></html>`);
  zip.file('wiki_content/m1-overview.html', `<html><body><p>Placeholder overview.</p></body></html>`);
  zip.file('wiki_content/m2-overview.html', `<html><body><p>Example pattern overview.</p></body></html>`);
  zip.file('wiki_content/m2-notes.html', `<html><body><h2>What is Data Visualization?</h2><p>Real content.</p></body></html>`);
  zip.file('discussions/intro.xml', `<?xml version="1.0" encoding="UTF-8"?>
<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1">
  <title>Student Introductions</title>
  <text texttype="text/html">&lt;p&gt;Hi!&lt;/p&gt;</text>
</topic>`);
  zip.file('web_resources/Images/Logo.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  zip.file('lti_resource_links/g1.xml', `<?xml version="1.0"?><cartridge_basiclti_link/>`);

  return zip.generateAsync({ type: 'uint8array' });
}

function makeChapter(num: number, title: string): GeneratedChapter {
  const tc: TemplateChapterContent = {
    moduleOverviewHtml: `<p>Overview for ${title}</p>`,
    instructorNotes: [
      { title: 'Subtopic A', htmlContent: '<p>Notes A</p>' },
      { title: 'Subtopic B', htmlContent: '<p>Notes B</p>' },
    ],
    discussion: { title: 'Discussion topic', promptHtml: '<p>Discuss.</p>' },
  };
  return { number: num, title, htmlContent: '', templateContent: tc };
}

function makeSyllabus(chapters: GeneratedChapter[]): Syllabus {
  return {
    courseTitle: 'Round-trip Course',
    courseOverview: 'Overview for round-trip test.',
    chapters: chapters.map((c) => ({
      number: c.number,
      title: c.title,
      narrative: '',
      keyConcepts: [],
      widgets: [],
      scienceAnnotations: [],
      spacingConnections: [],
    })),
  };
}

async function unzipBlob(blob: Blob): Promise<JSZip> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return JSZip.loadAsync(buf);
}

describe('assembleTemplateImscc (round-trip)', () => {
  it('parses → emits → re-parses with verbatim modules preserved and patterns replaced', async () => {
    const templateBytes = await buildFixtureImscc();
    const template = await parseImsccTemplate({ file: templateBytes, name: 'fixture' });

    const chapters = [
      makeChapter(1, 'Module 1: Generated Topic A'),
      makeChapter(2, 'Module 2: Generated Topic B'),
    ];
    const syllabus = makeSyllabus(chapters);

    const blob = await assembleTemplateImscc({
      syllabus,
      chapters,
      template,
      templateBlob: templateBytes,
    });
    const zip = await unzipBlob(blob);

    // Manifest exists and is well-formed
    const manifest = await zip.file('imsmanifest.xml')!.async('string');
    expect(manifest).toContain('imsccv1p1');

    // module_meta has 3 modules: 1 verbatim + 2 generated chapters
    const moduleMeta = await zip.file('course_settings/module_meta.xml')!.async('string');
    const moduleTitles = Array.from(moduleMeta.matchAll(/<title>([^<]+)<\/title>/g)).map(
      (m) => m[1],
    );
    expect(moduleTitles.some((t) => t === 'Begin Here: Introductory Module')).toBe(true);
    expect(moduleTitles.some((t) => t.startsWith('Module 1:'))).toBe(true);
    expect(moduleTitles.some((t) => t.startsWith('Module 2:'))).toBe(true);

    // Verbatim wiki + discussion files from the template are still in the zip
    expect(zip.file('wiki_content/begin-here.html')).toBeTruthy();
    expect(zip.file('discussions/intro.xml')).toBeTruthy();

    // web_resources + lti_resource_links pass through untouched
    expect(zip.file('web_resources/Images/Logo.jpg')).toBeTruthy();
    expect(zip.file('lti_resource_links/g1.xml')).toBeTruthy();

    // Re-parse the produced cartridge — the round-trip should classify
    // the verbatim module correctly. The newly-emitted chapter modules
    // contain authored content (overview + notes + discussion), so the
    // parser classifies them as example-pattern.
    const reparsed = await parseImsccTemplate({
      file: new Uint8Array(await blob.arrayBuffer()),
      name: 'reparsed',
    });
    expect(reparsed.modules.length).toBe(3);
    const beginHere = reparsed.modules.find((m) => m.title.includes('Begin Here'));
    expect(beginHere?.classification).toBe('verbatim');
  });

  it('applies outlineFields to the syllabus body and course title overrides', async () => {
    const templateBytes = await buildFixtureImscc();
    const template = await parseImsccTemplate({ file: templateBytes, name: 'fixture' });
    const chapters = [makeChapter(1, 'Module 1: Foo')];
    const blob = await assembleTemplateImscc({
      syllabus: makeSyllabus(chapters),
      chapters,
      template,
      templateBlob: templateBytes,
      outlineFields: {
        courseTitle: 'Overridden Title',
        courseDescription: 'Outline description.',
        courseInformation: '3 credits',
        courseMaterials: 'Bring a laptop.',
      },
    });
    const zip = await unzipBlob(blob);

    const syllabusHtml = await zip.file('course_settings/syllabus.html')!.async('string');
    expect(syllabusHtml).toContain('Overridden Title');
    expect(syllabusHtml).toContain('Outline description');
    expect(syllabusHtml).toContain('Course Information');
    expect(syllabusHtml).toContain('3 credits');
    expect(syllabusHtml).toContain('Course Materials');
    expect(syllabusHtml).toContain('Bring a laptop');

    const courseSettings = await zip.file('course_settings/course_settings.xml')!.async('string');
    expect(courseSettings).toContain('Overridden Title');
    // Original course_code passes through (not touched by the override)
    expect(courseSettings).toContain('ORIG-1');

    const manifest = await zip.file('imsmanifest.xml')!.async('string');
    expect(manifest).toContain('Overridden Title');
    expect(manifest).toContain('Outline description');
  });

  it('emits per-chapter Module N modules with overview, notes, and a discussion', async () => {
    const templateBytes = await buildFixtureImscc();
    const template = await parseImsccTemplate({ file: templateBytes, name: 'fixture' });
    const chapters = [makeChapter(1, 'Module 1: Foo'), makeChapter(2, 'Module 2: Bar')];
    const blob = await assembleTemplateImscc({
      syllabus: makeSyllabus(chapters),
      chapters,
      template,
      templateBlob: templateBytes,
    });
    const zip = await unzipBlob(blob);

    const moduleMeta = await zip.file('course_settings/module_meta.xml')!.async('string');
    // Two MN Discussion items (one per chapter) with the locked prefix
    const discussionItems = moduleMeta.match(/M\d+ Discussion:/g) ?? [];
    expect(discussionItems.length).toBe(2);
    // At least two MN Instructor Notes items per chapter (we generated 2 each)
    const noteItems = moduleMeta.match(/M\d+ Instructor Notes:/g) ?? [];
    expect(noteItems.length).toBeGreaterThanOrEqual(4);
  });
});

// ── Real-Canvas-shaped template: awkward-but-real features ──

async function buildCanvasShapedTemplate(): Promise<Uint8Array> {
  const zip = new JSZip();
  const ns = 'xmlns="http://canvas.instructure.com/xsd/cccv1p0"';
  zip.file(
    'course_settings/module_meta.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<modules ${ns}>
  <module identifier="mod_begin">
    <title>Begin Here: Introductory Module</title>
    <workflow_state>active</workflow_state>
    <position>5</position>
    <require_sequential_progress>true</require_sequential_progress>
    <locked>false</locked>
    <completion_requirements>
      <completion_requirement><item_identifierref>item_welcome</item_identifierref><type>must_view</type></completion_requirement>
    </completion_requirements>
    <items>
      <item identifier="item_welcome"><content_type>WikiPage</content_type><workflow_state>active</workflow_state><title>Welcome</title><identifierref>r_welcome</identifierref><position>1</position><new_tab/><indent>0</indent><link_settings_json>null</link_settings_json></item>
      <item identifier="item_link"><content_type>ExternalUrl</content_type><workflow_state>unpublished</workflow_state><title>Help desk</title><identifierref>g_inline_only</identifierref><url>https://example.edu/help</url><position>2</position><new_tab>true</new_tab><indent>1</indent><link_settings_json>{"selection_width":800}</link_settings_json></item>
      <item identifier="item_quiz"><content_type>Quizzes::Quiz</content_type><workflow_state>active</workflow_state><title>Syllabus quiz</title><identifierref>r_quiz</identifierref><position>3</position><new_tab/><indent>0</indent><link_settings_json>null</link_settings_json></item>
    </items>
  </module>
  <module identifier="mod_pattern">
    <title>Module 1: (Example to Edit)</title>
    <workflow_state>active</workflow_state>
    <position>6</position>
    <items>
      <item identifier="item_old_over"><content_type>WikiPage</content_type><workflow_state>active</workflow_state><title>Module 1 Overview</title><identifierref>r_old_over</identifierref><position>1</position><indent>0</indent></item>
      <item identifier="item_old_notes"><content_type>WikiPage</content_type><workflow_state>active</workflow_state><title>M1 Instructor Notes: (Example to Edit)</title><identifierref>r_old_notes</identifierref><position>2</position><indent>0</indent></item>
      <item identifier="item_old_disc"><content_type>DiscussionTopic</content_type><workflow_state>active</workflow_state><title>M1 Discussion: (Example to Edit)</title><identifierref>r_old_disc</identifierref><position>3</position><indent>0</indent></item>
    </items>
  </module>
</modules>`,
  );
  zip.file(
    'imsmanifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="tpl" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1">
  <organizations><organization identifier="org_1" structure="rooted-hierarchy">
    <item identifier="LearningModules">
      <item identifier="mod_begin"><title>Begin Here: Introductory Module</title>
        <item identifier="item_welcome" identifierref="r_welcome"><title>Welcome</title></item>
        <item identifier="item_link" identifierref="r_weblink"><title>Help desk</title></item>
        <item identifier="item_quiz" identifierref="r_quiz"><title>Syllabus quiz</title></item>
      </item>
      <item identifier="mod_pattern"><title>Module 1: (Example to Edit)</title>
        <item identifier="item_old_over" identifierref="r_old_over"><title>Module 1 Overview</title></item>
        <item identifier="item_old_notes" identifierref="r_old_notes"><title>M1 Instructor Notes: (Example to Edit)</title></item>
        <item identifier="item_old_disc" identifierref="r_old_disc"><title>M1 Discussion: (Example to Edit)</title></item>
      </item>
    </item>
  </organization></organizations>
  <resources>
    <resource identifier="r_syll" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="course_settings/syllabus.html" intendeduse="syllabus"><file href="course_settings/syllabus.html"/></resource>
    <resource identifier="r_welcome" type="webcontent" href="wiki_content/welcome.html"><file href="wiki_content/welcome.html"/></resource>
    <resource identifier="r_weblink" type="imswl_xmlv1p1"><file href="r_weblink.xml"/></resource>
    <resource identifier="r_quiz" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="r_quiz/assessment_qti.xml"/><dependency identifierref="r_quiz_meta"/></resource>
    <resource identifier="r_quiz_meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="r_quiz/assessment_meta.xml"><file href="r_quiz/assessment_meta.xml"/><file href="non_cc_assessments/r_quiz.xml.qti"/></resource>
    <resource identifier="r_old_over" type="webcontent" href="wiki_content/old-over.html"><file href="wiki_content/old-over.html"/></resource>
    <resource identifier="r_old_notes" type="webcontent" href="wiki_content/old-notes.html"><file href="wiki_content/old-notes.html"/></resource>
    <resource identifier="r_old_disc" type="imsdt_xmlv1p1"><file href="r_old_disc.xml"/><dependency identifierref="r_old_disc_meta"/></resource>
    <resource identifier="r_old_disc_meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="r_old_disc_meta.xml"><file href="r_old_disc_meta.xml"/></resource>
  </resources>
</manifest>`,
  );
  zip.file('course_settings/syllabus.html', '<html><body>old</body></html>');
  zip.file('course_settings/course_settings.xml', `<?xml version="1.0"?><course ${ns}><title>Tpl</title></course>`);
  zip.file('wiki_content/welcome.html', '<html><body>Welcome</body></html>');
  zip.file('r_weblink.xml', '<webLink/>');
  zip.file('r_quiz/assessment_qti.xml', '<questestinterop/>');
  zip.file('r_quiz/assessment_meta.xml', `<quiz ${ns}/>`);
  zip.file('non_cc_assessments/r_quiz.xml.qti', '<questestinterop/>');
  zip.file('wiki_content/old-over.html', '<html><body>OLD OVERVIEW</body></html>');
  zip.file('wiki_content/old-notes.html', '<html><body>OLD NOTES</body></html>');
  zip.file('r_old_disc.xml', '<topic/>');
  zip.file('r_old_disc_meta.xml', `<topicMeta ${ns}/>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('assembleTemplateImscc — fidelity to a real Canvas-shaped template', () => {
  const syllabus: Syllabus = {
    courseTitle: 'T',
    courseOverview: 'o',
    chapters: [
      { number: 1, title: 'Module 1: Cells', narrative: 'n', keyConcepts: ['c'], widgets: [], scienceAnnotations: [], spacingConnections: [] },
    ],
  };
  const content: TemplateChapterContent = {
    moduleOverviewHtml: '<p>NEW OVERVIEW</p>',
    instructorNotes: [{ title: 'Pacing', htmlContent: '<p>NEW NOTES</p>' }],
    discussion: { title: 'Q', promptHtml: '<p>NEW PROMPT</p>' },
  };

  async function run() {
    const bytes = await buildCanvasShapedTemplate();
    const template = await parseImsccTemplate({ file: bytes, name: 'real-shape' });
    const chapters = [
      { number: 1, title: 'Module 1: Cells', htmlContent: '', templateContent: content },
    ] as GeneratedChapter[];
    const out = await assembleTemplateImscc({ syllabus, chapters, template, templateBlob: bytes });
    return JSZip.loadAsync(new Uint8Array(await out.arrayBuffer()));
  }

  it('passes verbatim modules through intact: URL, link settings, completion requirements, sequential flag', async () => {
    const zip = await run();
    const mm = await zip.file('course_settings/module_meta.xml')!.async('string');

    // The external link keeps its URL (it was dropped before, so Canvas discarded the item).
    expect(mm).toContain('<url>https://example.edu/help</url>');
    expect(mm).toContain('{"selection_width":800}');
    expect(mm).toContain('<new_tab>true</new_tab>');
    expect(mm).toContain('<indent>1</indent>');
    // Module-level settings that used to be hard-coded away.
    expect(mm).toContain('<require_sequential_progress>true</require_sequential_progress>');
    expect(mm).toContain('<completion_requirement>');
    expect(mm).toContain('<type>must_view</type>');
    // Renumbered to the front (was position 5).
    const begin = mm.slice(mm.indexOf('identifier="mod_begin"'), mm.indexOf('</module>'));
    expect(begin).toMatch(/<\/title>\s*<workflow_state>active<\/workflow_state>\s*<position>1<\/position>/);
  });

  it('keeps the original manifest linkage for verbatim items (no dangling references)', async () => {
    const zip = await run();
    const manifest = await zip.file('imsmanifest.xml')!.async('string');
    const ids = new Set([...manifest.matchAll(/<resource identifier="([^"]+)"/g)].map((m) => m[1]));
    // The external link's org item points at its web-link resource, not at the module_meta id.
    expect(manifest).toMatch(/<item identifier="item_link" identifierref="r_weblink">/);
    for (const m of manifest.matchAll(/<item identifier="[^"]+" identifierref="([^"]+)"/g)) {
      expect(ids.has(m[1]), `dangling identifierref ${m[1]}`).toBe(true);
    }
  });

  it('keeps resource dependencies and intendeduse, so verbatim quizzes keep their metadata', async () => {
    const zip = await run();
    const manifest = await zip.file('imsmanifest.xml')!.async('string');
    expect(manifest).toMatch(/<resource identifier="r_quiz"[^>]*>[\s\S]*?<dependency identifierref="r_quiz_meta"\/>/);
    expect(manifest).toMatch(/<resource identifier="r_syll"[^>]*intendeduse="syllabus"/);
    expect(zip.file('non_cc_assessments/r_quiz.xml.qti')).toBeTruthy();
  });

  it("removes the replaced pattern module's files and metadata resources from the archive", async () => {
    const zip = await run();
    const manifest = await zip.file('imsmanifest.xml')!.async('string');

    // Canvas's native importer scans wiki_content/ directly, so stale pages must be physically gone.
    for (const gone of ['wiki_content/old-over.html', 'wiki_content/old-notes.html', 'r_old_disc.xml', 'r_old_disc_meta.xml']) {
      expect(zip.file(gone), gone).toBeNull();
    }
    for (const id of ['r_old_over', 'r_old_notes', 'r_old_disc', 'r_old_disc_meta']) {
      expect(manifest).not.toContain(`identifier="${id}"`);
    }
    // Verbatim content stays.
    expect(zip.file('wiki_content/welcome.html')).toBeTruthy();
    expect(zip.file('r_quiz/assessment_meta.xml')).toBeTruthy();
    // And the generated replacement is present.
    const pages = Object.keys(zip.files).filter((n) => n.startsWith('wiki_content/') && !n.endsWith('/'));
    const bodies = await Promise.all(pages.map((n) => zip.file(n)!.async('string')));
    expect(bodies.some((b) => b.includes('NEW OVERVIEW'))).toBe(true);
    expect(bodies.some((b) => b.includes('OLD'))).toBe(false);
  });
});
