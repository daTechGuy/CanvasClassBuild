/**
 * Offline structural validation of a Common Cartridge (.imscc) destined for
 * Canvas. Not imported by the app (so it is never bundled) — it is used by the
 * test suite, by `tools/validate-imscc.ts`, and could back an in-app "check
 * before download" later.
 *
 * Why this exists: Canvas happily reports "imported, no issues" for a cartridge
 * that silently drops content. A package carrying `course_settings/canvas_export.txt`
 * is classified as a *native Canvas export*, and Canvas's native converter reads
 * only Canvas's own files (module_meta.xml, wiki_content/, non_cc_assessments/…)
 * while ignoring plain manifest content. These rules catch that class of problem
 * without needing a live Canvas.
 *
 * This is a structural check only — it cannot prove Canvas will accept a package.
 * An import into a real Canvas (see tools/canvas-test/) remains the source of truth.
 */
import JSZip from 'jszip';

export interface ValidationReport {
  /** Hard errors: Canvas will drop or mangle content. */
  problems: string[];
  /** Things worth a look but not fatal. */
  warnings: string[];
  info: string[];
  ok: boolean;
}

export type ImsccInput = Uint8Array | ArrayBuffer | Blob;

const NATIVE_MARKER = 'course_settings/canvas_export.txt';
const QTI_RESOURCE = 'imsqti_xmlv1p2/imscc_xmlv1p1/assessment';
const RESOURCE_BACKED_ITEMS = new Set(['WikiPage', 'Quizzes::Quiz', 'DiscussionTopic', 'Attachment', 'Assignment']);
const KNOWN_ITEM_TYPES = new Set([
  ...RESOURCE_BACKED_ITEMS,
  'ExternalUrl',
  'ContextExternalTool',
  'ContextModuleSubHeader',
]);
const KNOWN_RESOURCE_TYPE =
  /^(webcontent|imsdt_xmlv1p\d|imsqti_xmlv1p\d\/imscc_xmlv1p\d\/assessment|associatedcontent\/imscc_xmlv1p\d\/learning-application-resource|imsbasiclti_xmlv1p\d|imswl_xmlv1p\d|imsqti_xmlv1p\d\/.*)$/;

function local(el: Element): string {
  return el.localName || el.tagName.replace(/^.*:/, '');
}

function descendants(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((e) => local(e) === name);
}

function childText(el: Element, name: string): string | null {
  const c = Array.from(el.children).find((x) => local(x) === name);
  return c ? (c.textContent ?? '') : null;
}

