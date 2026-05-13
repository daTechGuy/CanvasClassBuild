import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseImsccTemplate } from '../src/services/template/parser';

/**
 * Build a minimal in-memory Canvas .imscc that exercises the parser's
 * classification + prefix detection + example-pattern extraction paths.
 * Mirrors the structure of a real Canvas course export but with the
 * smallest possible content so the test stays focused.
 */
async function buildFixtureImscc(): Promise<Uint8Array> {
  const zip = new JSZip();

  // ── Resource href map → resource IDs are referenced from module_meta
  //    items and the manifest's <resource> entries.
  const wikiM1OverviewId = 'res_m1_overview';
  const wikiM1NotesId = 'res_m1_notes';
  const wikiM2OverviewId = 'res_m2_overview';
  const wikiM2NotesId = 'res_m2_notes';
  const discIntroId = 'res_disc_intro';

  // Modules:
  // 1. "Begin Here: Introductory Module" — verbatim
  // 2. "Module 1:" — pattern (placeholder, items use (Example to Edit))
  // 3. "Module 2: Data Visualization" — example-pattern (filled)
  zip.file('course_settings/module_meta.xml', `<?xml version="1.0" encoding="UTF-8"?>
<modules xmlns="http://canvas.instructure.com/xsd/cccv1p0">
  <module identifier="mod_begin">
    <title>Begin Here: Introductory Module</title>
    <workflow_state>active</workflow_state>
    <position>1</position>
    <require_sequential_progress>false</require_sequential_progress>
    <locked>false</locked>
    <items>
      <item identifier="item_begin_disc">
        <content_type>DiscussionTopic</content_type>
        <workflow_state>active</workflow_state>
        <title>Student Introductions</title>
        <identifierref>${discIntroId}</identifierref>
        <position>1</position>
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
      <item identifier="item_m1_sub">
        <content_type>ContextModuleSubHeader</content_type>
        <workflow_state>active</workflow_state>
        <title>Review the module overview:</title>
        <position>1</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
      <item identifier="item_m1_overview">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>Module 1 Overview</title>
        <identifierref>${wikiM1OverviewId}</identifierref>
        <position>2</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
      <item identifier="item_m1_notes_demo">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>M1 Instructor Notes: What is Data? (Example to Edit)</title>
        <identifierref>${wikiM1NotesId}</identifierref>
        <position>3</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
      <item identifier="item_m1_edit_note">
        <content_type>WikiPage</content_type>
        <workflow_state>unpublished</workflow_state>
        <title>Meet Your Instructor **EDIT**</title>
        <position>4</position>
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
      <item identifier="item_m2_sub">
        <content_type>ContextModuleSubHeader</content_type>
        <workflow_state>active</workflow_state>
        <title>Read/View the following materials:</title>
        <position>1</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
      <item identifier="item_m2_overview">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>Module 2 Overview</title>
        <identifierref>${wikiM2OverviewId}</identifierref>
        <position>2</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
      <item identifier="item_m2_notes_a">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>M2 Instructor Notes: What is Data Visualization?</title>
        <identifierref>${wikiM2NotesId}</identifierref>
        <position>3</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
      <item identifier="item_m2_notes_b">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>M2 Instructor Notes: R for Data Visualization</title>
        <identifierref>${wikiM2NotesId}</identifierref>
        <position>4</position>
        <new_tab>false</new_tab>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
    </items>
  </module>
</modules>`);

  // Course settings
  zip.file('course_settings/course_settings.xml', `<?xml version="1.0" encoding="UTF-8"?>
<course identifier="test" xmlns="http://canvas.instructure.com/xsd/cccv1p0">
  <title>Test Course</title>
  <course_code>TEST-101</course_code>
</course>`);

  // imsmanifest.xml maps resource identifiers to file hrefs
  zip.file('imsmanifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="test_manifest" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1">
  <resources>
    <resource identifier="${wikiM1OverviewId}" type="webcontent" href="wiki_content/m1-overview.html">
      <file href="wiki_content/m1-overview.html"/>
    </resource>
    <resource identifier="${wikiM1NotesId}" type="webcontent" href="wiki_content/m1-notes-demo.html">
      <file href="wiki_content/m1-notes-demo.html"/>
    </resource>
    <resource identifier="${wikiM2OverviewId}" type="webcontent" href="wiki_content/m2-overview.html">
      <file href="wiki_content/m2-overview.html"/>
    </resource>
    <resource identifier="${wikiM2NotesId}" type="webcontent" href="wiki_content/m2-notes-a.html">
      <file href="wiki_content/m2-notes-a.html"/>
    </resource>
    <resource identifier="${discIntroId}" type="imsdt_xmlv1p1" href="discussions/intro.xml">
      <file href="discussions/intro.xml"/>
    </resource>
  </resources>
</manifest>`);

  // Wiki bodies
  zip.file('wiki_content/m1-overview.html', `<html><head><title>Module 1 Overview</title></head><body><p>Module 1 overview body.</p></body></html>`);
  zip.file('wiki_content/m1-notes-demo.html', `<html><head><title>M1 Instructor Notes: What is Data?</title></head><body><p>Sample note content.</p></body></html>`);
  zip.file('wiki_content/m2-overview.html', `<html><head><title>Module 2 Overview</title></head><body><h2>Module 2 Overview</h2><p>Real overview body for Module 2.</p></body></html>`);
  zip.file('wiki_content/m2-notes-a.html', `<html><head><title>M2 Notes: What is Data Visualization?</title></head><body><h2>What is Data Visualization?</h2><p>Real content here.</p></body></html>`);

  // Discussion topic XML for the introductory module
  zip.file('discussions/intro.xml', `<?xml version="1.0" encoding="UTF-8"?>
<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1">
  <title>Student Introductions</title>
  <text texttype="text/html">&lt;p&gt;Introduce yourself!&lt;/p&gt;</text>
</topic>`);

  // A web_resources image + an LTI link to exercise those code paths
  zip.file('web_resources/Images/Logo.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  zip.file('lti_resource_links/g123.xml', `<?xml version="1.0" encoding="UTF-8"?><cartridge_basiclti_link/>`);

  return zip.generateAsync({ type: 'uint8array' });
}

describe('parseImsccTemplate', () => {
  it('parses a fixture cartridge and classifies modules correctly', async () => {
    const bytes = await buildFixtureImscc();
    const t = await parseImsccTemplate({ file: bytes, name: 'fixture' });

    expect(t.modules).toHaveLength(3);
    expect(t.modules.map((m) => m.classification)).toEqual([
      'verbatim',
      'pattern',
      'example-pattern',
    ]);
  });

  it('surfaces course settings, images, LTI links, and parser metadata', async () => {
    const bytes = await buildFixtureImscc();
    const t = await parseImsccTemplate({ file: bytes, name: 'fixture' });

    expect(t.courseSettings.title).toBe('Test Course');
    expect(t.courseSettings.courseCode).toBe('TEST-101');
    expect(t.images).toHaveLength(1);
    expect(t.images[0].filename).toBe('Logo.jpg');
    expect(t.ltiResources).toHaveLength(1);
    expect(t.ltiResources[0].identifier).toBe('g123');
    expect(t.parserVersion).toBeGreaterThanOrEqual(3);
  });

  it('detects "Module N:" locked prefix with empty editable suffix', async () => {
    const bytes = await buildFixtureImscc();
    const t = await parseImsccTemplate({ file: bytes, name: 'fixture' });
    const mod1 = t.modules.find((m) => m.title === 'Module 1:');
    expect(mod1).toBeDefined();
    expect(mod1!.titleLockedPrefix).toMatch(/^Module\s+1:$/i);
    expect(mod1!.titleEditableSuffix).toBe('');
  });

  it('detects "Module N:" locked prefix with filled editable suffix', async () => {
    const bytes = await buildFixtureImscc();
    const t = await parseImsccTemplate({ file: bytes, name: 'fixture' });
    const mod2 = t.modules.find((m) => m.title.startsWith('Module 2:'));
    expect(mod2).toBeDefined();
    expect(mod2!.titleEditableSuffix).toBe('Data Visualization');
  });

  it('treats "Module N Overview" as a fully-locked title (no editable suffix slot)', async () => {
    const bytes = await buildFixtureImscc();
    const t = await parseImsccTemplate({ file: bytes, name: 'fixture' });
    const mod1 = t.modules.find((m) => m.title === 'Module 1:')!;
    const overview = mod1.items.find((i) => i.title === 'Module 1 Overview');
    expect(overview).toBeDefined();
    expect(overview!.titleLockedPrefix).toMatch(/^Module\s+1\s+Overview$/i);
    expect(overview!.titleEditableSuffix).toBeUndefined();
  });

  it('detects "MN Instructor Notes:" prefix on items', async () => {
    const bytes = await buildFixtureImscc();
    const t = await parseImsccTemplate({ file: bytes, name: 'fixture' });
    const mod2 = t.modules.find((m) => m.title.startsWith('Module 2:'))!;
    const note = mod2.items.find((i) => i.title.includes('What is Data Visualization'));
    expect(note).toBeDefined();
    expect(note!.titleLockedPrefix).toMatch(/^M2\s+Instructor\s+Notes:$/i);
    expect(note!.titleEditableSuffix).toBe('What is Data Visualization?');
  });

  it('recognizes "(Example to Edit)" as placeholder marker (Module 1 stays pattern, not example-pattern)', async () => {
    const bytes = await buildFixtureImscc();
    const t = await parseImsccTemplate({ file: bytes, name: 'fixture' });
    const mod1 = t.modules.find((m) => m.title === 'Module 1:')!;
    // The fixture's only Module 1 item with a suffix has "(Example to Edit)",
    // so the classifier shouldn't flag it as filled content.
    expect(mod1.classification).toBe('pattern');
  });

  it('flags **EDIT** markers on item titles', async () => {
    const bytes = await buildFixtureImscc();
    const t = await parseImsccTemplate({ file: bytes, name: 'fixture' });
    const mod1 = t.modules.find((m) => m.title === 'Module 1:')!;
    const edit = mod1.items.find((i) => i.title.includes('Meet Your Instructor'));
    expect(edit).toBeDefined();
    expect(edit!.editMarker).toBe('EDIT');
  });

  it('extracts examplePatternContent from the example-pattern module', async () => {
    const bytes = await buildFixtureImscc();
    const t = await parseImsccTemplate({ file: bytes, name: 'fixture' });
    expect(t.examplePatternContent).toBeDefined();
    expect(t.examplePatternContent!.sourceModuleTitle).toMatch(/Module 2/);
    expect(t.examplePatternContent!.moduleOverviewHtml).toMatch(/Real overview body/);
    expect(t.examplePatternContent!.instructorNotes.length).toBeGreaterThan(0);
    expect(t.examplePatternContent!.instructorNotes[0].htmlContent).toMatch(
      /Real content here|What is Data Visualization/,
    );
  });
});
