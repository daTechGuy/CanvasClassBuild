#!/usr/bin/env bash
# Build the demo cartridges the Canvas harness imports. Run from anywhere in the repo.
#   -> output/demo-course-native.imscc        (no-template export of the demo course)
#   -> output/demo-template-export.imscc      (template export via the Canvas-made template fixture)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
CCT_BUILD=1 npx vitest run tests/build-demo-cartridge.test.ts
echo
for f in output/demo-course-native.imscc output/demo-template-export.imscc; do
  npm run -s validate:imscc -- "$f" | tail -1 | sed "s#^#$f: #"
done
