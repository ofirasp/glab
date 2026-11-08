(() => {
  const shield = document.getElementById('screenWakeShield');
  if (!shield) return;

  const settleMs = 250;
  const clock = document.getElementById('saverClock');
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  let previewing = false;
  let waking = false;
  let safeAfter = 0;
  let lastResponse = performance.now();
  const touches = new Set();

  function show(style) {
    const selected = ['black', 'clock', 'guitar'].includes(style) ? style : 'black';
    shield.dataset.style = selected;
    clock.hidden = selected !== 'clock';
    if (!clock.hidden) {
      const display = timeFormat.format(new Date());
      if (clock.textContent !== display) clock.textContent = display;
    }
    shield.hidden = false;
  }

  window.addEventListener('message', event => {
    if (event.origin !== location.origin ||
        event.source !== document.getElementById('practiceFrame')?.contentWindow ||
        event.data?.type !== 'preview-screen-saver') return;
    previewing = true;
    show(event.data.style);
  });

  async function wake() {
    if (waking) return;
    waking = true;
    try {
      await fetch('/api/desktop/screen-wake', {
        method: 'POST',
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      // The next tap can retry if the desktop helper is temporarily unavailable.
    } finally {
      waking = false;
    }
  }

  shield.addEventListener('pointerdown', event => {
    touches.add(event.pointerId);
    shield.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    if (previewing) previewing = false;
    else void wake();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    shield.addEventListener(type, event => {
      touches.delete(event.pointerId);
      safeAfter = Math.max(safeAfter, performance.now() + 250);
      event.stopPropagation();
    });
  }
  shield.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
  });

  async function poll() {
    try {
      const response = await fetch('/api/desktop/screen-state', {
        cache: 'no-store',
        signal: AbortSignal.timeout(1500)
      });
      if (!response.ok) throw new Error('Screen state unavailable');
      const { active, style } = await response.json();
      const now = performance.now();
      lastResponse = now;
      if (previewing) return;
      if (active) {
        show(style);
        safeAfter = now + settleMs;
      } else if (!touches.size && now >= safeAfter) {
        shield.hidden = true;
      }
    } catch {
      if (!previewing && !touches.size && performance.now() - lastResponse > 6000) shield.hidden = true;
    } finally {
      setTimeout(poll, 250);
    }
  }
  void poll();
})();
