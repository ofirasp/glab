(() => {
  let generatedPlayback = false;
  let leaving = false;
  let pending = false;
  let lock = null;

  function shouldKeepAwake() {
    return !leaving && !document.hidden &&
      (generatedPlayback || [...document.querySelectorAll('audio,video')]
        .some(media => !media.paused && !media.ended && !media.error));
  }

  async function sync() {
    if (!shouldKeepAwake()) {
      if (lock) {
        const previous = lock;
        lock = null;
        await previous.release();
      }
      return;
    }
    if (!navigator.wakeLock || lock || pending) return;
    pending = true;
    try {
      const requested = await navigator.wakeLock.request('screen');
      if (!shouldKeepAwake()) {
        await requested.release();
        return;
      }
      lock = requested;
      requested.addEventListener('release', () => {
        if (lock === requested) lock = null;
      });
    } catch {
      // The desktop can still check browser playback if a lock is unavailable.
    } finally {
      pending = false;
    }
  }

  for (const event of ['play', 'pause', 'ended', 'emptied', 'error']) {
    document.addEventListener(event, sync, true);
  }
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { leaving = true; void sync(); });
  window.addEventListener('pageshow', () => { leaving = false; void sync(); });
  window.GuitarScreenAwake = {
    setGeneratedPlayback(active) {
      if (generatedPlayback === active) return;
      generatedPlayback = active;
      void sync();
    }
  };
})();
