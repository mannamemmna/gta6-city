// Repeatable render loop: starts a static server on game/, captures every shot in shots.json with
// the SwiftShader Chromium build, writes screenshots/, and reports page errors and timings.
// Usage: node tools/capture.mjs [--only cover] [--size 1280x720] [--quality 92]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/tmp/pw/node_modules/playwright/index.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const gameDir = join(root, 'game');
const shotDir = join(root, 'screenshots');
if (!existsSync(shotDir)) mkdirSync(shotDir, { recursive: true });

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const sizeArg = args.includes('--size') ? args[args.indexOf('--size') + 1] : '1280x720';
const [W, H] = sizeArg.split('x').map(Number);
const quality = args.includes('--quality') ? Number(args[args.indexOf('--quality') + 1]) : 92;

const PORT = Number(process.env.PORT ?? 8098);
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: gameDir, stdio: 'ignore',
});
const stop = () => { try { server.kill('SIGKILL'); } catch {} };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 900));

const shots = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8')).filter((s) => !only || s.name.includes(only));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

let failures = 0;
for (const shot of shots) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + String(e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });
  const url = `http://127.0.0.1:${PORT}/index.html${shot.query}`;
  const t0 = Date.now();
  let timedOut = false;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 180000 });
  } catch (e) {
    timedOut = true;
    errs.push('READY-TIMEOUT: ' + e.message.slice(0, 200));
  }
  await page.waitForTimeout(350);
  const cdp = await ctx.newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, fromSurface: true });
  const out = join(shotDir, shot.name);
  writeFileSync(out, Buffer.from(data, 'base64'));
  const bytes = statSync(out).size;
  const info = await page.evaluate(() => (window.__shotInfo ? window.__shotInfo() : null)).catch(() => null);
  console.log(JSON.stringify({
    shot: shot.name, ms: Date.now() - t0, bytes, kb: Math.round(bytes / 1024), timedOut,
    errors: errs.slice(0, 6), info,
  }, null, 1));
  if (errs.some((e) => e.startsWith('PAGEERROR')) || timedOut) failures += 1;
  await page.close();
}
await browser.close();
stop();
console.log(failures ? `\n${failures} shot(s) with errors` : '\nall shots clean');
process.exit(0);
