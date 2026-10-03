# Canvas test harness

Tools for answering one question honestly: **does the `.imscc` we export actually produce the
course we intended when imported into Canvas?**

Canvas will tell you "imported, no issues" for a cartridge that silently dropped every module, page
and quiz. (That is exactly what an earlier version of this exporter did — see *Why this exists*.) The
only reliable check is to import into a real Canvas and look at what it built.

| Piece | What it is | Needs Canvas? |
|---|---|---|
| `npm run validate:imscc -- file.imscc` | Offline structural validator ([`src/services/export/validateImscc.ts`](../../src/services/export/validateImscc.ts)) | no |
| `tests/imscc-validator.test.ts`, `tests/canvas-real-fixtures.test.ts` | Run in CI. Validator + parser + template exporter against **real Canvas-made exports** in `tests/fixtures/` | no |
| `setup-canvas.sh` | Reproducible, resumable build of a dev-mode Canvas in Docker | builds it |
| `cct.sh` | Import a cartridge into a throwaway course, wait, and dump what Canvas actually built | yes |
| `build-demo-cartridge.sh` | Generate the demo cartridges to import | no |

CI cannot run the Canvas part (it needs a ~8 GB Canvas instance), so run it by hand after changing
anything under `src/services/export/` or `src/services/template/`.

## Everyday workflow

```bash
# 1. build demo cartridges (validates them too)
tools/canvas-test/build-demo-cartridge.sh

# 2. import into Canvas and inspect what it built (Canvas on another box → set CCT_SSH)
export CCT_SSH=canvas@192.168.1.139 CCT_SSH_KEY=~/.ssh/canvas_vm_ed25519
tools/canvas-test/cct.sh import output/demo-course-native.imscc "native demo"
tools/canvas-test/cct.sh import output/demo-template-export.imscc "template demo"

# 3. tidy up (soft-deletes only courses whose name ends with " (cct)"; yours are never touched)
tools/canvas-test/cct.sh cleanup
```

`import` prints the migration state and then, per course: modules and their items, wiki pages,
quizzes (question count, **answers wired**, published, graded vs practice), discussions, assignments
and files. **Read that output — "imported" alone proves nothing.**

Other commands: `inspect [course id]`, `list`, `reference` / `template` (build a course inside Canvas and
export it with *Canvas's own exporter* — the ground truth the exporters mirror), `sync`. Run
`tools/canvas-test/cct.sh help` for the environment variables.

### Capturing / refreshing the fixtures

`tests/fixtures/canvas-reference-export.imscc` and `canvas-instructor-template.imscc` came from
`cct.sh reference` and `cct.sh template`. If Canvas changes its export format, regenerate them, **scrub
instance details** (LAN address, account UUID/ids in `course_settings/context.xml` and
`course_settings.xml`), and re-run the tests.

## Building the Canvas instance

```bash
CCT_LAN_HOST=192.168.1.139 tools/canvas-test/setup-canvas.sh        # 30–90 min the first time
```

Run on Ubuntu 22.04/24.04 with Docker + compose plugin, git, python3, openssl, curl; ~8 GB RAM (add
8 GB swap if you have no more), ~60 GB disk. It is **resumable** (finished phases are recorded under
`~/canvas-lms/.cct/state/`) and idempotent; `fixes` re-applies only the fixes, `smoke` checks it is
healthy. The admin login is written to `~/canvas-admin.txt` (mode 600).

Canvas and the QTI tool are pinned to exact commits at the top of the script. Bump them deliberately
and re-run the harness; `prod` moves.

This is **dev mode**: no email, lazy asset compilation (slow first page loads), not for real use.
It is plenty for import testing. It is **HTTP on your LAN** with a generated admin password — keep it
off the internet.

### The pitfalls this encodes (each cost real time)

1. **Instructure's Docker Hub image is from 2019.** Don't pull `instructure/canvas-lms:stable`; build from source.
2. **Publish `PORT:80`, not `PORT:3000`.** The container's nginx listens on 80; the dev compose file publishes nothing. A wrong mapping fails silently ("connection refused").
3. **The pinned source imports `@instructure/platform-alerts` without declaring it**, so the webpack step fails with `Module not found`. The script adds the dependency.
4. **Without Instructure's QTIMigrationTool, Canvas silently skips every quiz on import** (`Qti.qti_enabled?` is `false`). It must be in `vendor/QTIMigrationTool/` *before* the containers first start (detected at boot; otherwise restart `web` and `jobs`).
5. **The `jobs` container must be running.** Imports are background jobs.
6. **Run Ruby helpers from inside the bind-mounted checkout** (`.cct/`), not `tmp/` — `tmp/` is a separate Docker volume the container can't see from the host.

### A VM on Unraid (what this was built on)

Unraid can't run the setup script itself (it needs a regular Linux userland). A cloud-image VM is quick and avoids the installer: Ubuntu 24.04 cloud image resized to 100 GB, a small `cidata` seed ISO
(cloud-init: user, ssh key, swap), 6 vCPU / 8 GB RAM, bridged `br0`. Put the disk on an array disk if the
cache is nearly full. Cloud-init's default user gets passwordless sudo via
`/etc/sudoers.d/90-cloud-init-users` — remove it (after giving the user a password) when you're done.

## Why this exists

Importing a cartridge into a live Canvas showed "imported, no issues" with only the syllabus and one
discussion present — no modules, pages or quizzes. Canvas classifies any package whose manifest has
`course_settings/canvas_export.txt` as a **native Canvas export** and then reads only Canvas's own
files (`module_meta.xml`, `wiki_content/`, `non_cc_assessments/` …), ignoring plain Common Cartridge
content. The exporter now writes Canvas's native layout, and the validator encodes the rules that
would have caught it (e.g. "marker present but no `module_meta.xml`", "quiz meta resource lacks the
native QTI", "`wiki_content/` page not listed in the manifest — Canvas imports it as a stray page").
