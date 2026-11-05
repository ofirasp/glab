/* App-local touch keyboard: works above kiosk windows and modal dialogs. */
(() => {
  'use strict';
  if (document.getElementById('gplTouchKeyboard')) return;
  const style = document.createElement('style');
  style.textContent = `
    #gplTouchKeyboard{position:fixed;inset:auto 0 0;margin:0 auto;width:100vw;
      max-width:100vw;height:auto;max-height:100dvh;overflow:auto;padding:8px;
      border:1px solid #6884a6;border-radius:12px 12px 0 0;background:#142338;
      color:#f1f6ff;font:16px system-ui;box-sizing:border-box;color-scheme:dark}
    #gplTouchKeyboard[open]{display:flex;flex-direction:column;gap:5px}
    #gplTouchKeyboard::backdrop{background:#050c1766}
    #gplTouchKeyboard *{box-sizing:border-box}
    #gplTouchKeyboard .gpl-k-head{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#b9cce4;min-height:21px}
    #gplTouchKeyboard .gpl-k-preview{background:#0a1525;border:1px solid #5a7597;
      border-radius:7px;padding:6px 9px;min-height:37px;max-height:60px;overflow:auto;
      white-space:pre-wrap;overflow-wrap:anywhere;font-size:18px;line-height:1.3;text-align:start}
    #gplTouchKeyboard .gpl-k-caret{background:#8cc8ff;color:#102039;padding:0 1px}
    #gplTouchKeyboard .gpl-k-row{display:grid;grid-auto-columns:minmax(0,1fr);grid-auto-flow:column;gap:4px}
    #gplTouchKeyboard button{display:flex;align-items:center;justify-content:center;
      min-width:0;min-height:38px;height:38px;padding:3px;border:1px solid #536d8f;
      border-radius:7px;background:#29415e;color:#f3f7ff;font:600 19px system-ui;
      white-space:nowrap;touch-action:manipulation;cursor:pointer}
    #gplTouchKeyboard button:active{background:#5078a9}
    #gplTouchKeyboard .gpl-k-tools button{font-size:14px;min-height:40px}
    #gplTouchKeyboard button.gpl-k-done{background:#2868bc}
    #gplTouchKeyboard button:focus-visible{outline:3px solid #9dd6ff}
    @media(max-height:360px){#gplTouchKeyboard button{height:30px;min-height:30px}#gplTouchKeyboard .gpl-k-preview{max-height:37px}}
  `;
  document.head.append(style);
  const keyboard = document.createElement('dialog');
  keyboard.id = 'gplTouchKeyboard';
  keyboard.setAttribute('aria-label', 'Touch keyboard');
  keyboard.innerHTML = '<div class="gpl-k-head"><strong>Touch keyboard</strong><span class="gpl-k-field"></span></div>' +
    '<div class="gpl-k-preview" role="status" dir="auto"></div>' +
    '<div class="gpl-k-row gpl-k-row1"></div><div class="gpl-k-row gpl-k-row2"></div>' +
    '<div class="gpl-k-row gpl-k-row3"></div><div class="gpl-k-row gpl-k-tools"></div>';
  document.body.append(keyboard);
  let target = null, start = 0, end = 0, language = 'en', shifted = false, numeric = false;
  let opening = null, closing = false;
  const letters = {
    en: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
    he: ['קראטוןםפ', 'שדגכעיחלךף', 'זסבהנמצתץ']
  };
  const symbols = ['1234567890', '-/:.?=&_@#', '!()[],\'"+%'];
  const eligible = element => element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement && ['text', 'search', 'url', 'email', 'tel', 'password'].includes(element.type);
  function preview() {
    if (!target) return;
    const value = target.type === 'password' ? '•'.repeat(target.value.length) : target.value;
    const area = keyboard.querySelector('.gpl-k-preview');
    const caret = document.createElement('span'); caret.className = 'gpl-k-caret';
    caret.textContent = start === end ? '│' : value.slice(start, end) || '│';
    area.replaceChildren(document.createTextNode(value.slice(0, start)), caret,
      document.createTextNode(value.slice(end)));
    caret.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function write(value, selectionStart, selectionEnd = selectionStart) {
    if (!target || !target.isConnected) { done(); return; }
    const maximum = target.maxLength;
    if (maximum >= 0 && value.length > maximum) return;
    const descriptor = Object.getOwnPropertyDescriptor(
      target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value');
    descriptor.set.call(target, value);
    start = selectionStart; end = selectionEnd;
    try { target.setSelectionRange(start, end); } catch {}
    target.dispatchEvent(new Event('input', { bubbles: true }));
    preview();
  }
  function insert(text) {
    write(target.value.slice(0, start) + text + target.value.slice(end), start + text.length);
    if (shifted && !numeric) { shifted = false; draw(); }
  }
  function backspace() {
    if (start !== end) write(target.value.slice(0, start) + target.value.slice(end), start);
    else if (start > 0) write(target.value.slice(0, start - 1) + target.value.slice(end), start - 1);
  }
  function done() {
    if (!keyboard.open) return;
    closing = true;
    const field = target;
    if (field?.isConnected) field.dispatchEvent(new Event('change', { bubbles: true }));
    keyboard.close(); target = null;
    setTimeout(() => { closing = false; }, 150);
  }
  function key(label, action, className = '') {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.className = className;
    button.addEventListener('click', action);
    return button;
  }
  function draw() {
    const rows = numeric ? symbols : letters[language];
    rows.forEach((row, index) => {
      const container = keyboard.querySelector('.gpl-k-row' + (index + 1));
      container.replaceChildren(...[...row].map(letter => {
        const character = shifted && !numeric && language === 'en' ? letter.toUpperCase() : letter;
        return key(character, () => insert(character));
      }));
    });
    const tools = keyboard.querySelector('.gpl-k-tools');
    tools.replaceChildren(
      key(numeric ? 'ABC' : '123', () => { numeric = !numeric; draw(); }),
      key(language === 'en' ? 'עברית' : 'English', () => { language = language === 'en' ? 'he' : 'en'; numeric = false; draw(); }),
      key('⇧', () => { shifted = !shifted; draw(); }),
      key('Space', () => insert(' ')),
      key('←', () => { start = end = Math.max(0, start - 1); preview(); }),
      key('→', () => { start = end = Math.min(target.value.length, end + 1); preview(); }),
      key('⌫', backspace),
      key(target instanceof HTMLTextAreaElement ? '↵' : 'Select all', () => {
        if (target instanceof HTMLTextAreaElement) insert('\n');
        else { start = 0; end = target.value.length; preview(); }
      }),
      key('Done', done, 'gpl-k-done')
    );
    // Prevent the desktop input method from opening alongside the app keyboard.
    keyboard.querySelector('.gpl-k-done').focus({ preventScroll: true });
  }
  function show(field) {
    clearTimeout(opening);
    if (closing || keyboard.open || !eligible(field) || field.disabled || field.readOnly) return;
    opening = setTimeout(() => {
      if (!field.isConnected || closing || keyboard.open || document.activeElement !== field) return;
      target = field;
      start = field.selectionStart ?? field.value.length;
      end = field.selectionEnd ?? start;
      keyboard.querySelector('.gpl-k-field').textContent =
        field.labels?.[0]?.textContent.trim().slice(0, 50) || field.placeholder || 'Text';
      numeric = field.type === 'tel';
      draw(); keyboard.showModal(); preview();
      keyboard.querySelector('.gpl-k-done').focus({ preventScroll: true });
    }, 70);
  }
  document.addEventListener('focusin', event => { if (!keyboard.contains(event.target)) show(event.target); });
  document.addEventListener('pointerup', event => { if (!keyboard.contains(event.target)) show(event.target); });
  keyboard.addEventListener('cancel', event => { event.preventDefault(); done(); });
  keyboard.addEventListener('keydown', event => {
    if (!target || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { event.preventDefault(); done(); }
    else if (event.key === 'Backspace') { event.preventDefault(); backspace(); }
    else if (event.key === 'Enter') { event.preventDefault(); if (target instanceof HTMLTextAreaElement) insert('\n'); else done(); }
    else if (event.key.length === 1) { event.preventDefault(); insert(event.key); }
  });
})();
