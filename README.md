# TweenPose

A browser-based 3D posing and animation editor. This repository preserves the
existing **TweenPose Studio / LightingPlus** browser application, with separate
editor modules and a local release builder. It runs on Windows in a modern
browser with WebGL; the application is HTML and JavaScript rather than a Windows
EXE.

## Run locally

This checkout includes its pinned browser libraries in `vendor/`. Open
`index.html` in a modern browser. If your browser restricts imported resources
when opening a local file, use a local web server instead:

```powershell
py -m http.server 8000 --bind 127.0.0.1
```

Keep that terminal open and visit `http://127.0.0.1:8000/`. Press Ctrl+C to stop.
Python is only used to serve the files; it is not an application dependency.
Browser/GPU support and file permissions can affect import and export behavior.

## Features in the existing code

- Pose and edit 3D parts; import supported models and manage parent relationships.
- Work with animation keys, interpolation, timelines, motion paths and motion blur.
- Draw and animate face expressions.
- Adjust scene lighting using the LightingPlus controls.
- Save/load project files and use local browser backups.
- Export animations using the formats offered in the application.

Start with an empty scene and create or import your own work. No personal models,
drawings, animation projects, browser databases or exports are distributed here.
The source checkout disables legacy backup import and uses a separate
`TweenPose GitHub` backup scope. User-created projects and browser storage stay
on the user's computer; browser backups are not a substitute for exported
project files.

## Edit and rebuild

Install a supported Node.js release with built-in `fetch` and
`AbortSignal.timeout` (Node.js 20 or later meets these build API requirements).
There are no npm packages to install.

```powershell
node tweenpose-build.cjs
node tweenpose-release.cjs
node tweenpose-release.test.cjs
```

The source build updates the marked module blocks in `index.html`. Edit those
modules in their matching `tweenpose-*.js` files; edit lighting in
`tweenpose-lighting.html` (styles and script), and edit the remaining HTML/core
application code directly in `index.html`. The lighting module was extracted
from the selected LightingPlus HTML so it remains aligned with that version.

The release builder produces `tweenpose-itch-release/` and `TweenPose-itchio.zip`
from an explicit allowlist: application HTML, eight pinned browser dependencies,
the GPL license, and third-party license notices. These generated outputs are ignored by Git.
It uses the checked-in dependency and license files; if a file is missing, it
attempts to download that pinned version from the URLs recorded in the script.
The generated itch.io release has its own backup scope and disables legacy
backup import. See [TWEENPOSE-ITCH-README.md](TWEENPOSE-ITCH-README.md).

## Tests

The existing `tweenpose-*.test.cjs` scripts run in Node with mocked browser APIs
and Three.js math. They do not open a real browser or change browser storage.
The release test requires building the release first. See [VALIDATION.md](VALIDATION.md) for validation results and known limits.

## Version provenance

The chosen application is the existing October 18, 2026 LightingPlus HTML.
Its core editor modules match the archived split sources. The archived separate
lighting engine/panel and their test used a different implementation from this
later standalone version, so they are not mixed into this repository. The
LightingPlus module is extracted from the chosen application instead. This
preparation does not claim a new application version or feature change.

## License and dependencies

The original application code is licensed under **GPL-3.0-only**; see [LICENSE](LICENSE).
Third-party libraries keep their own terms. Full notices are in
[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) and `licenses/`.
Three.js 0.128.0 (including loaders and controls), JSZip 3.10.1 (MIT option),
and gifenc 1.0.3 are bundled as pinned dependencies. The Three.js test fixture
is covered by the same Three.js notice.

When distributing a built release, provide the complete corresponding source
under GPL-3.0 as well. Publish the matching source revision with the release
and preserve the original and third-party license notices. A ZIP containing
only the browser runtime is not the complete editable source repository.
