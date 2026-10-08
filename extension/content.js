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
  const defaults = { enabled: true, compact: true, width: 88 };
  let settings = { ...defaults };
  let side, pane, column, host, toggle, status;
  let timer = 0;
  const records = new Map();
  const hidden = new Set();
  const columns = new Set();
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
    row.removeAttribute('data-wcs-row');
    row.removeAttribute('data-wcs-position');
    row.removeAttribute('data-wcs-selected');
    if (row.getAttribute('title') === record.appliedTitle) {
      if (record.originalTitle === null) row.removeAttribute('title');
      else row.setAttribute('title', record.originalTitle);
    }
  }

  function restore() {
    document.documentElement.removeAttribute('data-wcs-active');
    for (const [row, record] of records) cleanRow(row, record);
    records.clear();
    for (const el of hidden) el.removeAttribute('data-wcs-hide');
    hidden.clear();
    for (const el of columns) el.removeAttribute('data-wcs-column');
    columns.clear();
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
      if (Math.abs(box.width - width) > 8 || box.width > innerWidth * 0.65) break;
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
      record = { overlay, avatar, badge, signature: '', originalTitle: row.getAttribute('title'), appliedTitle: null };
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

  function ensureToolbar() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'wcs-toolbar';
    host.setAttribute('data-wcs-owned', '');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { position:fixed; z-index:10000; font:13px system-ui,sans-serif; }
      button { display:block; width:38px; height:38px; border:1px solid #ffffff35;
        border-radius:12px; background:#006b58; color:white; font:22px system-ui;
        cursor:pointer; box-shadow:0 2px 9px #0003; }
      button:hover { background:#00856b; } button:focus-visible { outline:3px solid #7ce9c4; outline-offset:3px; }
      #status { display:none; }`;
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.addEventListener('click', () => save({ compact: !settings.compact }));
    status = document.createElement('span');
    status.id = 'status';
    root.append(style, toggle, status);
    document.body.append(host);
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
        restore(); host?.remove(); return;
      }
      ensureToolbar();
      const rows = getRows();
      const active = settings.compact && innerWidth >= 700 && rows.length > 0;
      if (!active) restore();
      else {
        document.documentElement.setAttribute('data-wcs-active', '');
        document.documentElement.style.setProperty('--wcs-width', `${settings.width}px`);
        side.setAttribute('data-wcs-side', '');
        for (let node = side; node; node = node.parentElement) {
          node.setAttribute('data-wcs-column', ''); columns.add(node);
          if (node === column) break;
        }
        // Hide only branches outside the list; keep its scroll/virtualization tree intact.
        for (const el of hidden) el.removeAttribute('data-wcs-hide');
        hidden.clear();
        for (let node = pane; node !== side && node.parentElement; node = node.parentElement) {
          for (const sibling of node.parentElement.children) {
            if (sibling !== node) { sibling.setAttribute('data-wcs-hide', ''); hidden.add(sibling); }
          }
        }
        const current = new Set(rows);
        for (const [row, record] of records) {
          if (!current.has(row)) { cleanRow(row, record); records.delete(row); }
        }
        rows.forEach(updateRow);
      }
      const box = side.getBoundingClientRect();
      host.style.left = `${Math.max(4, active ? box.left + (settings.width - 38) / 2 : box.right - 48)}px`;
      host.style.top = `${Math.max(4, box.top + 8)}px`;
      toggle.textContent = active ? '»' : '«';
      const label = settings.compact ? 'Expandir conversas' : 'Recolher conversas';
      toggle.title = `${label} (Alt+Shift+C)`;
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-expanded', String(!active));
      status.textContent = active ? 'compact' : 'expanded';
    } finally { observe(); }
  }

  async function save(change) {
    settings = { ...settings, ...change };
    schedule();
    try { await chrome.storage.local.set(change); }
    catch { /* Extension reload: local controls still work until page refresh. */ }
  }

  function normalize(values) {
    return {
      enabled: values.enabled !== false,
      compact: values.compact !== false,
      width: [80, 88, 104].includes(Number(values.width)) ? Number(values.width) : 88
    };
  }

  window.addEventListener('resize', schedule);
  document.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && event.code === 'KeyC' && !event.repeat) {
      event.preventDefault(); save({ compact: !settings.compact });
    }
  });
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
