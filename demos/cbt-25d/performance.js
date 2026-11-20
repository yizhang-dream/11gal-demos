export function setupPerformance(actor, opts = {}) {
  const exprSel = document.querySelector('#expression');
  const moodSel = document.querySelector('#mood');
  const eyeTrackChk = document.querySelector('#eye-track');
  const motionBtns = Array.from(document.querySelectorAll('[data-motion]'));

  function setPressed(name) {
    for (const b of motionBtns) {
      b.setAttribute('aria-pressed', String(b.dataset.motion === name));
    }
  }

  function setExpression(name) {
    if (exprSel) exprSel.value = name;
    actor.setExpression(name);
  }

  function playMotion(name) {
    if (name === 'Poke') {
      opts.onPoke?.();
      return;
    }
    const active = actor.playMotion(name);
    setPressed(active);
  }

  if (exprSel) {
    exprSel.onchange = (e) => actor.setExpression(e.target.value);
  }
  if (moodSel) {
    moodSel.onchange = (e) => opts.onMood?.(e.target.value);
  }
  if (eyeTrackChk) {
    eyeTrackChk.onchange = (e) => actor.setEyeTrack(e.target.checked);
    actor.setEyeTrack(eyeTrackChk.checked);
  }
  for (const b of motionBtns) {
    b.onclick = () => playMotion(b.dataset.motion);
  }

  setPressed('Idle');

  let lastMotionName = 'Idle';
  function sync() {
    const cur = actor.rig?.motion?.name || 'Idle';
    if (cur !== lastMotionName) {
      lastMotionName = cur;
      setPressed(cur);
    }
  }

  return {
    setExpression,
    playMotion,
    sync,
  };
}
