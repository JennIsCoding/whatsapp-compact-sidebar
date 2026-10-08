import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const fixture = await readFile(new URL('tests/fixture.html', root), 'utf8');
const script = await readFile(new URL('extension/content.js', root), 'utf8');
const css = await readFile(new URL('extension/content.css', root), 'utf8');

test('compact layout, native clicks, unread changes, recycled rows and restore', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(fixture);
    await page.evaluate(() => {
      const listeners = [];
      const data = { enabled: true, width: 88 };
      window.chrome = { storage: {
        local: {
          get: async defaults => ({ ...defaults, ...data }),
          set: async values => {
            const changes = {};
            for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: data[key], newValue: value }; data[key] = value; }
            listeners.forEach(fn => fn(changes, 'local'));
          }
        }, onChanged: { addListener: fn => listeners.push(fn) }
      }};
    });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    const active = () => page.waitForFunction(() => document.documentElement.hasAttribute('data-wcs-active'));
    await active();
    assert.equal(await page.locator('.column').evaluate(el => el.getBoundingClientRect().width), 88);
    // The list keeps the full height (flex-basis must not turn into a height inside the column).
    assert.ok(await page.locator('#pane-side').evaluate(el => el.getBoundingClientRect().height) > 600);
    // The list header beside #side is hidden in compact mode, so nothing spills over the chat.
    assert.equal(await page.locator('[data-testid="chatlist-header"]').isVisible(), false);
    // The empty drawer's left border must not draw a line across the conversation.
    assert.equal(await page.locator('[data-testid="drawer-middle"]').evaluate(el => getComputedStyle(el).borderLeftColor), 'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('[data-wcs-row]').count(), 20);
    // The archived button shows only its icon, centred in the list like the avatars.
    const centre = sel => page.locator(sel).evaluate(el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });
    assert.ok(Math.abs(await centre('#archived-icon') - await centre('[data-contact="0"] .wcs-avatar')) <= 1);
    assert.equal(await page.locator('[data-contact="1"] .wcs-badge').textContent(), '2');
    assert.equal(await page.locator('[data-contact="0"]').evaluate(el => el.getBoundingClientRect().height), 72);
    assert.equal(await page.locator('#main').evaluate(el => el.getBoundingClientRect().width), 1132);
    await mkdir(new URL('test-results/', root), { recursive: true });
    await page.screenshot({ path: new URL('test-results/compact.png', root).pathname.replace(/^\/(\w:)/, '$1') });
    await page.locator('[data-contact="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-contact="1"] .wcs-badge').hidden);
    assert.equal(await page.locator('#contact').textContent(), 'Marina');
    assert.equal(await page.locator('[data-contact="1"]').getAttribute('data-wcs-selected'), '');
    // Simulate incoming unread count and a virtualized row being reused.
    await page.evaluate(() => {
      const row = document.querySelector('[data-contact="4"]');
      row.querySelector('.unread').textContent = '99+';
      row.querySelector('.unread').setAttribute('aria-label', '99+ mensagens não lidas');
      row.querySelector('.name').title = 'Contato novo';
      row.querySelector('.name').textContent = 'Contato novo';
    });
    await page.waitForFunction(() => document.querySelector('[data-contact="4"] .wcs-badge').textContent === '99+');
    assert.match(await page.locator('[data-contact="4"]').getAttribute('title'), /^Contato novo/);
    // Always compact: no expand button, and the old shortcut does nothing.
    assert.equal(await page.locator('#wcs-toolbar').count(), 0);
    await page.keyboard.press('Alt+Shift+KeyC');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('html').getAttribute('data-wcs-active'), '');
    await page.locator('#pane-side').evaluate(el => { el.scrollTop = 720; });
    await page.locator('[data-contact="12"]').click();
    assert.equal(await page.locator('#contact').textContent(), 'Design');
    await page.evaluate(() => chrome.storage.local.set({ width: 104 }));
    await page.waitForFunction(() => document.querySelector('.column').getBoundingClientRect().width === 104);
    // Narrow or resized windows stay compact (no 700 px cut-off any more).
    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.column').evaluate(el => el.getBoundingClientRect().width), 104);
    // The conversation shrinks with the window: no horizontal scroll, chat ends at the window edge.
    await page.setViewportSize({ width: 420, height: 800 });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => { const s = document.scrollingElement; s.scrollLeft = 9999; return s.scrollLeft; }), 0);
    assert.equal(await page.locator('.column').evaluate(el => el.getBoundingClientRect().width), 104);
    assert.ok(await page.locator('#main').evaluate(el => el.getBoundingClientRect().right <= innerWidth + 0.5));
    await page.setViewportSize({ width: 1280, height: 800 });
    await active();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: new URL('test-results/dark.png', root).pathname.replace(/^\/(\w:)/, '$1') });
    // Sidebar removal/recreation (logout/login or SPA navigation).
    await page.evaluate(() => {
      const side = document.querySelector('#side');
      window.savedSide = side; side.remove();
    });
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-wcs-active'));
    await page.evaluate(() => {
      // Use the original node: its host event handlers stay attached.
      document.querySelector('.column').append(window.savedSide);
    });
    await active();
    assert.equal(await page.locator('.wcs-avatar-overlay').count(), 20);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('unknown layouts are untouched; disabled mode and popup settings work', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent('<main>Login / QR code</main>');
    await page.evaluate(() => {
      const listeners = []; const data = { enabled: true, width: 88 };
      window.chrome = { storage: { local: {
        get: async defaults => ({ ...defaults, ...data }),
        set: async values => { Object.assign(data, values); listeners.forEach(fn => fn(Object.fromEntries(Object.entries(values).map(([k,v]) => [k, {newValue:v}])), 'local')); }
      }, onChanged: { addListener: fn => listeners.push(fn) } } };
    });
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('html').getAttribute('data-wcs-active'), null);
    assert.equal(await page.locator('main').textContent(), 'Login / QR code');
    // Mount a sidebar after the initial login screen; mutation observer must pick it up.
    const app = fixture.match(/<div id="app">[\s\S]*?<script>/)[0].replace(/<script>$/, '');
    const fixtureJS = fixture.match(/<script>([\s\S]*?)<\/script>/)[1];
    await page.evaluate(html => { document.body.innerHTML = html; }, app);
    await page.addScriptTag({ content: fixtureJS });
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-wcs-active'));
    await page.evaluate(() => chrome.storage.local.set({ enabled: false }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-wcs-active'));
    assert.equal(await page.locator('[data-wcs-row]').count(), 0);
    assert.equal(await page.locator('[data-wcs-hide]').count(), 0);
    // Empty/changed chat list must fail open instead of leaving an unusable rail.
    await page.evaluate(() => { document.querySelector('.virtual').replaceChildren(); chrome.storage.local.set({enabled:true}); });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('html').getAttribute('data-wcs-active'), null);
    const popup = await readFile(new URL('extension/popup.html', root), 'utf8');
    await page.evaluate(html => { document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1]; }, popup);
    await page.addScriptTag({ content: await readFile(new URL('extension/popup.js', root), 'utf8') });
    await page.locator('#enabled').uncheck();
    await page.locator('#width').selectOption('80');
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get({})).width), 80);
    assert.equal(await page.locator('#status').textContent(), 'Preferência salva.');
  } finally { await browser.close(); }
});

test('Manifest V3 loads in an isolated browser and stays compact across reloads', async () => {
  const extension = fileURLToPath(new URL('extension/', root));
  const context = await chromium.launchPersistentContext('', {
    headless: true, channel: 'chromium',
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    // Intercept every network request: no connection to a WhatsApp account/server.
    await context.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort());
    const page = await context.newPage();
    await page.goto('https://web.whatsapp.com/');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-wcs-active'));
    assert.equal(await page.locator('#wcs-toolbar').count(), 0);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-wcs-active'));
    assert.equal(await page.locator('#wcs-toolbar').count(), 0);
  } finally { await context.close(); }
});


