import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { validateImscc } from '../src/services/export/validateImscc';
import { assembleImscc } from '../src/services/export/imsccExporter';
import { demoSyllabus, demoChapters } from '../src/fixtures/demoCourse';

// Real exports produced by Canvas's own exporter (scrubbed of instance details).
// If the validator ever flags these, the validator is wrong — not Canvas.
const referenceExport = () => new Uint8Array(readFileSync('tests/fixtures/canvas-reference-export.imscc'));
const instructorTemplate = () => new Uint8Array(readFileSync('tests/fixtures/canvas-instructor-template.imscc'));

type Mutator = (zip: JSZip) => Promise<void> | void;

async function mutated(bytes: Uint8Array, mutate: Mutator): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  await mutate(zip);
  return zip.generateAsync({ type: 'uint8array' });
}

async function text(zip: JSZip, path: string): Promise<string> {
  return zip.file(path)!.async('string');
}

describe('validateImscc — accepts what Canvas itself produces', () => {
  it('passes Canvas\'s own course export (no false positives)', async () => {
    const r = await validateImscc(referenceExport());
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.info.join('\n')).toContain('native Canvas export marker present');
  });

  it('passes Canvas\'s own instructor template, incl. sub-headers and inline external links', async () => {
    // A sub-header has no resource and an external-URL item carries its URL inline with an
    // identifierref that matches nothing — both are normal in a real export.
    const r = await validateImscc(instructorTemplate());
    expect(r.problems).toEqual([]);
  });

  it('passes our own native export', async () => {
    const blob = await assembleImscc(demoSyllabus, demoChapters, { curriculumCsv: 'a,b\n1,2\n' });
    const r = await validateImscc(new Uint8Array(await blob.arrayBuffer()));
    expect(r.problems).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.info.join('\n')).toMatch(/3 modules, 13 module items/);
  });
});

