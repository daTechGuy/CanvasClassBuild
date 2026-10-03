"""Offline structural validation of a Common Cartridge (.imscc) for Canvas import.

Checks the things Canvas's importer is strict about: well-formed XML, manifest
integrity (every referenced file exists, identifiers unique, item->resource
links resolve), resource types, QTI shape, and Canvas-specific extras.

Usage: python tools/validate-imscc.py path/to/course.imscc
Exit code is 1 if any hard problem is found. This is a structural check only —
it cannot prove Canvas will accept the package; do a real import for that.
"""
import sys
import zipfile
import re
from collections import Counter
from xml.etree import ElementTree as ET

path = sys.argv[1]
z = zipfile.ZipFile(path)
names = z.namelist()
nameset = set(names)
problems, warnings, info = [], [], []

def local(tag):
    return tag.split('}', 1)[-1]

# 1. Archive basics
if 'imsmanifest.xml' not in nameset:
    problems.append('imsmanifest.xml missing at archive root')
bad = z.testzip()
if bad:
    problems.append(f'corrupt zip member: {bad}')
dirs = [n for n in names if n.endswith('/')]
backslash = [n for n in names if '\\' in n]
if backslash:
    problems.append(f'backslash paths in archive: {backslash[:3]}')
dupes = [n for n, c in Counter(names).items() if c > 1]
if dupes:
    problems.append(f'duplicate archive entries: {dupes[:3]}')

# 2. Every .xml/.html parses
xml_ok = 0
for n in names:
    if n.endswith('.xml') or n.endswith('.qti'):
        try:
            ET.fromstring(z.read(n))
            xml_ok += 1
        except ET.ParseError as e:
            problems.append(f'not well-formed XML: {n}: {e}')
info.append(f'{xml_ok} XML files parse cleanly; {len(names)} entries total')

# 3. Manifest integrity
man = ET.fromstring(z.read('imsmanifest.xml'))
ns = man.tag.split('}')[0].strip('{') if '}' in man.tag else ''
info.append(f'manifest namespace: {ns}')
if 'imscc' not in ns and 'imsglobal' not in ns:
    warnings.append(f'unexpected manifest namespace: {ns}')

ids = []
resources = {}
for el in man.iter():
    t = local(el.tag)
    if t == 'resource':
        rid = el.get('identifier')
        ids.append(rid)
        resources[rid] = el
    elif t in ('item', 'organization', 'manifest'):
        if el.get('identifier'):
            ids.append(el.get('identifier'))
dup_ids = [i for i, c in Counter(ids).items() if c > 1]
if dup_ids:
    problems.append(f'duplicate identifiers in manifest: {dup_ids[:5]}')

missing_files = []
for rid, el in resources.items():
    href = el.get('href')
    if href and href not in nameset:
        missing_files.append((rid, href))
    for f in el:
        if local(f.tag) == 'file':
            fh = f.get('href')
            if fh and fh not in nameset:
                missing_files.append((rid, fh))
if missing_files:
    problems.append(f'{len(missing_files)} manifest references to files not in the archive, e.g. {missing_files[:3]}')

bad_refs = []
items = 0
for el in man.iter():
    if local(el.tag) == 'item':
        items += 1
        ref = el.get('identifierref')
        if ref and ref not in resources:
            bad_refs.append(ref)
if bad_refs:
    problems.append(f'item identifierref pointing at unknown resources: {bad_refs[:5]}')
info.append(f'{len(resources)} resources, {items} organization items')

# files in archive that no resource claims (informational)
claimed = set()
for el in resources.values():
    if el.get('href'):
        claimed.add(el.get('href'))
    for f in el:
        if local(f.tag) == 'file':
            claimed.add(f.get('href'))
unclaimed = [n for n in names if not n.endswith('/') and n != 'imsmanifest.xml' and n not in claimed]
if unclaimed:
    warnings.append(f'{len(unclaimed)} archive files not claimed by any resource (Canvas ignores them): {unclaimed[:4]}')

# 4. Resource types
types = Counter(el.get('type') for el in resources.values())
info.append('resource types: ' + ', '.join(f'{k} x{v}' for k, v in types.items()))
known = re.compile(r'^(webcontent|imsdt_xmlv1p\d|imsqti_xmlv1p\d/imscc_xmlv1p\d/assessment|associatedcontent/imscc_xmlv1p\d/learning-application-resource|imsbasiclti_xmlv1p\d|imswl_xmlv1p\d|imsqti_xmlv1p\d/.*)$')
for rid, el in resources.items():
    if not known.match(el.get('type') or ''):
        warnings.append(f'unrecognised resource type for {rid}: {el.get("type")}')

# 5. QTI sanity
qti = [n for n in names if n.endswith('.xml') and b'<questestinterop' in z.read(n)]
for n in qti:
    root = ET.fromstring(z.read(n))
    q_items = [e for e in root.iter() if local(e.tag) == 'item']
    if not q_items:
        problems.append(f'QTI file with no items: {n}')
    for it in q_items:
        # every MC item needs a response_lid + at least one varequal in respcondition
        if not any(local(e.tag) == 'response_lid' for e in it.iter()):
            warnings.append(f'{n}: item {it.get("ident")} has no response_lid')
        if not any(local(e.tag) == 'varequal' for e in it.iter()):
            warnings.append(f'{n}: item {it.get("ident")} has no varequal (no correct answer wired)')
