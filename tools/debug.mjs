// Debug helper: opens one URL, prints console messages and page errors, then waits briefly.
import { chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
const url = process.argv[2] ?? 'http://127.0.0.1:8098/index.html?shot=cover';
const waitMs = Number(process.argv[3] ?? 8000);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', (m) => console.log('[console.' + m.type() + ']', m.text().slice(0, 500)));
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 900)));
p.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));
const t0 = Date.now();
try { await p.goto(url, { waitUntil: 'load', timeout: 40000 }); } catch (e) { console.log('[goto]', e.message.slice(0, 200)); }
console.log('loaded in', Date.now() - t0, 'ms');
await p.waitForTimeout(waitMs);
console.log('ready =', await p.evaluate(() => window.__shotReady === true).catch((e) => 'eval error: ' + e.message));
console.log('info =', JSON.stringify(await p.evaluate(() => (window.__shotInfo ? window.__shotInfo() : null)).catch(() => null)));
await b.close();
process.exit(0);
