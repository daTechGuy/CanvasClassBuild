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
