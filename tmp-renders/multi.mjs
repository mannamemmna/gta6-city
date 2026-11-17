// Multi-probe: render the same staged shot several times with different
// camera/light overrides in one browser session.
//   node tmp-renders/multi.mjs vista probes.json
// probes.json: [{ "name": "a", "js": "g.cam.pos=[...]; ..." }, ...]
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

const [shot = 'vista', listFile = 'probes.json'] = process.argv.slice(2);
const probes = JSON.parse(readFileSync(listFile, 'utf8'));
const BASE = process.env.COBALT_URL ?? 'http://127.0.0.1:8098/';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}?shot=${shot}`, { waitUntil: 'load' });
await page.waitForFunction('window.__shotReady === true', { timeout: 150000 });
console.log('error:', await page.evaluate(() => window.__shotError ?? null));

for (const p of probes) {
  const r = await page.evaluate((src) => {
    const g = window.__game;
    g.running = false;
    new Function('g', src)(g);
    g.cam.snap = true;
    g.paint(); g.paint();
    return { cam: g.cam.pos.map(n => +n.toFixed(1)), tgt: g.cam.target.map(n => +n.toFixed(1)), fov: +g.cam.fov.toFixed(2) };
  }, p.js);
  const buf = await page.screenshot({ type: 'jpeg', quality: 86 });
  const out = `tmp-renders/p-${p.name}.jpg`;
  writeFileSync(out, buf);
  console.log(`${p.name}: ${out} ${buf.length}b ${JSON.stringify(r)}`);
}
await browser.close();
