(() => {
  'use strict';
  if (window.__wcsLoaded) return;
  window.__wcsLoaded = true;

  // Keep WhatsApp-specific discovery here; never depend on its generated classes.
  const SELECTORS = {
    side: '#side', pane: '#pane-side',
    rows: '[role="row"], [role="listitem"]',
    avatar: 'img, [data-icon="default-user"], [data-icon="default-group"], [data-icon="default-community"]',
    name: 'span[title], [data-testid="cell-frame-title"]',
    unread: '[aria-label], [data-testid="icon-unread-count"], [data-icon="unread-count"]'
  };
  // Always compact while enabled: no expand/collapse button or shortcut. To search or start a chat, disable it in the popup.
  const defaults = { enabled: true, width: 88 };
  let settings = { ...defaults };
  let side, pane, column;
  let timer = 0;
  const records = new Map();
  const hidden = new Set();
  const columns = new Set();
  const shrinkers = new Set();
  const observer = new MutationObserver(schedule);

  function observe() {
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['aria-label', 'aria-selected', 'title', 'src', 'data-icon', 'data-testid']
    });
  }

  function schedule() {
    if (!timer) timer = window.setTimeout(render, 100);
  }

  function cleanRow(row, record) {
    record.overlay.remove();
    record.zone?.removeAttribute('data-wcs-avatar-zone');
    row.removeAttribute('data-wcs-row');
    row.removeAttribute('data-wcs-position');
    row.removeAttribute('data-wcs-selected');
    if (row.getAttribute('title') === record.appliedTitle) {
      if (record.originalTitle === null) row.removeAttribute('title');
      else row.setAttribute('title', record.originalTitle);
    }
  }

  const ARCHIVED = '[data-testid="chatlist-panel-archived-button"]';
  let archivedShift = 0;

  // Centre every avatar (and the "Arquivadas" icon) on the same vertical line: the middle of the
  // list. WhatsApp's rows don't all start at the same x (status rings, margins, versions), so a
  // plain "centre inside the row" left them zig-zagging. Measure instead of hard-coding.
  function alignAll() {
    const box = pane.getBoundingClientRect();
    if (!box.width) return;
    const target = box.left + pane.clientWidth / 2;
    const centre = el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
    for (const record of records.values()) {
      if (!record.avatar.isConnected || !record.avatar.getClientRects().length) continue;
      const shift = Math.round((record.shift + target - centre(record.avatar)) * 10) / 10;
      if (Math.abs(shift - record.shift) < 0.5) continue;
      record.shift = shift;
      record.overlay.style.transform = shift ? `translateX(${shift}px)` : '';
    }
    const button = pane.querySelector(ARCHIVED);
    const icon = button?.querySelector('svg, [data-icon]');
    if (!button || !icon) return;
    const shift = Math.round((archivedShift + target - centre(icon)) * 10) / 10;
    if (Math.abs(shift - archivedShift) < 0.5) return;
    archivedShift = shift;
    button.style.setProperty('--wcs-archived-shift', `${shift}px`);
  }

  // Let the conversation shrink with the window: WhatsApp gives the chat and the app wrappers a
  // minimum width, which caused horizontal scrolling in narrow windows. Only the path from the
  // conversation (#main) up to the page is touched.
  function allowShrink() {
    for (const el of shrinkers) el.removeAttribute('data-wcs-shrink');
    shrinkers.clear();
    const main = document.querySelector('#main');
    for (let node = main; node && node !== document.documentElement; node = node.parentElement) {
      node.setAttribute('data-wcs-shrink', ''); shrinkers.add(node);
    }
  }

  function restore() {
    archivedShift = 0;
    document.querySelectorAll(ARCHIVED).forEach(el => el.style.removeProperty('--wcs-archived-shift'));
    document.documentElement.removeAttribute('data-wcs-active');
    for (const [row, record] of records) cleanRow(row, record);
    records.clear();
    for (const el of hidden) el.removeAttribute('data-wcs-hide');
    hidden.clear();
    for (const el of columns) el.removeAttribute('data-wcs-column');
    columns.clear();
    for (const el of shrinkers) el.removeAttribute('data-wcs-shrink');
    shrinkers.clear();
    column?.removeAttribute('data-wcs-column-outer');
    side?.removeAttribute('data-wcs-side');
  }

  function findColumn(el) {
    let candidate = el;
    // Only ascend through wrappers of the same width. Never resize the app/main.
    const width = el.getBoundingClientRect().width;
    for (let i = 0; i < 4; i++) {
      const parent = candidate.parentElement;
      if (!parent || parent === document.body || parent.id === 'app' || parent.querySelector('#main')) break;
      const box = parent.getBoundingClientRect();
      // No "% of the window" limit: in narrow windows it stopped at the wrong wrapper and the list
      // kept its full width, pushing the conversation off-screen.
      if (Math.abs(box.width - width) > 8) break;
      candidate = parent;
    }
    return candidate;
  }

  function unreadFor(row) {
    for (const el of row.querySelectorAll(SELECTORS.unread)) {
      if (el.closest('[data-wcs-owned]')) continue;
      const label = el.getAttribute('aria-label') || '';
      const explicit = el.matches('[data-testid="icon-unread-count"], [data-icon="unread-count"]');
      if (!explicit && !/(unread|não lid[ao]|nao lid[ao]|no le[ií]d[oa]|sin leer)/i.test(label)) continue;
      const raw = (el.textContent || '').trim();
      const numeric = /^\d[\d.,]*\+?$/.test(raw) ? raw : label.match(/\d[\d.,]*\+?/)?.[0];
      return { text: numeric || '•', label: label || `${numeric || ''} mensagens não lidas`.trim() };
    }
    return null;
  }

  function getRows() {
    return [...pane.querySelectorAll(SELECTORS.rows)].filter(row =>
      !row.querySelector(SELECTORS.rows) && [...row.querySelectorAll(SELECTORS.avatar)].some(el => !el.closest('[data-wcs-owned]')));
  }

  function updateRow(row) {
    let record = records.get(row);
    if (!record) {
      const overlay = document.createElement('div');
      overlay.setAttribute('data-wcs-owned', '');
      overlay.className = 'wcs-avatar-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      const avatar = document.createElement('span');
      avatar.className = 'wcs-avatar';
      const badge = document.createElement('span');
      badge.className = 'wcs-badge';
      overlay.append(avatar, badge);
      record = { overlay, avatar, badge, zone: null, shift: 0, signature: '', originalTitle: row.getAttribute('title'), appliedTitle: null };
      records.set(row, record);
      if (getComputedStyle(row).position === 'static') row.setAttribute('data-wcs-position', '');
      row.setAttribute('data-wcs-row', '');
      row.append(overlay);
    }
    if (!row.contains(record.overlay)) row.append(record.overlay);
    // A virtualized row can be recycled for a completely different contact.
    const source = [...row.querySelectorAll(SELECTORS.avatar)].find(el => !el.closest('[data-wcs-owned]'));
    const nameEl = row.querySelector(SELECTORS.name);
    const name = nameEl?.getAttribute('title') || nameEl?.textContent?.trim() || 'Conversa';
    // Clicking the native photo of a contact with a status opens the status viewer. Make the photo
    // area click-through so the click lands on the row itself, which opens the chat.
    let zone = null;
    if (source && nameEl) {
      zone = source;
      while (zone.parentElement && zone.parentElement !== row && !zone.parentElement.contains(nameEl)) zone = zone.parentElement;
      if (zone.contains(nameEl)) zone = null;
    }
    if (record.zone !== zone) {
      record.zone?.removeAttribute('data-wcs-avatar-zone');
      zone?.setAttribute('data-wcs-avatar-zone', '');
      record.zone = zone;
    }
    const src = source?.tagName === 'IMG' ? source.getAttribute('src') : null;
    const safeSrc = src && /^(https:|blob:|data:image\/)/i.test(src) ? src : null;
    const signature = `${safeSrc || ''}|${name}`;
    if (record.signature !== signature) {
      record.signature = signature;
      record.avatar.replaceChildren();
      record.avatar.textContent = name === 'Conversa' ? '●' : [...name].slice(0, 2).join('').toLocaleUpperCase();
      if (safeSrc) {
        const image = document.createElement('img');
        image.alt = '';
        image.addEventListener('error', () => image.remove(), { once: true });
        image.src = safeSrc;
        record.avatar.append(image);
      }
    }
    const unread = unreadFor(row);
    record.badge.hidden = !unread;
    record.badge.textContent = unread?.text || '';
    const title = `${name}${unread ? ` — ${unread.label}` : ''}`;
    // Preserve an unrelated title update made by the host application.
    if (record.appliedTitle !== null && row.getAttribute('title') !== record.appliedTitle) {
      record.originalTitle = row.getAttribute('title');
    }
    row.setAttribute('title', title);
    record.appliedTitle = title;
    const selected = row.getAttribute('aria-selected') === 'true' || !!row.querySelector('[aria-selected="true"]');
    row.toggleAttribute('data-wcs-selected', selected);
  }

  function render() {
    timer = 0;
    observer.disconnect(); // Our own attributes/overlays must not cause observer loops.
    try {
      const nextSide = document.querySelector(SELECTORS.side);
      const nextPane = document.querySelector(SELECTORS.pane);
      if (side !== nextSide || pane !== nextPane) {
        restore();
        side = nextSide; pane = nextPane;
        column = side ? findColumn(side) : null;
      }
      if (!settings.enabled || !side || !pane || !side.contains(pane) || !side.getClientRects().length) {
        restore(); return;
      }
      const rows = getRows();
      const active = rows.length > 0;
      if (!active) restore();
      else {
        document.documentElement.setAttribute('data-wcs-active', '');
        document.documentElement.style.setProperty('--wcs-width', `${settings.width}px`);
        side.setAttribute('data-wcs-side', '');
        for (let node = side; node; node = node.parentElement) {
          node.setAttribute('data-wcs-column', ''); columns.add(node);
          if (node === column) break;
        }
        column.setAttribute('data-wcs-column-outer', '');
        // Hide only branches outside the list; keep its scroll/virtualization tree intact.
        for (const el of hidden) el.removeAttribute('data-wcs-hide');
        hidden.clear();
        for (let node = pane; node !== side && node.parentElement; node = node.parentElement) {
          for (const sibling of node.parentElement.children) {
            if (sibling !== node) { sibling.setAttribute('data-wcs-hide', ''); hidden.add(sibling); }
          }
        }
        // Current WhatsApp puts the list header (title, new chat, menu) beside #side, inside the
        // column. It does not fit in the compact width, so hide it too (disabling the extension brings it back).
        for (let node = side; node !== column && node.parentElement; node = node.parentElement) {
          for (const sibling of node.parentElement.children) {
            if (sibling !== node && !sibling.querySelector('#main') && !sibling.hasAttribute('data-wcs-owned')) {
              sibling.setAttribute('data-wcs-hide', ''); hidden.add(sibling);
            }
          }
        }
        const current = new Set(rows);
        for (const [row, record] of records) {
          if (!current.has(row)) { cleanRow(row, record); records.delete(row); }
        }
        rows.forEach(updateRow);
        alignAll();
        allowShrink();
      }
    } finally { observe(); }
  }

  function normalize(values) {
    return {
      enabled: values.enabled !== false,
      width: [80, 88, 104].includes(Number(values.width)) ? Number(values.width) : 88
    };
  }

  window.addEventListener('resize', schedule);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const next = { ...settings };
    for (const key of Object.keys(defaults)) if (changes[key]) next[key] = changes[key].newValue ?? defaults[key];
    settings = normalize(next); schedule();
  });
  chrome.storage.local.get(defaults).then(values => {
    settings = normalize(values); render();
  }).catch(() => render());
})();
