(() => {
  const shield = document.getElementById('screenWakeShield');
  if (!shield) return;

  const settleMs = 1200;
  let safeAfter = 0;
  let lastResponse = performance.now();
  const touches = new Set();

  shield.addEventListener('pointerdown', event => {
    touches.add(event.pointerId);
    shield.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
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
      const { active } = await response.json();
      const now = performance.now();
      lastResponse = now;
      if (active) {
        shield.hidden = false;
        safeAfter = now + settleMs;
      } else if (!touches.size && now >= safeAfter) {
        shield.hidden = true;
      }
    } catch {
      if (!touches.size && performance.now() - lastResponse > 6000) shield.hidden = true;
    } finally {
      setTimeout(poll, 250);
    }
  }
  void poll();
})();
