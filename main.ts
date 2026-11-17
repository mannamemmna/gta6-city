// Hand-in program for the Cobalt Bay entry (gta6-01).
//
// A Node 22 program, standard library only: it validates the repository's game/
// and screenshots/ against the bounty's caps, copies them into the output
// directory the grader gives it (MAKEFUN_OUTPUT_DIR stands in for /output
// outside the grader), then writes dossier.json with the kit's own
// buildDossier so the dossier is byte for byte what the scorer would produce.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Nothing here touches the network; the game itself is plain static files that
// run offline from game/index.html.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildDossier } from './vendor/makefun-game.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// The scorer's limits (its own reference/gate.json). Only text_max_bytes changes
// the dossier's bytes; the rest are checked here so a run fails loudly rather
// than handing in something the gate would reject.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};
const MIN_SHOTS = 1;
const SHOT_EXT = /\.(jpe?g|png)$/i;

function fail(message: string): never {
  process.stderr.write(`main.ts: ${message}\n`);
  process.exit(1);
}

// JPEG starts ff d8 ff, PNG starts 89 50 4e 47 0d 0a 1a 0a. Trust the bytes, not
// the extension: the gate decodes the file.
function imageKind(buf: Buffer): 'jpeg' | 'png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  return null;
}

type Entry = { full: string; dir: boolean; size: number };

function listEntries(root: string): Entry[] {
  const out: Entry[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) fail(`${relative(HERE, full)} is a symlink; game/ must be plain files and directories`);
      if (entry.isDirectory()) { out.push({ full, dir: true }); walk(full); }
      else if (entry.isFile()) out.push({ full, dir: false, size: statSync(full).size });
      else fail(`${relative(HERE, full)} is not a regular file or directory`);
    }
  };
  walk(root);
  return out;
}

function checkGame() {
  const gameDir = join(HERE, 'game');
  if (!existsSync(gameDir)) fail('game/ is missing beside main.ts');
  const index = join(gameDir, 'index.html');
  if (!existsSync(index) || !statSync(index).isFile()) fail('game/index.html is missing');
  const indexSize = statSync(index).size;
  if (indexSize > 1048576) fail(`game/index.html is ${indexSize} bytes, over the 1 MiB cap`);

  const entries = listEntries(gameDir);
  const count = entries.length + 1; // the directory itself counts toward the cap
  if (count > CAPS.game_max_files) fail(`game/ holds ${count} entries, over the ${CAPS.game_max_files} cap`);
  let bytes = 0;
  for (const e of entries) {
    const rel = relative(gameDir, e.full);
    if (Buffer.byteLength(rel, 'utf8') > CAPS.game_path_max_bytes) fail(`game/${rel} has a path over ${CAPS.game_path_max_bytes} bytes`);
    if (!e.dir) bytes += e.size;
  }
  if (bytes > CAPS.game_max_bytes) fail(`game/ holds ${bytes} bytes, over the ${CAPS.game_max_bytes} cap`);
  return { files: entries.filter((e) => !e.dir).length, dirs: entries.filter((e) => e.dir).length, bytes };
}

function checkScreenshots() {
  const dir = join(HERE, 'screenshots');
  if (!existsSync(dir)) fail('screenshots/ is missing beside main.ts');
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  if (files.length < MIN_SHOTS) fail(`screenshots/ holds ${files.length} images, need ${MIN_SHOTS}`);
  if (files.length > CAPS.screenshots.max) fail(`screenshots/ holds ${files.length} images, over the ${CAPS.screenshots.max} cap`);
  let bytes = 0;
  for (const name of files) {
    if (!SHOT_EXT.test(name)) fail(`screenshots/${name} is not a .jpg or .png`);
    const full = join(dir, name);
    const size = statSync(full).size;
    if (size > CAPS.screenshots.max_bytes) fail(`screenshots/${name} is ${size} bytes, over the ${CAPS.screenshots.max_bytes} cap`);
    const kind = imageKind(readFileSync(full).subarray(0, 8));
    if (!kind) fail(`screenshots/${name} is not a JPEG or PNG (its first bytes say neither)`);
    bytes += size;
  }
  return { count: files.length, bytes, files };
}

function copyTree(from: string, to: string) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

function bytesOf(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) total += bytesOf(full);
    else if (e.isFile()) total += statSync(full).size;
  }
  return total;
}

function countFiles(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) n += countFiles(full);
    else if (e.isFile()) n += 1;
  }
  return n;
}

function main() {
  const game = checkGame();
  const shots = checkScreenshots();

  // start from a clean output so a stale run can never leak into a dossier
  mkdirSync(OUT, { recursive: true });
  rmSync(join(OUT, 'game'), { recursive: true, force: true });
  rmSync(join(OUT, 'screenshots'), { recursive: true, force: true });

  copyTree(join(HERE, 'game'), join(OUT, 'game'));
  copyTree(join(HERE, 'screenshots'), join(OUT, 'screenshots'));

  const dossier = buildDossier(OUT, CAPS);
  writeFileSync(join(OUT, 'dossier.json'), dossier);

  const sha = createHash('sha256').update(dossier).digest('hex');
  const outGameBytes = bytesOf(join(OUT, 'game'));
  const outShotBytes = bytesOf(join(OUT, 'screenshots'));

  process.stdout.write(
    [
      'Cobalt Bay · gta6-01 entry',
      `  game/        ${countFiles(join(OUT, 'game'))} files, ${outGameBytes} bytes` +
        ` (${game.files} source+asset files, ${game.dirs} dirs in the repository copy)`,
      `  screenshots/ ${shots.count} files, ${outShotBytes} bytes: ${shots.files.join(', ')}`,
      `  dossier.json ${dossier.length} bytes, sha256 ${sha}`,
      `  output       ${OUT}`,
      '',
    ].join('\n'),
  );
}

main();
