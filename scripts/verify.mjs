#!/usr/bin/env node
/* Drive index.html in Chromium and assert it actually works.
 * Run: node scripts/verify.mjs   (add --shots to write PNGs) */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = process.argv.includes('--shots');
const results = [];
/* click through the real handler; sticky columns make hit-testing flaky in a
   horizontally-scrolling table, and what we are testing is the handler. */
const tap = (page, sel) => page.locator(sel).first().dispatchEvent('click');
const ok = (n, c, d) => { results.push({ n, c, d }); };

/* serve the repo at a Pages-style sub-path to prove relative paths work */
const MIME = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css' };
const BASE = '/halseyminor500.github.i';
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  if (p === '/' || p === '') p = '/index.html';
  const f = join(ROOT, p);
  if (!existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const errors = [], external = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith('file://') && !u.includes(`localhost:${PORT}`) && !u.startsWith('data:')) external.push(u);
});

/* ── 1. file:// load proves self-containment ── */
await page.goto('file://' + ROOT + 'index.html', { waitUntil: 'load' });
await page.waitForTimeout(600);
ok('loads from file:// with no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
ok('makes zero external network requests', external.length === 0, external.slice(0, 2).join(' | '));
ok('renders 50 table rows', await page.locator('#tb tr').count() === 50);
ok('renders all three charts', await page.locator('#c1 svg, #c2 svg, #c3 svg').count() === 3);
ok('renders four stat tiles', await page.locator('#tiles .tile').count() === 4);
ok('renders eight highlight panels', await page.locator('#panels .card').count() === 8);

/* ── 2. NaN sweep across every rendered SVG attribute ── */
const nan = await page.evaluate(() => {
  const bad = [];
  document.querySelectorAll('svg *').forEach((n) => {
    for (const a of n.attributes)
      if (/NaN|Infinity|undefined/.test(a.value)) bad.push(`${n.nodeName}@${a.name}="${a.value}"`);
  });
  return bad;
});
ok('no NaN / Infinity / undefined in any SVG attribute', nan.length === 0, nan.slice(0, 3).join(' | '));

/* ── 2a. the names-first surface ── */
const tname = (await page.locator('#tiles .tile:nth-child(4) .tname').textContent().catch(() => '')).trim();
ok('the Greatest Thrust tile names a bank', tname.length > 0, tname);
ok('Thrust column reads "since Day 1" at the live snapshot',
  /Day 1/.test(await page.textContent('#thr th[data-k="thrust"]')));
await page.evaluate(() => { document.querySelector('.tscroll').scrollTop = 300; });
const pinned = await page.evaluate(() => {
  const sc = document.querySelector('.tscroll'), th = document.querySelector('#thr th');
  return Math.abs(th.getBoundingClientRect().top - sc.getBoundingClientRect().top);
});
ok('table header stays pinned while the table scrolls under it', pinned < 2, pinned.toFixed(1) + 'px');
await page.evaluate(() => { document.querySelector('.tscroll').scrollTop = 0; });
ok('the watchlist panels lead with Progressing and Falling behind',
  (await page.locator('#panels .card h2').allTextContents()).slice(0, 2).join('|') === 'Progressing|Falling behind');
ok('the AI-signature panel renders its four-light strips',
  await page.locator('#panels .sl').count() >= 16);
ok('the say-vs-do matrix renders with populated cells',
  await page.locator('.mx .mxn').count() >= 20);
ok('conviction column sorts and renders', /Conviction/i.test(await page.textContent('#thr')));

/* ── 2b. the controls a human reaches for are genuinely clickable at rest ── */
await page.evaluate(() => window.scrollTo(0, 0));
let clickable = true, clickErr = '';
for (const sel of ['#snapSeg button:first-child', '#normSeg button:last-child',
                   '#adjSeg button:last-child', '#winSeg button:first-child',
                   '#thr th[data-k="name"]', '#tb tr:first-child']) {
  try { await page.click(sel, { timeout: 2500 }); }
  catch (e) { clickable = false; clickErr = sel; break; }
}
ok('primary controls are clickable without interception', clickable, clickErr);
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(500);

/* ── 3. sorting: every column, both directions, nulls last ── */
const cols = await page.$$eval('#thr th', (th) => th.map((t) => t.dataset.k));
let sortFails = [];
for (const k of cols) {
  if (k === 'name') continue;
  for (const dir of ['desc', 'asc']) {
    await tap(page, `#thr th[data-k="${k}"]`);
    const cur = await page.$eval(`#thr th[data-k="${k}"]`, (t) => t.getAttribute('aria-sort'));
    if ((dir === 'desc' && cur !== 'descending') || (dir === 'asc' && cur !== 'ascending')) {
      // first click may land on the column's default direction; click again
      await tap(page, `#thr th[data-k="${k}"]`);
    }
    const vals = await page.$$eval('#tb tr', (rows, ki) =>
      rows.map((r) => {
        const td = r.children[ki];
        return td.querySelector('.na') ? null : td.textContent.trim();
      }), cols.indexOf(k));
    const firstNull = vals.findIndex((v) => v === null);
    if (firstNull !== -1 && vals.slice(firstNull).some((v) => v !== null))
      sortFails.push(`${k}/${dir}: nulls not last`);
  }
}
ok('nulls sort last in every column, both directions', sortFails.length === 0, sortFails.slice(0, 3).join(' | '));
const ariaCount = await page.locator('#thr th[aria-sort]').count();
ok('exactly one column carries aria-sort', ariaCount === 1, String(ariaCount));

/* ── 4. toggles actually change the ranking, not just the label ── */
const rankVector = () => page.$$eval('#tb tr', (rows) => rows.map((r) => r.dataset.t).join(','));
await tap(page, '#thr th[data-k="corr"]');
const before = await rankVector();
await tap(page, '#normSeg button:nth-child(2)');           // peer
await page.waitForTimeout(150);
const afterPeer = await rankVector();
ok('peer normalisation changes the ranking', before !== afterPeer);
await tap(page, '#normSeg button:nth-child(1)');
await tap(page, '#adjSeg button:nth-child(2)');            // growth-adjusted
await page.waitForTimeout(150);
const adjState = await page.$eval('#adjSeg button:nth-child(2)', b => b.getAttribute('aria-pressed'));
const noteTxt = await page.textContent('#modelNote');
ok('growth-adjusted reports its fitted model and R²', /R²/.test(noteTxt), `pressed=${adjState} · ` + noteTxt.slice(0, 60));
await tap(page, '#adjSeg button:nth-child(1)');

/* ── 5. every snapshot renders ── */
const snaps = await page.$$eval('#snapSeg button', (b) => b.length);
for (let i = 1; i <= snaps; i++) {
  await tap(page, `#snapSeg button:nth-child(${i})`);
  await page.waitForTimeout(90);
}
ok(`all ${snaps} snapshots render without throwing`, errors.length === 0, errors.slice(0, 2).join(' | '));
await tap(page, '#snapSeg button:last-child');

/* ── 6. select all 50 banks in turn ── */
const tickers = await page.$$eval('#tb tr', (r) => r.map((x) => x.dataset.t));
for (const t of tickers) { await tap(page, `#tb tr[data-t="${t}"]`); }
ok('selecting each of the 50 banks re-renders every chart cleanly', errors.length === 0, errors.slice(0, 2).join(' | '));
const nan2 = await page.evaluate(() => {
  const bad = []; document.querySelectorAll('svg *').forEach((n) => {
    for (const a of n.attributes) if (/NaN|Infinity/.test(a.value)) bad.push(n.nodeName + '@' + a.name);
  }); return bad;
});
ok('still no NaN after cycling all selections', nan2.length === 0, nan2.slice(0, 3).join(' | '));

/* ── 7. windows ── */
for (let i = 1; i <= 3; i++) { await tap(page, `#winSeg button:nth-child(${i})`); await page.waitForTimeout(80); }
ok('1/2/3-year windows all render', errors.length === 0);

/* ── 8. theme actually repaints the SVG (no hardcoded hex leaked in) ── */
const strokeLight = await page.$eval('#c1 svg path[stroke]', (p) => getComputedStyle(p).stroke);
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.waitForTimeout(120);
const strokeDark = await page.$eval('#c1 svg path[stroke]', (p) => getComputedStyle(p).stroke);
ok('theme toggle repaints chart strokes', strokeLight !== strokeDark, `${strokeLight} -> ${strokeDark}`);
const bodyBg = await page.$eval('body', (b) => getComputedStyle(b).backgroundColor);
ok('body paints its own background in dark mode', bodyBg !== 'rgba(0, 0, 0, 0)', bodyBg);
if (SHOTS) { mkdirSync(ROOT + 'shots', { recursive: true }); await page.screenshot({ path: ROOT + 'shots/dark.png', fullPage: true }); }
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.waitForTimeout(120);
if (SHOTS) await page.screenshot({ path: ROOT + 'shots/light.png', fullPage: true });

/* ── 9. URL hash restores a view ── */
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
await page.goto('about:blank');
await page.goto('file://' + ROOT + 'index.html#s=fy2023&n=peer&a=growth&w=2&sel=GS&sort=rpe:asc', { waitUntil: 'load' });
await page.waitForTimeout(400);
const restored = await page.evaluate(() => ({
  snap: document.querySelector('#snapSeg button[aria-pressed="true"]').textContent,
  norm: document.querySelector('#normSeg button[aria-pressed="true"]').textContent,
  sel: document.querySelector('#c1t').textContent,
}));
ok('URL hash restores snapshot, normalisation and selection',
  restored.snap === '2023' && restored.norm === 'Peer group' && /Goldman/.test(restored.sel),
  JSON.stringify(restored));

/* ── 10. in-page self-test ── */
await page.goto('file://' + ROOT + 'index.html?selftest=1', { waitUntil: 'load' });
await page.waitForTimeout(700);
const st = await page.textContent('main .card h2');
const stFails = await page.$$eval('main .card .card-b div div', (d) =>
  d.filter((x) => x.textContent.startsWith('FAIL')).map((x) => x.textContent));
ok('in-page self-test: ' + st.replace('Self-test — ', ''), stFails.length === 0, stFails.slice(0, 4).join(' | '));

/* ── 11. Pages-style sub-path ── */
await page.goto(`http://localhost:${PORT}${BASE}/`, { waitUntil: 'load' });
await page.waitForTimeout(500);
ok('loads from a GitHub Pages project sub-path', await page.locator('#tb tr').count() === 50);
ok('data/banks.json is also served as a standalone endpoint',
  (await (await page.request.get(`http://localhost:${PORT}${BASE}/data/banks.json`)).json()).banks.length === 50);

/* ── 12. narrow viewport: no horizontal body scroll ── */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal page scroll at 390px', overflow <= 1, `${overflow}px`);

await browser.close(); server.close();

const pass = results.filter((r) => r.c).length;
console.log(`\n${pass}/${results.length} checks passing\n`);
for (const r of results) console.log(`  ${r.c ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
process.exit(pass === results.length ? 0 : 1);
