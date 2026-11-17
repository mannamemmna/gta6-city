// Render one staged shot of Cobalt Bay to a JPEG.
//
//   node tools/capture.mjs cover screenshots/1-cover.jpg
//
// Steps the JPEG quality down until the file fits the bounty's 256 KiB cap and
// prints anything the page reported as an error.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [shot = 'cover', out = 'shot.jpg'] = process.argv.slice(2);
const BASE = process.env.COBALT_URL ?? 'http://127.0.0.1:8098/';
const CAP = 262144;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${BASE}?shot=${shot}`, { waitUntil: 'load' });
let ready = false;
try {
  await page.waitForFunction('window.__shotReady === true', { timeout: 150000 });
  ready = true;
} catch {
  console.log('shot never signalled ready');
}
const err = await page.evaluate(() => window.__shotError ?? null);
if (err) console.log('[shot error]', err);
await page.waitForTimeout(900);

let quality = 92;
let buf = null;
for (let i = 0; i < 8; i++) {
  buf = await page.screenshot({ type: 'jpeg', quality });
  if (buf.length <= CAP) break;
  quality -= 8;
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
const info = await page.evaluate(() => ({
  state: window.__game?.state, frames: window.__game?.frame,
}));
console.log(`${shot} -> ${out} ${buf.length} bytes q=${quality} ready=${ready} ${JSON.stringify(info)}`);
await browser.close();
