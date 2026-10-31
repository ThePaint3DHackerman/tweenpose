/* TweenPose's zoomable timeline. This extension stays inline in the distributable HTML. */
(function () {
  'use strict';
  if (window.TweenTimeline) return;
  const track = $('#track'), footer = track.closest('footer'), panel = track.parentElement;
  const frameLabel = $('#fl'), addButton = $('#addk'), deleteButton = $('#delk'), playhead = $('#ph');
  const padding = 24;
  const state = {
    zoom: 1, height: 306, laneHeight: 90, follow: true, smooth: true, timeUnits: 'frames',
    playhead: frame, pixelsPerFrame: 1, viewportWidth: 1, contentWidth: 1,
    staticRenders: 0, playheadUpdates: 0, drag: null
  };
  let signature = '', keyNodes = new Map(), animation = 0, epoch = 0, origin = 0;
  let lastUIFrame = -1, lastUIKey = null, resizePending = false;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const number = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const style = document.createElement('style');
  style.textContent = `
    :root { --fh:306px; }
    footer { min-height:230px; overflow:hidden; gap:10px; }
    footer > div:first-child { min-width:0; min-height:0; }
    footer > div:last-child { min-width:0; min-height:0; display:flex; flex-direction:column; overflow:auto; }
    #gr { flex:1; min-height:100px; max-height:calc(var(--fh) - 68px); width:100%; object-fit:contain; aspect-ratio:250/230; }
    .tl-panel { display:flex; flex-direction:column; gap:7px; height:100%; overflow-y:auto; }
    .tl-top,.tl-controls,.tl-settings { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
    .tl-top { min-height:31px; }
    .tl-top b { min-width:112px; font-size:12px; font-variant-numeric:tabular-nums; }
    .tl-top button,.tl-controls button { font-size:12px; padding:4px 8px; }
    .tl-controls label,.tl-settings label { font-size:11px; white-space:nowrap; }
    .tl-controls input[type=number] { width:66px; padding:3px 5px; font-size:12px; }
    .tl-controls input[type=range] { width:96px; accent-color:var(--ac); }
    .tl-controls output { font-size:11px; min-width:84px; color:var(--mu); font-variant-numeric:tabular-nums; }
    .tl-push { flex:1; }
    #track { margin:0; flex:1; min-height:calc(var(--tl-lane,90px) + 48px); height:auto; overflow-x:auto; overflow-y:hidden; border-radius:7px; cursor:crosshair; touch-action:pan-x; scrollbar-gutter:stable; overscroll-behavior-x:contain; }
    #track:focus-visible { outline:2px solid var(--ac); outline-offset:2px; }
    #tl-surface { position:relative; height:100%; min-height:calc(var(--tl-lane,90px) + 32px); overflow:hidden; }
    #tl-ruler { position:absolute; inset:0 0 auto; height:31px; background:var(--pn); border-bottom:1px solid var(--bd); pointer-events:none; }
    .tl-tick { position:absolute; top:21px; bottom:0; width:1px; background:var(--bd); }
    .tl-tick.major { top:15px; background:var(--mu); }
    .tl-tick span { position:absolute; bottom:13px; left:0; transform:translateX(-50%); color:var(--mu); font-size:10px; font-variant-numeric:tabular-nums; white-space:nowrap; }
    #tl-lane { position:absolute; inset:32px 0 0; background-image:linear-gradient(to right,var(--bd) 1px,transparent 1px); background-position:24px 0; }
    .tl-lane-name { position:sticky; left:8px; top:38px; width:max-content; z-index:1; color:var(--mu); font-size:10px; padding:3px 5px; background:var(--bg); border-radius:3px; pointer-events:none; }
    .tl-key { position:absolute; top:calc(32px + (100% - 32px)/2 - 19px); width:30px; height:40px; padding:0; border:0; border-radius:4px; background:transparent; transform:translateX(-50%); cursor:ew-resize; touch-action:none; z-index:3; }
    .tl-key:hover,.tl-key:focus-visible { background:color-mix(in srgb,var(--ac) 12%,transparent); }
    .tl-key .kf { top:15px; left:50%; width:13px; height:13px; pointer-events:none; }
    .tl-key.on .kf { background:#ff9f1a; width:15px; height:15px; }
    .tl-key-time { position:absolute; top:27px; left:0; right:0; text-align:center; font-size:10px; line-height:12px; color:var(--mu); pointer-events:none; }
    .tl-key.on .tl-key-time { color:var(--tx); font-weight:600; }
    #ph { z-index:4; pointer-events:none; background:#ee5264; width:2px; top:22px; }
    #ph::before { content:''; position:absolute; left:-4px; top:-1px; border-left:5px solid transparent; border-right:5px solid transparent; border-top:8px solid #ee5264; }
    #tl-settings { border-top:1px solid var(--bd); padding-top:5px; }
    #tl-settings summary { cursor:pointer; color:var(--mu); font-size:11px; width:max-content; margin-bottom:3px; }
    .tl-settings input[type=range] { width:90px; accent-color:var(--ac); }
    #tl-status { color:var(--mu); font-size:11px; min-height:15px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    @media(max-width:1100px) { .tl-controls { gap:4px; } .tl-controls input[type=range] { width:74px; } .tl-top button { padding:4px 6px; } }
    @media(max-width:760px) { footer { min-height:0; overflow:visible; height:auto; } .tl-panel { min-height:305px; } #track { flex:none; height:150px; } #gr { flex:none; max-height:230px; } footer > div:last-child { overflow:visible; } }
  `;
  document.head.appendChild(style);
  panel.classList.add('tl-panel');
  const top = document.createElement('div'); top.className = 'tl-top';
  top.append(frameLabel);
  const transport = document.createElement('span'); transport.className = 'tl-top';
  transport.innerHTML = '<button id="tl-prev-key" title="Previous keyframe (Shift + Left)" aria-label="Previous keyframe">|‹</button><button id="tl-prev-frame" title="Previous frame (Left)" aria-label="Previous frame">‹</button><button id="tl-play" title="Play or pause (Space)" aria-label="Play animation">▶</button><button id="tl-next-frame" title="Next frame (Right)" aria-label="Next frame">›</button><button id="tl-next-key" title="Next keyframe (Shift + Right)" aria-label="Next keyframe">›|</button>';
  top.append(transport, addButton, deleteButton);
  const controls = document.createElement('div'); controls.className = 'tl-controls';
  controls.innerHTML = '<label>Frame <input id="tl-frame" type="number" min="0" step="1" aria-label="Current frame"></label><label>Key at <input id="tl-key-time" type="number" min="0" step="1" aria-label="Selected keyframe time"></label><span class="tl-push"></span><button id="tl-zoom-out" title="Zoom out" aria-label="Zoom timeline out">−</button><label>Zoom <input id="tl-zoom" type="range" min="0" max="6" step="0.02" value="0" aria-label="Timeline zoom"></label><button id="tl-zoom-in" title="Zoom in" aria-label="Zoom timeline in">+</button><output id="tl-zoom-label" for="tl-zoom"></output><button id="tl-fit" title="Show the entire animation">Fit</button><button id="tl-focus" title="Zoom around the selected keyframe or current frame">Focus key</button>';
  const uiSettings = document.createElement('details'); uiSettings.id = 'tl-settings';
  uiSettings.innerHTML = '<summary>Timeline settings</summary><div class="tl-settings"><label><input id="tl-follow" type="checkbox" checked> Follow playback</label><label><input id="tl-smooth" type="checkbox" checked> Smooth preview</label><label>Ruler <select id="tl-units" aria-label="Timeline ruler units"><option value="frames">Frames</option><option value="seconds">Seconds</option></select></label><label>Panel height <input id="tl-height" type="range" min="230" max="560" step="10" value="306" aria-label="Timeline panel height"><output id="tl-height-label">306 px</output></label><label>Key lane <input id="tl-lane-height" type="range" min="50" max="180" step="5" value="90" aria-label="Timeline key lane height"></label></div>';
  const status = document.createElement('div'); status.id = 'tl-status'; status.setAttribute('role', 'status');
  status.textContent = 'Scroll to pan · Ctrl/⌘ + wheel to zoom · Drag a diamond to retime a key';
  // Keep the original elements, so project and geometry handlers retain their references.
  panel.replaceChildren(top, controls, track, uiSettings, status);
  track.replaceChildren();
  track.setAttribute('tabindex', '0'); track.setAttribute('role', 'region'); track.setAttribute('aria-label', 'Animation timeline. Arrow keys step frames. Control and mouse wheel zoom.');
  const surface = document.createElement('div'); surface.id = 'tl-surface';
  const ruler = document.createElement('div'); ruler.id = 'tl-ruler';
  const lane = document.createElement('div'); lane.id = 'tl-lane';
  const laneName = document.createElement('div'); laneName.className = 'tl-lane-name'; laneName.textContent = 'Pose keys';
  surface.append(lane, ruler, laneName, playhead); track.append(surface);
  const customEase = document.createElement('option'); customEase.value = '0,0,1,1'; customEase.textContent = 'Custom curve'; customEase.disabled = true; $('#pre').append(customEase);
  const originalEaseChange = $('#pre').onchange;
  $('#pre').onchange = e => { originalEaseChange(e); updateSelection(); };

  function viewportWidth() { return Math.max(120, track.clientWidth || track.getBoundingClientRect().width || 600); }
  function baseSpacing() { return Math.max(0.01, (viewportWidth() - padding * 2) / Math.max(1, last())); }
  function maxZoom() { return Math.max(1, Math.min(64, 120 / baseSpacing())); }
  function xAt(f) { return padding + f * state.pixelsPerFrame; }
  function frameAt(clientX) { return (clientX - track.getBoundingClientRect().left + (track.scrollLeft || 0) - padding) / state.pixelsPerFrame; }
  function chooseSegment(f) {
    if (!keys.length) return null;
    let found = keys[0];
    for (const key of keys) { if (key.t > f) break; found = key; }
    return found;
  }
  function updateSelection(force) {
    keyNodes.forEach((node, key) => { node.classList.toggle('on', key === selKey); node.setAttribute('aria-pressed', key === selKey ? 'true' : 'false'); });
    const timeInput = $('#tl-key-time');
    timeInput.disabled = !selKey; timeInput.max = String(last());
    if (document.activeElement !== timeInput) timeInput.value = selKey ? selKey.t : '';
    deleteButton.disabled = !selKey;
    const canEase = !window.TweenInterpolation?.isHold() && !!selKey && keys.indexOf(selKey) < keys.length - 1;
    $('#pre').disabled = !canEase;
    if (selKey) {
      const match = [...$('#pre').options].find(option => option !== customEase && option.value.split(',').map(Number).every((value, i) => Math.abs(value - selKey.e[i]) < 0.00001));
      // The original Set key handler parses this value, so a custom curve must remain numeric.
      customEase.value = selKey.e.join(','); $('#pre').value = match ? match.value : customEase.value;
    }
    if (force || lastUIKey !== selKey) { drawGraph(); lastUIKey = selKey; }
  }
  function updatePlayhead(follow = false) {
    state.playheadUpdates++;
    playhead.style.left = xAt(clamp(state.playhead, 0, last())) + 'px';
    if (frame !== lastUIFrame) {
      frameLabel.textContent = 'Frame ' + frame + ' / ' + last();
      const input = $('#tl-frame'); input.max = String(last());
      if (document.activeElement !== input) input.value = frame;
      lastUIFrame = frame;
    }
    if (follow && state.follow) {
      const x = xAt(state.playhead), left = track.scrollLeft || 0, width = viewportWidth(), margin = Math.min(70, width / 5);
      if (x > left + width - margin) track.scrollLeft = clamp(x - width + margin, 0, state.contentWidth - width);
      else if (x < left + margin) track.scrollLeft = clamp(x - margin, 0, state.contentWidth - width);
    }
  }
  function updateZoomControls() {
    $('#tl-zoom').max = String(Math.log2(maxZoom()));
    $('#tl-zoom').value = String(Math.log2(state.zoom));
    $('#tl-zoom-label').textContent = state.zoom.toFixed(1) + '× · ' + state.pixelsPerFrame.toFixed(state.pixelsPerFrame < 10 ? 1 : 0) + ' px/f';
    $('#tl-zoom-out').disabled = state.zoom <= 1.001;
    $('#tl-zoom-in').disabled = state.zoom >= maxZoom() - 0.001;
  }
  function render(force = false) {
    if (!playing) state.playhead = frame;
    state.viewportWidth = viewportWidth(); state.zoom = clamp(state.zoom, 1, maxZoom());
    state.pixelsPerFrame = baseSpacing() * state.zoom;
    state.contentWidth = Math.max(state.viewportWidth, padding * 2 + last() * state.pixelsPerFrame);
    surface.style.width = state.contentWidth + 'px'; track.style.setProperty('--tl-lane', state.laneHeight + 'px'); surface.style.setProperty('--tl-lane', state.laneHeight + 'px');
    const nextSignature = [last(), state.viewportWidth, state.zoom, state.laneHeight, state.timeUnits, $('#fps').value, ...keys.map(k => k.t)].join('|');
    const referencesChanged = keyNodes.size !== keys.length || keys.some(key => !keyNodes.has(key));
    if (force || signature !== nextSignature || referencesChanged) {
      signature = nextSignature; state.staticRenders++;
      const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
      const major = steps.find(step => step * state.pixelsPerFrame >= 55) || Math.ceil(55 / state.pixelsPerFrame);
      const minor = state.pixelsPerFrame >= 10 ? 1 : steps.find(step => step * state.pixelsPerFrame >= 10) || major;
      lane.style.backgroundSize = minor * state.pixelsPerFrame + 'px 100%';
      ruler.replaceChildren();
      for (let f = 0; f <= last(); f += minor) {
        const tick = document.createElement('div'), isMajor = f % major === 0;
        tick.className = 'tl-tick' + (isMajor ? ' major' : ''); tick.style.left = xAt(f) + 'px';
        if (isMajor) { const label = document.createElement('span'); label.textContent = rulerLabel(f); tick.append(label); }
        ruler.append(tick);
      }
      if (last() % major !== 0) { const tick = document.createElement('div'); tick.className = 'tl-tick major'; tick.style.left = xAt(last()) + 'px'; const label = document.createElement('span'); label.textContent = rulerLabel(last()); tick.append(label); ruler.append(tick); }
      // Reuse key buttons during scrubbing, playback, and retiming.
      for (const [key, node] of keyNodes) if (!keys.includes(key)) { node.remove(); keyNodes.delete(key); }
      for (const key of keys) {
        let node = keyNodes.get(key);
        if (!node) {
          node = document.createElement('button'); node.type = 'button'; node.className = 'tl-key';
          const diamond = document.createElement('span'); diamond.className = 'kf';
          const label = document.createElement('span'); label.className = 'tl-key-time';
          node.append(diamond, label); node._tweenKey = key;
          node.onclick = e => { e.stopPropagation(); if (!state.drag) selectKey(key); };
          node.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectKey(key); } };
          keyNodes.set(key, node); surface.append(node);
        }
        node.style.left = xAt(key.t) + 'px'; node.title = 'Key at frame ' + key.t + ' — drag to change timing';
        node.setAttribute('aria-label', 'Keyframe at frame ' + key.t); node.lastChild.textContent = key.t;
      }
    }
    lastUIFrame = -1; updateZoomControls(); updateSelection(); updatePlayhead();
  }
  function rulerLabel(value) { return state.timeUnits === 'seconds' ? (value / clamp(number($('#fps').value,12),1,60)).toFixed(2).replace(/\.00$/,'') + 's' : String(value); }
  function setZoom(value, anchorFrame, anchorX) {
    const width = viewportWidth();
    const px = anchorX === undefined ? width / 2 : clamp(number(anchorX, width / 2), 0, width);
    const anchor = anchorFrame === undefined ? ((track.scrollLeft || 0) + px - padding) / state.pixelsPerFrame : number(anchorFrame, frame);
    state.zoom = clamp(number(value, 1), 1, maxZoom()); render();
    track.scrollLeft = clamp(xAt(anchor) - px, 0, Math.max(0, state.contentWidth - width));
    return state.zoom;
  }
  function fit() { state.zoom = 1; render(); track.scrollLeft = 0; }
  function focusKey() {
    const target = selKey ? selKey.t : frame;
    setZoom((viewportWidth() - padding * 2) / (Math.min(last(), 6) * baseSpacing()), target, viewportWidth() / 2);
  }
  function stop() {
    const wasPlaying = playing; playing = false;
    if (animation) cancelAnimationFrame(animation); animation = 0;
    state.playhead = frame; $('#play').textContent = '▶ Play'; $('#tl-play').textContent = '▶'; $('#tl-play').setAttribute('aria-label','Play animation'); gzUpdate();
    if (wasPlaying) { evalAt(frame); syncSl(); if (typeof noteNavigation === 'function') noteNavigation(); }
    updatePlayhead(); updateSelection();
    return frame;
  }
  function seek(value, options = {}) {
    if (exportBusy) return frame;
    window.TweenDirectManipulation?.cancel();
    if (options.pause !== false) stop();
    frame = clamp(Math.round(number(value, frame)), 0, last()); state.playhead = frame;
    evalAt(frame); syncSl();
    selKey = options.key && keys.includes(options.key) ? options.key : chooseSegment(frame);
    updateSelection(); updatePlayhead(options.follow === true);
    if (typeof noteNavigation === 'function') noteNavigation();
    return frame;
  }
  function selectKey(key) {
    if (!keys.includes(key)) return;
    seek(key.t, {key});
    status.textContent = 'Key at frame ' + key.t + ' selected · Drag it or edit “Key at” to change timing';
  }
  function stepKey(direction) {
    const ordered = keys.slice().sort((a, b) => a.t - b.t);
    const key = direction < 0 ? ordered.slice().reverse().find(k => k.t < frame) : ordered.find(k => k.t > frame);
    seek(key ? key.t : direction < 0 ? 0 : last(), {key, follow: true});
  }
  function start(now) {
    if (exportBusy || playing) return false;
    window.TweenDirectManipulation?.cancel();
    window.TweenMotionPanel?.cancelDrawing();
    if (window.GeometryEditor?.isEditing()) GeometryEditor.setMode('object');
    if (frame >= last()) seek(0);
    playing = true; origin = frame; epoch = now === undefined ? performance.now() : now;
    $('#play').textContent = '■ Stop'; $('#tl-play').textContent = 'Ⅱ'; $('#tl-play').setAttribute('aria-label','Pause animation'); gzUpdate();
    animation = requestAnimationFrame(tick); window.TweenViewport?.reschedule(); return true;
  }
  function tick(now) {
    animation = 0; if (!playing) return;
    const fps = clamp(number($('#fps').value, 12), 1, 60);
    const sample = (origin + Math.max(0, now - epoch) * fps / 1000) % total();
    const integer = Math.floor(sample), changed = integer !== frame;
    frame = integer; state.playhead = state.smooth ? Math.min(sample, last()) : integer;
    const hasCloth = parts.some(p => p.cl?.on);
    // Cloth caches are indexed by whole frames. Transform interpolation can be fractional.
    if (hasCloth) { if (changed) evalAt(integer); }
    else if (state.smooth) poseAt(Math.min(sample, last()));
    else if (changed) evalAt(integer);
    if (changed) {
      syncSl(); selKey = chooseSegment(frame); updateSelection();
    }
    if (typeof noteNavigation === 'function') noteNavigation();
    updatePlayhead(true); animation = requestAnimationFrame(tick);
  }
  function retime(key, value, options = {}) {
    if (!key || !keys.includes(key) || exportBusy) return false;
    const target = clamp(Math.round(number(value, key.t)), 0, last());
    if (keys.some(other => other !== key && other.t === target)) {
      status.textContent = 'Frame ' + target + ' already has a key. Choose an empty frame.';
      updateSelection(); return false;
    }
    if (target === key.t) return false;
    if (!options.preview) { stop(); commit(); }
    key.t = target; keys.sort((a, b) => a.t - b.t); selKey = key;
    simDirty(); seek(target, {key, pause: false}); render();
    status.textContent = 'Key moved to frame ' + target + ' · Animation updated';
    if (!options.preview) commit();
    return true;
  }
  function endPointer(event, cancel) {
    const drag = state.drag; if (!drag) return;
    state.drag = null;
    if (drag.kind === 'key' && drag.key.t !== drag.original) {
      if (cancel) { drag.key.t = drag.original; keys.sort((a,b) => a.t-b.t); simDirty(); seek(drag.original, {key:drag.key}); render(); }
      else commit();
    }
    try { track.releasePointerCapture(event.pointerId); } catch (_) {}
  }
  track.onpointerdown = event => {
    if (exportBusy || event.button > 1) return;
    event.preventDefault(); stop();
    const keyNode = event.target.closest?.('.tl-key');
    if (event.button === 1 || event.altKey) state.drag = {kind:'pan', x:event.clientX, scroll:track.scrollLeft || 0};
    else if (keyNode?._tweenKey) {
      const key = keyNode._tweenKey; commit(); selectKey(key);
      state.drag = {kind:'key', key, original:key.t, x:event.clientX, moved:false};
    } else { state.drag = {kind:'scrub'}; seek(frameAt(event.clientX)); }
    track.setPointerCapture(event.pointerId);
  };
  track.onpointermove = event => {
    const drag = state.drag; if (!drag) return;
    if (drag.kind === 'pan') { track.scrollLeft = clamp(drag.scroll + drag.x - event.clientX, 0, Math.max(0,state.contentWidth-viewportWidth())); return; }
    if (drag.kind === 'key') {
      if (!drag.moved && Math.abs(event.clientX-drag.x) < 3) return;
      drag.moved = true;
      const rect = track.getBoundingClientRect();
      if (event.clientX < rect.left + 22) track.scrollLeft = Math.max(0,(track.scrollLeft || 0)-15);
      else if (event.clientX > rect.right - 22) track.scrollLeft = Math.min(Math.max(0,state.contentWidth-viewportWidth()),(track.scrollLeft || 0)+15);
      retime(drag.key, frameAt(event.clientX), {preview:true});
    } else seek(frameAt(event.clientX));
  };
  track.onpointerup = event => endPointer(event, false);
  track.onpointercancel = event => endPointer(event, true);
  track.onlostpointercapture = event => { if (state.drag) endPointer(event, false); };
  track.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const anchorX = event.clientX - track.getBoundingClientRect().left;
      setZoom(state.zoom * Math.exp(-event.deltaY * 0.008), undefined, anchorX);
    } else track.scrollLeft = clamp((track.scrollLeft || 0) + (event.deltaX || event.deltaY), 0, Math.max(0,state.contentWidth-viewportWidth()));
  }, {passive:false});
  $('#play').onclick = () => playing ? stop() : start();
  $('#tl-play').onclick = () => playing ? stop() : start();
  $('#tl-frame').onchange = event => seek(event.target.value, {follow:true});
  $('#tl-key-time').onchange = event => { retime(selKey, event.target.value); updateSelection(); };
  $('#tl-prev-frame').onclick = () => seek(frame - 1, {follow:true});
  $('#tl-next-frame').onclick = () => seek(frame + 1, {follow:true});
  $('#tl-prev-key').onclick = () => stepKey(-1);
  $('#tl-next-key').onclick = () => stepKey(1);
  $('#tl-zoom').oninput = event => setZoom(Math.pow(2, +event.target.value));
  $('#tl-zoom-in').onclick = () => setZoom(state.zoom * 1.5);
  $('#tl-zoom-out').onclick = () => setZoom(state.zoom / 1.5);
  $('#tl-fit').onclick = fit; $('#tl-focus').onclick = focusKey;
  $('#tl-follow').onchange = event => state.follow = event.target.checked;
  $('#tl-smooth').onchange = event => state.smooth = event.target.checked;
  $('#tl-units').onchange = event => { state.timeUnits = event.target.value === 'seconds' ? 'seconds' : 'frames'; render(); };
  function setHeight(value) {
    state.height = clamp(Math.round(number(value, 306)), 230, 560);
    document.documentElement.style.setProperty('--fh', state.height + 'px');
    $('#tl-height').value = state.height; $('#tl-height-label').textContent = state.height + ' px';
    return state.height;
  }
  $('#tl-height').oninput = event => setHeight(event.target.value);
  $('#tl-lane-height').oninput = event => { state.laneHeight = clamp(+event.target.value || 90,50,180); render(); };
  const oldTotalChange = $('#tot').onchange;
  $('#tot').onchange = () => {
    stop(); commit(); $('#tot').value = clamp(Math.round(number($('#tot').value,30)),2,600);
    oldTotalChange(); lastUIFrame = -1; seek(frame); render(true); commit();
  };
  $('#fps').addEventListener('change', () => {
    $('#fps').value = clamp(Math.round(number($('#fps').value,12)),1,60);
    if (playing) { origin = state.playhead; epoch = performance.now(); }
    render();
  });
  // Preserve the existing panel splitter, and keep its height control in sync.
  const splitter = document.querySelector('.sp.h');
  splitter?.addEventListener('pointerup', () => {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fh'));
    setHeight(value); render();
  });
  addEventListener('keydown', event => {
    const tag = event.target?.tagName;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(tag || '') || event.target?.isContentEditable || exportBusy) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); const direction = event.key === 'ArrowLeft' ? -1 : 1;
      event.shiftKey ? stepKey(direction) : seek(frame+direction,{follow:true});
    } else if (event.code === 'Space') { event.preventDefault(); playing ? stop() : start(); }
    else if ((event.key === '+' || event.key === '=') && track.contains(document.activeElement)) { event.preventDefault(); setZoom(state.zoom*1.5); }
    else if (event.key === '-' && track.contains(document.activeElement)) { event.preventDefault(); setZoom(state.zoom/1.5); }
  });
  drawTrack = function () { state.playhead = frame; render(); };
  setFrame = function (value) { return seek(value); };
  drawAll = function () { render(); drawGraph(); commitSoon(); };
  function resize() {
    if (resizePending) return; resizePending = true;
    requestAnimationFrame(() => { resizePending = false; render(); });
  }
  new ResizeObserver(resize).observe(track);
  function settings() {
    return {zoom:state.zoom, pan:track.scrollLeft || 0, follow:state.follow, smooth:state.smooth, height:state.height, laneHeight:state.laneHeight, timeUnits:state.timeUnits};
  }
  function restoreSettings(data) {
    if (!data || typeof data !== 'object') return;
    state.follow = data.follow !== false; state.smooth = data.smooth !== false;
    state.laneHeight = clamp(number(data.laneHeight,90),50,180);
    state.timeUnits = data.timeUnits === 'seconds' ? 'seconds' : 'frames'; $('#tl-units').value = state.timeUnits;
    $('#tl-follow').checked = state.follow; $('#tl-smooth').checked = state.smooth; $('#tl-lane-height').value = state.laneHeight;
    setHeight(number(data.height,306)); state.zoom = clamp(number(data.zoom,1),1,maxZoom()); render();
    track.scrollLeft = clamp(number(data.pan,0),0,Math.max(0,state.contentWidth-viewportWidth()));
  }
  window.TweenTimeline = {
    state, render, setZoom, fit, focusKey, seek, start, stop, tick, retime,
    selectKey, stepKey, setHeight, frameAt, xAt, settings, restoreSettings,
    get selectedKey() { return selKey; },
    get playing() { return playing; }
  };
  setHeight(306); render(true);
})();
