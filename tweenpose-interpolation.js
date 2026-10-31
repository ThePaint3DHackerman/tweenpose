/* Pose interpolation is a project setting. Paths keep their own explicit timing. */
const TweenInterpolation = (() => {
  'use strict';
  let mode = 'tween';
  function validate(data) {
    if (data == null) return {mode:'tween'};
    if (typeof data !== 'object' || Array.isArray(data) || !['tween','hold'].includes(data.mode)) throw new Error('Choose Tween or Hold for pose interpolation.');
    return {mode:data.mode};
  }
  const settings = () => ({mode});
  const isHold = data => (data === undefined ? mode : data?.mode) === 'hold';
  function sync() {
    $('#pose-interpolation').value = mode;
    $('#pose-interpolation-hint').textContent = isHold()
      ? 'Hold each body and face pose until its next key. Motion paths keep their own timing.'
      : 'Ease between body and face keys. Motion paths keep their own timing.';
    const preset = $('#pre');
    if (preset) { preset.disabled = isHold() || !selKey || keys.indexOf(selKey) >= keys.length-1; preset.title = isHold() ? 'Pose easing is paused in Hold mode.' : 'Easing to the next pose key'; }
    window.TweenMotionBlur?.sync?.();
  }
  function restoreSettings(data) {
    mode = validate(data).mode;
    sync();
    return settings();
  }
  function setMode(value, options = {}) {
    if (exportBusy) return false;
    let next;
    try { next = validate({mode:value}).mode; }
    catch (error) { toast(error.message); sync(); return false; }
    if (next === mode) { sync(); return true; }
    window.TweenDirectManipulation?.cancel();
    if (window.TweenTimeline?.stop) window.TweenTimeline.stop();
    else if (playing) $('#play')?.click();
    if (options.record !== false) commit();
    mode = next;
    simDirty(); evalAt(frame); syncSl();
    window.TweenTimeline?.render();
    drawGraph(); window.TweenFacePanel?.sync(); sync();
    if (options.record !== false) commit();
    return true;
  }
  const controls = document.createElement('div');
  controls.id = 'pose-interpolation-controls';
  controls.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-bottom:8px';
  controls.innerHTML = '<label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">Pose interpolation <select id="pose-interpolation" aria-label="Pose interpolation" aria-describedby="pose-interpolation-hint"><option value="tween">Tween</option><option value="hold">Hold (no tween)</option></select></label><small id="pose-interpolation-hint"></small>';
  const easingRow = $('#pre').parentElement;
  easingRow.parentElement.insertBefore(controls,easingRow);
  $('#pose-interpolation').onchange = event => setMode(event.target.value);
  sync();
  return {settings,validate,restoreSettings,setMode,isHold,sync};
})();
window.TweenInterpolation = TweenInterpolation;