info.append(f'{len(qti)} QTI assessment files')

# 6. Canvas extras
cs = [n for n in names if 'course_settings' in n]
info.append(f'course_settings files: {len(cs)}')
html_pages = [n for n in names if n.endswith('.html')]
info.append(f'{len(html_pages)} html pages; discussion topics: {sum(1 for n in names if "discussion" in n.lower() and n.endswith(".xml"))}')
big = [(n, z.getinfo(n).file_size) for n in names if z.getinfo(n).file_size > 5 * 1024 * 1024]
if big:
    warnings.append(f'large files (>5MB): {big}')
# external http(s) refs inside html that will break offline
ext = Counter()
for n in html_pages:
    for m in re.findall(rb'(?:src|href)=["\'](https?://[^"\']+)', z.read(n)):
        ext[m.decode().split('/')[2]] += 1
if ext:
    warnings.append('external hosts referenced from pages (need internet in Canvas): ' + ', '.join(f'{h} x{c}' for h, c in ext.items()))

# 7. Native-Canvas-format rules. A package carrying course_settings/canvas_export.txt
# is read by Canvas's NATIVE importer, which ignores plain manifest content: modules
# come from module_meta.xml, pages from wiki_content/, quizzes from non_cc_assessments/.
# A cartridge that fails these still "imports" - it just silently drops the content.
if 'course_settings/canvas_export.txt' in nameset:
    info.append('native Canvas export marker present: applying native-format rules')
    ids_all = set(resources)
    if 'course_settings/module_meta.xml' not in nameset:
        problems.append('native marker present but course_settings/module_meta.xml is missing: Canvas will create NO modules')
    else:
        mm = ET.fromstring(z.read('course_settings/module_meta.xml'))
        mod_items = [e for e in mm.iter() if local(e.tag) == 'item']
        org_ids = {e.get('identifier') for e in man.iter() if local(e.tag) == 'item'}
        for it in mod_items:
            ref = (next((c.text for c in it if local(c.tag) == 'identifierref'), None))
            ctype = next((c.text for c in it if local(c.tag) == 'content_type'), None)
            if ref not in ids_all:
                problems.append(f'module_meta item points at unknown resource {ref}')
            if it.get('identifier') not in org_ids:
                warnings.append(f'module_meta item {it.get("identifier")} is not in the manifest organization')
            if ctype not in ('WikiPage', 'Quizzes::Quiz', 'DiscussionTopic', 'Attachment', 'Assignment', 'ExternalUrl', 'ContextExternalTool', 'ContextModuleSubHeader'):
                warnings.append(f'unusual module item content_type {ctype}')
        info.append(f'{len([e for e in mm.iter() if local(e.tag) == "module"])} modules, {len(mod_items)} module items in module_meta.xml')

    for n in [n for n in names if n.startswith('wiki_content/') and n.endswith('.html')]:
        body = z.read(n)
        if b'name="identifier"' not in body:
            problems.append(f'{n}: wiki page has no <meta name="identifier">: Canvas cannot match it')
        if re.search(rb'<script|<style', body, re.I):
            warnings.append(f'{n}: <script>/<style> will be stripped by Canvas')

    for rid, el in resources.items():
        if el.get('type') == 'imsqti_xmlv1p2/imscc_xmlv1p1/assessment':
            qfiles = [f.get('href') for f in el if local(f.tag) == 'file']
            deps = [d.get('identifierref') for d in el if local(d.tag) == 'dependency']
            meta_res = resources.get(deps[0]) if deps else None
            if meta_res is None:
                problems.append(f'quiz resource {rid} has no assessment_meta dependency')
                continue
            mfiles = [f.get('href') for f in meta_res if local(f.tag) == 'file']
            if not any(f.startswith('non_cc_assessments/') and f.endswith('.xml.qti') for f in mfiles):
                problems.append(f'quiz {rid}: native importer needs non_cc_assessments/<id>.xml.qti in its meta resource - quiz would import with no questions')
            if not any(f.endswith('assessment_meta.xml') for f in mfiles):
                problems.append(f'quiz {rid}: meta resource lacks assessment_meta.xml')
    for n in [n for n in names if n.startswith('non_cc_assessments/') and n.endswith('.xml.qti')]:
        t = z.read(n)
        if b'<item ' in t and b'question_type' not in t:
            problems.append(f'{n}: items lack the Canvas question_type metadata')

print(f'== {path}')
for i in info:
    print('  info   ', i)
for w in warnings:
    print('  WARN   ', w)
for p in problems:
    print('  PROBLEM', p)
print('RESULT:', 'FAIL' if problems else 'PASS', f'({len(problems)} problems, {len(warnings)} warnings)')
sys.exit(1 if problems else 0)