describe('validateImscc — catches the failures that import "cleanly" but lose content', () => {
  it('flags a native-marker cartridge with no module_meta.xml (Canvas would create no modules)', async () => {
    const bytes = await mutated(referenceExport(), (z) => {
      z.remove('course_settings/module_meta.xml');
    });
    const r = await validateImscc(bytes);
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/module_meta\.xml is missing.*NO modules/);
  });

  it('flags a quiz whose meta resource lacks the native QTI (it would import with no questions)', async () => {
    const bytes = await mutated(referenceExport(), async (z) => {
      const manifest = await text(z, 'imsmanifest.xml');
      z.file('imsmanifest.xml', manifest.replace(/<file href="non_cc_assessments\/[^"]+\.xml\.qti"\/>\s*(?=<\/resource>\s*<resource identifier="g952)/, ''));
    });
    // Drop every non_cc reference from the first quiz's meta resource.
    const bytes2 = await mutated(bytes, async (z) => {
      const m = await text(z, 'imsmanifest.xml');
      z.file(
        'imsmanifest.xml',
        m.replace(/(<resource identifier="gb445[^"]*"[^>]*>[\s\S]*?)<file href="non_cc_assessments\/[^"]+"\/>/, '$1'),
      );
    });
    const r = await validateImscc(bytes2);
    expect(r.problems.join('\n')).toMatch(/non_cc_assessments\/<id>\.xml\.qti/);
  });

  it('flags a wiki_content page the manifest does not list (imported as a stray duplicate page)', async () => {
    const bytes = await mutated(referenceExport(), (z) => {
      z.file(
        'wiki_content/stray.html',
        '<html><head><meta name="identifier" content="gstray"/></head><body>stale</body></html>',
      );
    });
    const r = await validateImscc(bytes);
    expect(r.problems.join('\n')).toMatch(/wiki_content\/stray\.html: not listed in the manifest/);
  });

  it('flags a wiki page without the identifier meta tag', async () => {
    const bytes = await mutated(referenceExport(), async (z) => {
      const p = 'wiki_content/chapter-1-reading.html';
      z.file(p, (await text(z, p)).replace(/<meta name="identifier"[^>]*>/, ''));
    });
    const r = await validateImscc(bytes);
    expect(r.problems.join('\n')).toMatch(/no <meta name="identifier">/);
  });

  it('flags a module item that points at a resource that does not exist', async () => {
    const bytes = await mutated(referenceExport(), async (z) => {
      const p = 'course_settings/module_meta.xml';
      z.file(p, (await text(z, p)).replace(/(<content_type>WikiPage<\/content_type>[\s\S]*?<identifierref>)[^<]+/, '$1gDOES_NOT_EXIST'));
    });
    const r = await validateImscc(bytes);
    expect(r.problems.join('\n')).toMatch(/WikiPage item points at unknown resource gDOES_NOT_EXIST/);
  });

  it('flags a manifest reference to a file that is not in the archive', async () => {
    const bytes = await mutated(referenceExport(), (z) => {
      z.remove('web_resources/unfiled/teaching-resources.docx');
    });
    const r = await validateImscc(bytes);
    expect(r.problems.join('\n')).toMatch(/manifest references to files not in the archive/);
  });

  it('flags an organization item whose identifierref matches no resource', async () => {
    const bytes = await mutated(referenceExport(), async (z) => {
      const m = await text(z, 'imsmanifest.xml');
      z.file('imsmanifest.xml', m.replace(/(<item identifier="gbf29[^"]*" identifierref=")[^"]+/, '$1gMISSING'));
    });
    const r = await validateImscc(bytes);
    expect(r.problems.join('\n')).toMatch(/identifierref pointing at unknown resources: gMISSING/);
  });

  it('flags malformed XML', async () => {
    const bytes = await mutated(referenceExport(), async (z) => {
      const p = 'course_settings/assignment_groups.xml';
      z.file(p, (await text(z, p)).replace('</assignmentGroups>', ''));
    });
    const r = await validateImscc(bytes);
    expect(r.problems.join('\n')).toMatch(/not well-formed XML: course_settings\/assignment_groups\.xml/);
  });

  it('flags a bare "&" that DOM parsers tolerate but Canvas does not (e.g. a title like R&D)', async () => {
    const bytes = await mutated(referenceExport(), async (z) => {
      const p = 'course_settings/assignment_groups.xml';
      z.file(p, (await text(z, p)).replace('<title>Assignments</title>', '<title>R&D Assignments</title>'));
    });
    const r = await validateImscc(bytes);
    expect(r.problems.join('\n')).toMatch(/unescaped "&" in XML: course_settings\/assignment_groups\.xml/);
  });

  it('does not mistake valid entities for bare ampersands', async () => {
    const bytes = await mutated(referenceExport(), async (z) => {
      const p = 'course_settings/assignment_groups.xml';
      z.file(p, (await text(z, p)).replace('<title>Assignments</title>', '<title>R&amp;D &#38; &lt;ok&gt;</title>'));
    });
    const r = await validateImscc(bytes);
    expect(r.problems).toEqual([]);
  });

  it('flags a native item with no Canvas question_type metadata', async () => {
    const bytes = await mutated(referenceExport(), async (z) => {
      const p = Object.keys(z.files).find((n) => n.startsWith('non_cc_assessments/') && n.endsWith('.xml.qti') && !n.includes('g0456'))!;
      z.file(p, (await text(z, p)).replace(/question_type/g, 'qtype_removed'));
    });
    const r = await validateImscc(bytes);
    expect(r.problems.join('\n')).toMatch(/items lack the Canvas question_type metadata/);
  });

  it('flags the OLD cartridge shape: marker + plain manifest content, no native files', async () => {
    // Reconstruct what we used to ship: Canvas marker present, quizzes as bare QTI with no
    // assessment_meta dependency, no module_meta. Canvas imported this as syllabus + discussion only.
    const bytes = await mutated(referenceExport(), async (z) => {
      z.remove('course_settings/module_meta.xml');
      const m = await text(z, 'imsmanifest.xml');
      z.file('imsmanifest.xml', m.replace(/<dependency identifierref="[^"]+"\/>/g, ''));
    });
    const r = await validateImscc(bytes);
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects input that is not a zip archive', async () => {
    const r = await validateImscc(new TextEncoder().encode('definitely not a zip'));
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/not a readable zip/);
  });

  it('rejects an archive with no manifest', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    const r = await validateImscc(await zip.generateAsync({ type: 'uint8array' }));
    expect(r.problems).toEqual(['imsmanifest.xml missing at archive root']);
  });
});
