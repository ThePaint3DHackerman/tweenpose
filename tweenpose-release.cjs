/* Build the public itch.io bundle from an explicit runtime-file allowlist. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, 'tweenpose-itch-release');
// Pinned dependencies and full licenses are checked into vendor/ and licenses/.
const CACHE = ROOT;
const ARCHIVE = path.join(ROOT, 'TweenPose-itchio.zip');
const RELEASE_CONFIG = "<script>window.TweenPoseRelease={backupScope:'TweenPose itch.io',legacyBackups:false};</script>";
const LIBRARIES = [
  {name:'Three.js', version:'0.128.0', source:'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', file:'vendor/three-r128.min.js'},
  {name:'Three.js OBJLoader', version:'0.128.0', source:'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js', file:'vendor/OBJLoader.js'},
  {name:'Three.js MTLLoader', version:'0.128.0', source:'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/MTLLoader.js', file:'vendor/MTLLoader.js'},
  {name:'Three.js GLTFLoader', version:'0.128.0', source:'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js', file:'vendor/GLTFLoader.js'},
  {name:'Three.js OrbitControls', version:'0.128.0', source:'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js', file:'vendor/OrbitControls.js'},
  {name:'Three.js TransformControls', version:'0.128.0', source:'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/TransformControls.js', file:'vendor/TransformControls.js'},
  {name:'JSZip', version:'3.10.1', source:'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', file:'vendor/jszip-3.10.1.min.js'},
  {name:'gifenc', version:'1.0.3', source:'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.js', file:'vendor/gifenc-1.0.3.js'}
];
const LICENSES = [
  {name:'Three.js 0.128.0 (including its loaders and controls)', source:'https://cdn.jsdelivr.net/npm/three@0.128.0/LICENSE', file:'licenses/three-0.128.0.txt'},
  {name:'JSZip 3.10.1', source:'https://cdn.jsdelivr.net/npm/jszip@3.10.1/LICENSE.markdown', file:'licenses/jszip-3.10.1.txt'},
  {name:'gifenc 1.0.3', source:'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/LICENSE.md', file:'licenses/gifenc-1.0.3.txt'}
];
const ALLOWED = ['index.html', 'LICENSE', 'THIRD_PARTY_LICENSES.txt', ...LIBRARIES.map(x => x.file)].sort();
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

function localFile(base, relative) {
  const absolute = path.resolve(base, relative);
  if (!absolute.startsWith(path.resolve(base) + path.sep)) throw new Error('Path escapes release directory: ' + relative);
  return absolute;
}

function stripSourceMaps(text) {
  return text.replace(/^[ \t]*\/\/[#@]\s*sourceMappingURL=[^\r\n]*(?:\r?\n|$)/gm, '')
    .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '');
}

function validateDownload(asset, contents) {
  const text = contents.toString('utf8');
  if (contents.length < 100 || /^\s*</.test(text) || /Couldn't find the requested file/.test(text)) {
    throw new Error('Invalid dependency response for ' + asset.source);
  }
  if (asset.file.startsWith('licenses/') && !/permission|license/i.test(text)) {
    throw new Error('The dependency license is missing: ' + asset.source);
  }
}

async function cachedDownload(asset) {
  const target = localFile(CACHE, asset.file);
  if (fs.existsSync(target)) {
    const contents = fs.readFileSync(target);
    validateDownload(asset, contents);
    return contents;
  }
  const response = await fetch(asset.source, {signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error('Download failed (' + response.status + '): ' + asset.source);
  const contents = Buffer.from(await response.arrayBuffer());
  validateDownload(asset, contents);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, contents);
  console.log('Cached ' + asset.file);
  return contents;
}

function walkFiles(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const item of fs.readdirSync(directory, {withFileTypes:true})) {
    const relative = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error('Symlinks are not permitted in the release: ' + relative);
    if (item.isDirectory()) result.push(...walkFiles(path.join(directory, item.name), relative + '/'));
    else if (item.isFile()) result.push(relative);
    else throw new Error('Unexpected item in release directory: ' + relative);
  }
  return result.sort();
}

function releaseHTML(input) {
  let html = input.replace(/<!-- tweenpose:release-config -->[\s\S]*?<!-- \/tweenpose:release-config -->\s*/g, '');
  // Also accept the exact standalone boot flag if it has already been inserted in the source.
  html = html.split(RELEASE_CONFIG).join('');
  const seen = new Set();
  html = html.replace(/(<script\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (whole, prefix, quote, source) => {
    const library = LIBRARIES.find(item => item.source === source || item.file === source);
    if (!library) throw new Error('Unrecognized external script; add it to the release allowlist first: ' + source);
    if (seen.has(library.source)) throw new Error('Duplicate runtime dependency: ' + source);
    seen.add(library.source);
    return prefix + quote + library.file + quote;
  });
  if (seen.size !== LIBRARIES.length) throw new Error('The source runtime dependencies no longer match the release allowlist.');
  if (!/<script\b/i.test(html)) throw new Error('The source has no application scripts.');
  html = html.replace(/<script\b/i, '<!-- tweenpose:release-config -->\n' + RELEASE_CONFIG + '\n<!-- /tweenpose:release-config -->\n<script');
  if (/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html)) throw new Error('A runtime asset still depends on an external server.');
  if (/\b(?:src|href)\s*=\s*["'](?:file:\/|[a-z]:[\\/])/i.test(html)) throw new Error('The release contains a local-machine asset reference.');
  if (/data:(?:image\/(?:png|jpe?g|webp)|video\/|audio\/)[^"'\s]*;base64,/i.test(html)) {
    throw new Error('Embedded media requires a privacy review before publishing.');
  }
  return html;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  CRC_TABLE[n] = value >>> 0;
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [filename, raw] of files) {
    const name = Buffer.from(filename, 'utf8');
    const compressed = zlib.deflateRawSync(raw, {level:9});
    const data = compressed.length < raw.length ? compressed : raw;
    const method = data === raw ? 0 : 8;
    const checksum = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(method, 10); entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

async function build() {
  const cacheOnly = process.argv.includes('--cache-only');
  if (process.argv.slice(2).some(arg => arg !== '--cache-only')) throw new Error('Usage: node tweenpose-release.cjs [--cache-only]');
  const downloaded = new Map();
  const results = await Promise.allSettled([...LIBRARIES, ...LICENSES].map(async asset => {
    downloaded.set(asset.file, await cachedDownload(asset));
  }));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new Error(failures.map(result => result.reason.message).join('\n'));
  if (cacheOnly) { console.log('All pinned runtime dependencies and full licenses are cached.'); return; }
  const unexpected = walkFiles(OUTPUT).filter(file => !ALLOWED.includes(file));
  if (unexpected.length) throw new Error('Unexpected files already exist in the release directory; they were preserved and were not packaged: ' + unexpected.join(', '));
  const files = new Map();
  files.set('index.html', Buffer.from(releaseHTML(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'utf8'));
  for (const library of LIBRARIES) files.set(library.file, Buffer.from(stripSourceMaps(downloaded.get(library.file).toString('utf8')), 'utf8'));
  const licenseText = [
    'TweenPose third-party runtime dependencies',
    '=========================================',
    'These pinned browser libraries are distributed with TweenPose. Their full license texts follow.',
    'JSZip is dual-licensed; this distribution uses its MIT license option.',
    '',
    ...LIBRARIES.flatMap(library => [library.name + ' ' + library.version, 'Source: ' + library.source, 'Packaged file: ' + library.file, 'SHA-256: ' + sha256(files.get(library.file)), '']),
    ...LICENSES.flatMap(license => ['=========================================', license.name, 'License source: ' + license.source, '', downloaded.get(license.file).toString('utf8').trim(), ''])
  ].join('\n');
  files.set('THIRD_PARTY_LICENSES.txt', Buffer.from(licenseText, 'utf8'));
  files.set('LICENSE', fs.readFileSync(path.join(ROOT, 'LICENSE')));
  const entries = [...files].sort(([a], [b]) => a.localeCompare(b, 'en'));
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(ALLOWED)) throw new Error('Release contents failed the explicit allowlist check.');
  for (const [relative, data] of entries) {
    const target = localFile(OUTPUT, relative);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.writeFileSync(target, data);
  }
  const archive = makeZip(entries);
  fs.writeFileSync(ARCHIVE, archive);
  console.log('Built ' + path.basename(ARCHIVE) + ' (' + archive.length.toLocaleString('en-US') + ' bytes, ' + entries.length + ' files)');
  console.log('Release directory: ' + OUTPUT);
  console.log('Archive SHA-256: ' + sha256(archive));
  console.log('Only index.html, the GPL license, eight pinned runtime libraries, and third-party licenses are included.');
}

if (require.main === module) build().catch(error => { console.error('Release build failed: ' + error.message); process.exitCode = 1; });
module.exports = {LIBRARIES, LICENSES, ALLOWED, releaseHTML, makeZip, stripSourceMaps};