function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (!doc || doc.getElementsByTagName('parsererror').length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

export async function validateImscc(input: ImsccInput): Promise<ValidationReport> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input as Blob);
  } catch (e) {
    return { problems: [`not a readable zip archive: ${(e as Error).message}`], warnings, info, ok: false };
  }

  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const nameSet = new Set(names);
  const read = (n: string) => zip.file(n)!.async('string');

  // 1. Archive basics
  if (!nameSet.has('imsmanifest.xml')) {
    return { problems: ['imsmanifest.xml missing at archive root'], warnings, info, ok: false };
  }
  const backslashed = names.filter((n) => n.includes('\\'));
  if (backslashed.length) problems.push(`backslash paths in archive: ${backslashed.slice(0, 3).join(', ')}`);

  // 2. Every XML part parses
  let xmlOk = 0;
  for (const n of names) {
    if (/\.(xml|qti)$/.test(n)) {
      const text = await read(n);
      // DOM parsers are lenient about a bare "&" (e.g. a title like "R&D"), but Canvas's
      // XML parser is not — check for it explicitly.
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text)) {
        problems.push(`unescaped "&" in XML: ${n}`);
      } else if (parseXml(text)) xmlOk++;
      else problems.push(`not well-formed XML: ${n}`);
    }
  }
  info.push(`${xmlOk} XML files parse cleanly; ${names.length} entries total`);

  // 3. Manifest integrity
  const manifestDoc = parseXml(await read('imsmanifest.xml'));
  if (!manifestDoc) return { problems: [...problems, 'imsmanifest.xml is not well-formed'], warnings, info, ok: false };
  const man = manifestDoc.documentElement;
  info.push(`manifest namespace: ${man.getAttribute('xmlns') ?? '(none)'}`);

  const resources = new Map<string, Element>();
  for (const r of descendants(man, 'resource')) resources.set(r.getAttribute('identifier') ?? '', r);

  const allIds: string[] = [];
  for (const e of descendants(man, 'resource')) allIds.push(e.getAttribute('identifier') ?? '');
  for (const e of descendants(man, 'item')) if (e.getAttribute('identifier')) allIds.push(e.getAttribute('identifier')!);
  const counts = new Map<string, number>();
  for (const id of allIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const dupIds = [...counts].filter(([, c]) => c > 1).map(([id]) => id);
  if (dupIds.length) problems.push(`duplicate identifiers in manifest: ${dupIds.slice(0, 5).join(', ')}`);

  const claimed = new Set<string>();
  const missingFiles: string[] = [];
  for (const [rid, r] of resources) {
    const hrefs = [r.getAttribute('href'), ...descendants(r, 'file').map((f) => f.getAttribute('href'))].filter(
      (h): h is string => !!h,
    );
    for (const h of hrefs) {
      claimed.add(h);
      if (!nameSet.has(h)) missingFiles.push(`${rid}→${h}`);
    }
  }
  if (missingFiles.length) {
    problems.push(
      `${missingFiles.length} manifest references to files not in the archive, e.g. ${missingFiles.slice(0, 3).join(', ')}`,
    );
  }

  // Organization items must point at real resources (empty = no resource, e.g. a sub-header).
  const orgBad: string[] = [];
  let orgItems = 0;
  for (const item of descendants(man, 'item')) {
    orgItems++;
    const ref = item.getAttribute('identifierref');
    if (ref && !resources.has(ref)) orgBad.push(ref);
  }
  if (orgBad.length) problems.push(`item identifierref pointing at unknown resources: ${orgBad.slice(0, 5).join(', ')}`);
  info.push(`${resources.size} resources, ${orgItems} organization items`);

  const unclaimed = names.filter((n) => n !== 'imsmanifest.xml' && !claimed.has(n));
  if (unclaimed.length) {
    warnings.push(
      `${unclaimed.length} archive files not claimed by any resource (Canvas ignores them): ${unclaimed.slice(0, 4).join(', ')}`,
    );
  }

  // 4. Resource types
  const typeCounts = new Map<string, number>();
  for (const r of resources.values()) {
    const t = r.getAttribute('type') ?? '';
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    if (!KNOWN_RESOURCE_TYPE.test(t)) warnings.push(`unrecognised resource type for ${r.getAttribute('identifier')}: ${t}`);
  }
  info.push('resource types: ' + [...typeCounts].map(([k, v]) => `${k} x${v}`).join(', '));

  // 5. QTI sanity
  let qtiFiles = 0;
  for (const n of names.filter((x) => /\.(xml|qti)$/.test(x))) {
    const text = await read(n);
    if (!text.includes('<questestinterop')) continue;
    qtiFiles++;
    const doc = parseXml(text);
    if (!doc) continue;
    const items = descendants(doc, 'item');
    if (items.length === 0) problems.push(`QTI file with no items: ${n}`);
    for (const it of items) {
      if (descendants(it, 'response_lid').length === 0) warnings.push(`${n}: item ${it.getAttribute('ident')} has no response_lid`);
      if (descendants(it, 'varequal').length === 0) {
        warnings.push(`${n}: item ${it.getAttribute('ident')} has no varequal (no correct answer wired)`);
      }
    }
  }
  info.push(`${qtiFiles} QTI assessment files`);

  // 6. Native-Canvas-format rules
  if (nameSet.has(NATIVE_MARKER)) {
    info.push('native Canvas export marker present: applying native-format rules');

    if (!nameSet.has('course_settings/module_meta.xml')) {
      problems.push(
        'native marker present but course_settings/module_meta.xml is missing: Canvas will create NO modules',
      );
    } else {
      const mm = parseXml(await read('course_settings/module_meta.xml'));
      if (mm) {
        const orgIds = new Set(descendants(man, 'item').map((e) => e.getAttribute('identifier')));
        const modItems = descendants(mm, 'item');
        for (const it of modItems) {
          const ref = childText(it, 'identifierref');
          const ctype = childText(it, 'content_type') ?? '';
          if (RESOURCE_BACKED_ITEMS.has(ctype) && (!ref || !resources.has(ref))) {
            problems.push(`module_meta ${ctype} item points at unknown resource ${ref}`);
          }
          if (!orgIds.has(it.getAttribute('identifier'))) {
            warnings.push(`module_meta item ${it.getAttribute('identifier')} is not in the manifest organization`);
          }
          if (!KNOWN_ITEM_TYPES.has(ctype)) warnings.push(`unusual module item content_type ${ctype}`);
        }
        info.push(`${descendants(mm, 'module').length} modules, ${modItems.length} module items in module_meta.xml`);
      }
    }

    for (const n of names.filter((x) => x.startsWith('wiki_content/') && x.endsWith('.html'))) {
      const body = await read(n);
      if (!claimed.has(n)) {
        problems.push(
          `${n}: not listed in the manifest, but the native importer scans wiki_content/ directly: it would be imported as a stray page`,
        );
      }
      if (!body.includes('name="identifier"')) {
        problems.push(`${n}: wiki page has no <meta name="identifier">: Canvas cannot match it`);
      }
      if (/<script|<style/i.test(body)) warnings.push(`${n}: <script>/<style> will be stripped by Canvas`);
    }

    for (const [rid, r] of resources) {
      if (r.getAttribute('type') !== QTI_RESOURCE) continue;
      const dep = descendants(r, 'dependency')[0]?.getAttribute('identifierref');
      const metaRes = dep ? resources.get(dep) : undefined;
      if (!metaRes) {
        problems.push(`quiz resource ${rid} has no assessment_meta dependency`);
        continue;
      }
      const mfiles = descendants(metaRes, 'file').map((f) => f.getAttribute('href') ?? '');
      if (!mfiles.some((f) => f.startsWith('non_cc_assessments/') && f.endsWith('.xml.qti'))) {
        problems.push(
          `quiz ${rid}: native importer needs non_cc_assessments/<id>.xml.qti in its meta resource - quiz would import with no questions`,
        );
      }
      if (!mfiles.some((f) => f.endsWith('assessment_meta.xml'))) {
        problems.push(`quiz ${rid}: meta resource lacks assessment_meta.xml`);
      }
    }
    for (const n of names.filter((x) => x.startsWith('non_cc_assessments/') && x.endsWith('.xml.qti'))) {
      const t = await read(n);
      if (t.includes('<item ') && !t.includes('question_type')) problems.push(`${n}: items lack the Canvas question_type metadata`);
    }
  }

  // 7. External hosts referenced from pages (need internet in Canvas)
  const external = new Map<string, number>();
  for (const n of names.filter((x) => x.endsWith('.html'))) {
    for (const m of (await read(n)).matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)/g)) {
      const host = m[1].split('/')[2];
      external.set(host, (external.get(host) ?? 0) + 1);
    }
  }
  if (external.size) {
    warnings.push(
      'external hosts referenced from pages (need internet in Canvas): ' +
        [...external].map(([h, c]) => `${h} x${c}`).join(', '),
    );
  }

  return { problems, warnings, info, ok: problems.length === 0 };
}
