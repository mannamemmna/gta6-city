// Probe: load a staged shot, apply a camera/light override, repaint, capture.
//   node tmp-renders/probe.mjs vista out.jpg '<js body>'
// The body runs with `g` = window.__game in scope and may not be async.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const [shot = 'vista', out = 'probe.jpg', body = ''] = process.argv.slice(2);
const BASE = process.env.COBALT_URL ?? 'http://127.0.0.1:8098/';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(180000);
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${BASE}?shot=${shot}`, { waitUntil: 'load' });
try {
  await page.waitForFunction('window.__shotReady === true', { timeout: 150000 });
} catch { console.log('never ready'); }
const err = await page.evaluate(() => window.__shotError ?? null);
if (err) console.log('[shot error]', err);

const res = await page.evaluate((src) => {
  const g = window.__game;
  g.running = false;
  // eslint-disable-next-line no-new-func
  const fn = new Function('g', src);
  const r = fn(g);
  g.cam.snap = true;
  g.paint();
  g.paint();
  return { r, cam: g.cam.pos, tgt: g.cam.target, fov: g.cam.fov };
}, body);
console.log(JSON.stringify(res));

const buf = await page.screenshot({ type: 'jpeg', quality: 88 });
writeFileSync(out, buf);
console.log(`${out} ${buf.length} bytes`);
await browser.close();
