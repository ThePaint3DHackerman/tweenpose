# TweenPose: clean itch.io release

Upload `TweenPose-itchio.zip`. It contains the application, its bundled runtime libraries, and their license notices. It does not contain your animations, imported models, face drawings, project files, exports, tests, or browser backups.

1. Create or edit your itch.io project and choose **HTML Game**.
2. Upload `TweenPose-itchio.zip` as the browser build. Keep `index.html` at the ZIP root; do not add an enclosing folder.
3. Choose **Click to launch in fullscreen** so the editor has enough room, then preview the uploaded build before publishing.

These upload and embed options follow the [official itch.io HTML5 instructions](https://itch.io/docs/creators/html5).

## What new users get

The editor opens with an empty scene, no animation keys, no drawings, and default settings. Users can create their own work and save backups normally. The release uses a separate backup namespace and does not import the working copy's older browser backups.

Your existing working copy and personal browser backups have been preserved. Browser storage is not part of the uploaded ZIP. Returning users of this release can still access their own release backups.

## Rebuilding after a code change

From the project folder, run:

```powershell
node tweenpose-build.cjs
node tweenpose-release.cjs
node tweenpose-release.test.cjs
```

The release builder includes only its explicit runtime file list. Upload the generated ZIP rather than the entire workspace. Pinned library downloads are cached for subsequent builds.

## Source and license

The generated bundle includes the GPL-3.0 license. When distributing it, also
provide the complete corresponding source under that license, including the
matching editor modules and build scripts. Publish the exact source revision
with any downloadable release and retain all third-party notices.
