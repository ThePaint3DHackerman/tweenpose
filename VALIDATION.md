# Validation of the initial source import

Checked on Windows on October 30, 2026 with Node.js 24.22.1.

- The source HTML build and the release builder completed successfully.
- All 11 included test suites passed: app integration, direct manipulation,
  faces, geometry kernel, interpolation, motion, geometry nodes, release,
  storage UI, storage, and timeline.
- The final release suite passed all 9 checks, including the exact package
  allowlist with the GPL license, local runtime libraries, empty startup scene,
  separation from author backups, and project creation/save/restore.
- Release contents contain no embedded personal models, drawings, animations,
  browser databases, or personal machine paths. A small WebP feature-detection
  sample inside the upstream Three.js GLTFLoader is library code.

The tests use mocked browser APIs and a mock WebGL renderer, with real Three.js
math. They do not open a real browser, inspect existing browser storage, or
verify GPU visuals, performance, or every import/export format. The archived
separate lighting-engine test belongs to a different implementation; it is not
included or counted for this LightingPlus snapshot. Visual lighting validation
in a real browser remains outside this preparation.

The source files, build recipes, pinned dependencies, and license notices are
versioned. Generated release folders, archives, user projects, and backups are
ignored. A built release must be distributed with the applicable notices and
complete corresponding source; no downloadable release was published as part
of this source import.
