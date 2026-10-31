/* Bounded, deduplicated TweenPose backups. This source is embedded by the build. */
function createTweenPoseBackupStore(options = {}) {
  const scope = options.scope || 'TweenPose Studio';
  const clock = options.now || (() => Date.now());
  const maxEntries = options.maxEntries || 30, maxAutos = options.maxAutos ?? 8;
  let budget = options.budgetBytes || 64 * 1024 * 1024;
  const encode = options.encode || (async text => {
    const plain = new Blob([text], {type:'application/json'});
    if (typeof CompressionStream === 'function' && plain.size > 2048) {
      try {
        const data = await new Response(plain.stream().pipeThrough(new CompressionStream('gzip'))).blob();
        if (data.size < plain.size) return {data, encoding:'gzip', bytes:data.size};
      } catch (_) { /* Plain JSON also works in older browsers. */ }
    }
    return {data:plain, encoding:'json', bytes:plain.size};
  });
  const decode = options.decode || (async record => {
    if (record.encoding === 'gzip') {
      return new Response(record.data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }
    return typeof record.data === 'string' ? record.data : record.data.text();
  });
  const hash = text => {
    // Two independent 32-bit hashes plus length; reused assets are also compared.
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b, 33) ^ c; }
    return text.length.toString(36) + '-' + (a >>> 0).toString(36) + (b >>> 0).toString(36);
  };
  const signature = project => hash(JSON.stringify({...project, pose:undefined, frame:undefined, s:undefined, timeline:undefined}));
  const quotaError = error => /quota|disk|storage.*full/i.test((error?.name || '') + ' ' + (error?.message || ''));
  let adapter, persistent = false, paused = false, serial = 0;
  let snapshots = new Map(), assets = new Map(), assetValues = new Map(), cached = [];
  let storedSnapshots = new Map(), storedAssets = new Map();
  let queue = Promise.resolve();
  let status = {mode:'loading', message:'Loading project backups…', bytes:0, count:0};
  function report(mode, message) {
    status = {mode, message, bytes:[...snapshots.values(), ...assets.values()].reduce((n,r) => n + r.bytes, 0), count:snapshots.size, budget};
    options.onStatus?.(status);
  }
  function requestValue(request) {
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  async function browserAdapter() {
    const idb = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
    if (!idb) throw new Error('IndexedDB is unavailable.');
    const request = idb.open('TweenPoseProjectBackups', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', {keyPath:'id'});
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', {keyPath:'id'});
    };
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Backup database is in use by another tab.'));
    });
    db.onversionchange = () => { db.close(); paused = true; report('paused', 'Browser backups paused. Download the project or save to your chosen file.'); };
    return {
      async read() {
        const tx = db.transaction(['snapshots','assets'], 'readonly');
        const [s,a] = await Promise.all([requestValue(tx.objectStore('snapshots').getAll()), requestValue(tx.objectStore('assets').getAll())]);
        return {snapshots:s.filter(r => r.scope === scope), assets:a.filter(r => r.scope === scope)};
      },
      apply(delta) {
        return new Promise((resolve, reject) => {
          let tx;
          try {
            tx = db.transaction(['snapshots','assets'], 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error || new Error('Backup transaction was interrupted.'));
            tx.onerror = () => {}; // onabort supplies one final error, with no repeated alerts.
            const ss = tx.objectStore('snapshots'), aa = tx.objectStore('assets');
            delta.deleteSnapshots.forEach(id => ss.delete(id)); delta.deleteAssets.forEach(id => aa.delete(id));
            delta.putAssets.forEach(record => aa.put(record)); delta.putSnapshots.forEach(record => ss.put(record));
          } catch (error) { if (tx) try { tx.abort(); } catch (_) {} reject(error); }
        });
      }
    };
  }
  function hydrate(project) {
    if (!Array.isArray(project.g)) return project;
    project.g = project.g.map(record => {
      const result = {...record};
      for (const field of ['base','material']) if (result[field]?.$tweenposeAsset) {
        const value = assetValues.get(result[field].$tweenposeAsset);
        if (value === undefined) throw new Error('A project backup asset is missing.');
        result[field] = value;
      }
      if (Array.isArray(result.face?.expressions)) {
        result.face = {...result.face, expressions:result.face.expressions.map(expression => {
          if (!expression.src?.$tweenposeAsset) return expression;
          const value = assetValues.get(expression.src.$tweenposeAsset);
          if (value === undefined) throw new Error('A face expression image is missing from this backup.');
          return {...expression, src:value};
        })};
      }
      return result;
    });
    return project;
  }
  async function rebuildCache() {
    cached = [];
    for (const record of [...snapshots.values()].sort((a,b) => a.t - b.t || a.id.localeCompare(b.id))) {
      try { cached.push({id:record.id, t:record.t, l:record.l, d:hydrate(JSON.parse(await decode(record))), persistent:!!record.durable}); }
      catch (_) { /* A damaged record does not prevent other backups from opening. */ }
    }
  }
  function collect(nextSnapshots, nextAssets) {
    const used = new Set([...nextSnapshots.values()].flatMap(r => r.refs));
    for (const id of nextAssets.keys()) if (!used.has(id)) nextAssets.delete(id);
  }
  function trim(nextSnapshots, nextAssets, extraAutos = false, protectId = null) {
    const ordered = () => [...nextSnapshots.values()].sort((a,b) => a.t - b.t || a.id.localeCompare(b.id));
    if (extraAutos) for (const r of ordered()) if (r.l === 'Auto' && r.id !== protectId) nextSnapshots.delete(r.id);
    while (nextSnapshots.size > maxEntries || [...nextSnapshots.values()].filter(r => r.l === 'Auto').length > maxAutos) {
      const candidates = ordered().filter(r => r.id !== protectId);
      const victim = candidates.find(r => r.l === 'Auto') || candidates[0];
      if (!victim) break;
      nextSnapshots.delete(victim.id);
    }
    collect(nextSnapshots, nextAssets);
    const bytes = () => [...nextSnapshots.values(), ...nextAssets.values()].reduce((n,r) => n + r.bytes, 0);
    while (bytes() > budget && nextSnapshots.size > 1) {
      const candidates = ordered().filter(r => r.id !== protectId);
      const victim = candidates.find(r => r.l === 'Auto') || candidates[0];
      if (!victim) break;
      nextSnapshots.delete(victim.id); collect(nextSnapshots, nextAssets);
    }
    return bytes();
  }
  function delta(nextSnapshots, nextAssets) {
    return {
      putSnapshots:[...nextSnapshots.values()].filter(r => storedSnapshots.get(r.id) !== r),
      putAssets:[...nextAssets.values()].filter(r => storedAssets.get(r.id) !== r),
      deleteSnapshots:[...storedSnapshots.keys()].filter(id => !nextSnapshots.has(id)),
      deleteAssets:[...storedAssets.keys()].filter(id => !nextAssets.has(id))
    };
  }
  async function assetRecord(value, nextAssets, nextValues) {
    const json = JSON.stringify(value), prefix = scope + ':asset:' + hash(json);
    let id = prefix, suffix = 0;
    while (nextValues.has(id) && JSON.stringify(nextValues.get(id)) !== json) id = prefix + ':' + (++suffix);
    if (!nextAssets.has(id) || !nextValues.has(id)) { nextAssets.set(id, {id, scope, ...await encode(json)}); nextValues.set(id, JSON.parse(json)); }
    return id;
  }
  async function saveInternal(label, project, settings = {}) {
    const sig = settings.signature || signature(project);
    const newest = [...snapshots.values()].at(-1);
    if (label === 'Auto' && newest?.signature === sig && !settings.poseChanged && !settings.force) return {saved:false, persistent:persistent && !paused};
    const nextSnapshots = new Map(snapshots), nextAssets = new Map(assets), nextValues = new Map(assetValues);
    const refs = [], manifest = {...project};
    if (Array.isArray(project.g)) {
      manifest.g = [];
      for (const record of project.g) {
        const entry = {...record};
        for (const field of ['base','material']) if (entry[field] !== undefined) {
          const id = await assetRecord(entry[field], nextAssets, nextValues); refs.push(id); entry[field] = {$tweenposeAsset:id};
        }
        if (Array.isArray(entry.face?.expressions)) {
          const expressions = [];
          for (const expression of entry.face.expressions) {
            const item = {...expression};
            if (typeof item.src === 'string') {
              const id = await assetRecord(item.src, nextAssets, nextValues); refs.push(id); item.src = {$tweenposeAsset:id};
            }
            expressions.push(item);
          }
          entry.face = {...entry.face, expressions};
        }
        manifest.g.push(entry);
      }
    }
    const t = settings.t || clock(), id = settings.id || scope + ':snapshot:' + t + ':' + (++serial);
    const record = {id, scope, t, l:label, signature:sig, refs:[...new Set(refs)], ...await encode(JSON.stringify(manifest)), durable:persistent && !paused};
    nextSnapshots.set(id, record);
    const size = trim(nextSnapshots, nextAssets, false, id);
    let savedToDisk = persistent && !paused && size <= budget;
    if (savedToDisk) {
      try { await adapter.apply(delta(nextSnapshots, nextAssets)); }
      catch (error) {
        if (quotaError(error)) {
          trim(nextSnapshots, nextAssets, true, id);
          try { await adapter.apply(delta(nextSnapshots, nextAssets)); }
          catch (_) { savedToDisk = false; paused = true; }
        } else { savedToDisk = false; paused = true; }
      }
    } else if (persistent && !paused) paused = true;
    if (!savedToDisk) record.durable = false;
    else { storedSnapshots = new Map(nextSnapshots); storedAssets = new Map(nextAssets); }
    snapshots = nextSnapshots; assets = nextAssets;
    assetValues = new Map([...nextValues].filter(([key]) => assets.has(key)));
    await rebuildCache();
    if (paused) report('paused', 'Browser backups paused; this backup is in this session. Download the project or save to a project file.');
    else if (!persistent) report('session', 'Session backups only. Download your project or choose a project file to keep it.');
    else report('saved', 'Backups saved in this browser.');
    return {saved:true, persistent:savedToDisk, id};
  }
  async function initialize() {
    let legacy = [];
    try {
      const text = options.localStorage?.getItem(options.legacyKey);
      const value = text && JSON.parse(text);
      if (Array.isArray(value)) legacy = value.filter(x => x?.d && Array.isArray(x.d.r) && Array.isArray(x.d.k));
    } catch (_) { /* Browser storage may be blocked; project files still work. */ }
    try {
      if (!options.budgetBytes && options.estimate) {
        try { const estimate = await options.estimate(); if (estimate.quota > 0) budget = Math.min(budget, Math.max(4 * 1024 * 1024, Math.floor(estimate.quota * .1))); } catch (_) {}
      }
      adapter = options.adapter || await browserAdapter();
      const existing = await adapter.read();
      snapshots = new Map(existing.snapshots.map(r => [r.id, {...r,durable:true}]));
      assets = new Map(existing.assets.map(r => [r.id,r]));
      storedSnapshots = new Map(snapshots); storedAssets = new Map(assets);
      for (const record of assets.values()) { try { assetValues.set(record.id, JSON.parse(await decode(record))); } catch (_) {} }
      persistent = true;
      await rebuildCache();
      if (legacy.length) {
        for (const item of legacy) {
          const id = scope + ':legacy:' + item.t;
          if (!snapshots.has(id)) await saveInternal(item.l || 'Manual', item.d, {id,t:item.t,force:true});
        }
        // Only remove the old localStorage payload after IndexedDB commits succeed.
        if (!paused) try { options.localStorage?.removeItem(options.legacyKey); } catch (_) {}
      }
      if (!paused) report('saved', 'Backups saved in this browser.');
    } catch (_) {
      persistent = false;
      for (const item of legacy) await saveInternal(item.l || 'Manual', item.d, {t:item.t,force:true});
      report('session', 'Session backups only. Download your project or choose a project file to keep it.');
    }
  }
  const ready = initialize();
  function enqueue(action) { const result = queue.then(() => ready).then(action); queue = result.catch(() => {}); return result; }
  return {
    ready, signature, hash,
    list:() => cached.slice(),
    status:() => ({...status}),
    save:(label,project,settings) => enqueue(() => saveInternal(label, project, settings)),
    keep:ids => enqueue(async () => {
      const keep = new Set(ids), nextSnapshots = new Map([...snapshots].filter(([id]) => keep.has(id))), nextAssets = new Map(assets);
      collect(nextSnapshots, nextAssets);
      // An explicit deletion can free space and resume a paused database.
      if (persistent) {
        try {
          await adapter.apply(delta(nextSnapshots, nextAssets));
          for (const record of nextSnapshots.values()) record.durable = true;
          storedSnapshots = new Map(nextSnapshots); storedAssets = new Map(nextAssets); paused = false;
        }
        catch (_) { paused = true; }
      }
      snapshots = nextSnapshots; assets = nextAssets;
      assetValues = new Map([...assetValues].filter(([id]) => assets.has(id)));
      await rebuildCache();
      report(paused?'paused':persistent?'saved':'session', paused?'Browser backups paused. Download the project or save to a project file.':persistent?'Backups saved in this browser.':'Session backups only. Download your project to keep it.');
      return true;
    }),
    restore:id => {
      const entry = cached.find(x => x.id === id);
      return entry ? JSON.parse(JSON.stringify(entry.d)) : null;
    }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = {createTweenPoseBackupStore};

// Integration stays at the original backup block so the application keeps its APIs.
if (typeof document !== 'undefined' && typeof projGet === 'function') {
  var SK = 'pts_snaps_' + document.title;
  var lastSaved = '';
  var TweenPoseBackupUI = (() => {
    let store, timer, baselineTimer, dirty = false, poseBaseline = '', fileHandle = null, filePaused = false, fileBusy = false, saveBusy = false;
    let fileMessage = '', baseStatus = {mode:'loading',message:'Loading project backups…'};
    const statusNode = document.createElement('small'); statusNode.id = 'backup-status';
    statusNode.setAttribute('role','status'); statusNode.style.cssText = 'display:block;line-height:1.5;color:var(--mu)';
    const box = $('#bkn'); box.parentNode.insertBefore(statusNode, box);
    const badge = document.createElement('small'); badge.id = 'backup-badge';
    badge.style.cssText = 'font-size:10px;color:var(--mu);align-self:center;max-width:130px;line-height:1.2';
    $('#bkb').parentNode.insertBefore(badge, $('#bkb'));
    const description = $('#bk').querySelector('small');
    if (description && description !== statusNode) description.textContent = 'Changed projects are backed up automatically. Mesh and texture data are shared between backups; old backups are trimmed to a bounded storage budget. Download a project file for portable storage.';
    const fileRow = document.createElement('div'); fileRow.className = 'row'; fileRow.style.flexWrap = 'wrap';
    const choose = document.createElement('button'); choose.id = 'backup-choose-file'; choose.textContent = 'Choose project file…';
    const saveFile = document.createElement('button'); saveFile.id = 'backup-save-file'; saveFile.textContent = 'Save to project file'; saveFile.disabled = true;
    const fileNote = document.createElement('small'); fileNote.style.cssText = 'display:block;color:var(--mu);line-height:1.5';
    fileNote.textContent = typeof window.showSaveFilePicker === 'function' ? 'Choose a file to also autosave directly to disk while this tab is open.' : 'Use Download project file to save directly to your computer.';
    choose.hidden = typeof window.showSaveFilePicker !== 'function'; saveFile.hidden = choose.hidden;
    fileRow.append(choose, saveFile); box.parentNode.insertBefore(fileRow, statusNode); box.parentNode.insertBefore(fileNote, statusNode);
    function renderStatus() {
      if (!store) return;
      const state = store.status(), bytes = state.bytes || 0;
      statusNode.textContent = baseStatus.message + (bytes ? ' ' + (bytes/1048576).toFixed(1) + ' MB of ' + ((state.budget||67108864)/1048576).toFixed(0) + ' MB backup budget.' : '') + (fileMessage ? ' ' + fileMessage : '');
      badge.textContent = fileHandle && !filePaused ? 'File autosave on' : state.mode === 'saved' ? 'Backups saved' : state.mode === 'loading' ? 'Loading backups' : 'Session only';
      badge.title = statusNode.textContent;
    }
    let legacyStorage;
    if(window.TweenPoseRelease?.legacyBackups!==false)try { legacyStorage = window.localStorage; } catch (_) {}
    store = createTweenPoseBackupStore({
      scope:window.TweenPoseRelease?.backupScope||document.title, legacyKey:SK, localStorage:legacyStorage,
      estimate:window.navigator?.storage?.estimate ? () => navigator.storage.estimate() : undefined,
      onStatus:state => { baseStatus = state; renderStatus(); }
    });
    function poseHash(pose) { return store.hash(JSON.stringify(pose)); }
    function navigation(pose) { poseBaseline = poseHash(pose === undefined ? snap() : pose); }
    function baseline() {
      clearTimeout(timer); clearTimeout(baselineTimer); dirty = false;
      baselineTimer = setTimeout(() => {
        try { const project = projGet(); lastSaved = store.signature(project); poseBaseline = poseHash(project.pose); } catch (_) {}
      }, 0);
    }
    async function writeFile(project, manual = false) {
      if (!fileHandle || fileBusy || (filePaused && !manual)) return false;
      fileBusy = true;
      try {
        const writable = await fileHandle.createWritable();
        try { await writable.write(JSON.stringify(project)); await writable.close(); }
        catch (error) { try { await writable.abort(); } catch (_) {} throw error; }
        filePaused = false; fileMessage = 'Project file saved at ' + new Date().toLocaleTimeString() + '.'; renderStatus(); return true;
      } catch (_) {
        filePaused = true; fileMessage = 'Project file write paused. Click Save to project file to retry.'; renderStatus(); return false;
      } finally { fileBusy = false; }
    }
    async function save(label = 'Manual', existingProject) {
      if (!parts.length) return false;
      await store.ready;
      if (saveBusy && label === 'Auto') { dirty = true; schedule(); return false; }
      saveBusy = true;
      try {
        const project = existingProject || projGet(), signature = store.signature(project), pose = poseHash(project.pose);
        const poseChanged = pose !== poseBaseline;
        if (label === 'Auto' && signature === lastSaved && !poseChanged) return false;
        const result = await store.save(label, project, {signature,poseChanged});
        if (result.saved) {
          lastSaved = signature; poseBaseline = pose;
          await writeFile(project); render();
        }
        return result.saved;
      } catch (_) {
        baseStatus = {mode:'session',message:'Automatic backups are unavailable for this project. Download the project file to keep your work.'}; renderStatus(); return false;
      } finally { saveBusy = false; }
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(flush, 1800); }
    function markDirty() { dirty = true; schedule(); }
    async function flush() {
      if (!dirty || !parts.length) return;
      dirty = false;
      await save('Auto');
    }
    function render() {
      renderStatus();
      const entries = store.list().reverse(); box.innerHTML = '';
      if (!entries.length) box.textContent = 'No backups yet. Your first edit or Save backup now creates one.';
      entries.forEach(entry => {
        const row = document.createElement('div'); row.className = 'row';
        const info = document.createElement('span'); info.style.flex = '1';
        info.textContent = new Date(entry.t).toLocaleString() + ' · ' + entry.l + ' · ' + entry.d.k.length + ' keys · ' + entry.d.tot + ' frames' + (entry.persistent?'':' · session');
        const restore = document.createElement('button'); restore.textContent = 'Restore';
        restore.onclick = async () => { restore.disabled = true; const project = store.restore(entry.id); try { await save('Before restore'); projSet(project); render(); } finally { restore.disabled = false; } };
        const remove = document.createElement('button'); remove.textContent = 'Delete';
        remove.onclick = async () => { remove.disabled = true; await store.keep(store.list().filter(x => x.id !== entry.id).map(x => x.id)); render(); };
        row.append(info, restore, remove); box.append(row);
      });
    }
    choose.onclick = async () => {
      try {
        const handle = await window.showSaveFilePicker({suggestedName:'tweenpose-project.json', types:[{description:'TweenPose project',accept:{'application/json':['.json']}}]});
        fileHandle = handle; saveFile.disabled = false; filePaused = false;
        await writeFile(projGet(), true);
      } catch (error) { if (error?.name !== 'AbortError') { fileMessage = 'Could not choose a project file. Use Download project file.'; renderStatus(); } }
    };
    saveFile.onclick = async () => { saveFile.disabled = true; try { await writeFile(projGet(), true); } finally { saveFile.disabled = !fileHandle; } };
    $('#bkb').onclick = () => { render(); $('#bk').style.display = 'flex'; };
    $('#bkx').onclick = () => $('#bk').style.display = 'none';
    $('#bks').onclick = async () => { const button = $('#bks'); button.disabled = true; try { if (await save('Manual')) toast(store.status().mode === 'saved'?'Backup saved':'Backup kept for this session. Save a project file to keep it.', true); render(); } finally { button.disabled = false; } };
    $('#bkd').onclick = () => saveBlob(new Blob([JSON.stringify(projGet())], {type:'application/json'}), 'tweenpose-project.json');
    $('#bkl').onclick = () => $('#bkf').click();
    $('#bkf').onchange = async event => {
      const file = event.target.files[0]; event.target.value = ''; if (!file) return;
      try { const project = JSON.parse(await file.text()); if (!project || !Array.isArray(project.r) || !Array.isArray(project.k)) throw new Error('Invalid project'); await save('Before load'); projSet(project); render(); }
      catch (_) { toast('That file is not a valid project file.'); }
    };
    // These settings can change independently of an animation-history commit.
    ['pn','cl','wn','pin','fps'].forEach(id => $('#'+id)?.addEventListener('change',markDirty));
    addEventListener('pagehide', () => { if (dirty) flush(); });
    baseline();
    store.ready.then(() => render());
    return {store,save,render,baseline,markDirty,navigation,flush};
  })();
  var sget = () => TweenPoseBackupUI.store.list();
  var sput = async entries => { await TweenPoseBackupUI.store.keep(entries.map(x => x.id)); TweenPoseBackupUI.render(); return true; };
  var snapNow = (label) => TweenPoseBackupUI.save(label);
  var bkRender = () => TweenPoseBackupUI.render();
  window.TweenPoseBackups = TweenPoseBackupUI;
}
