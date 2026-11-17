// Hand-in program for the gta6-01 bounty: stage the entry, emit the dossier, report what shipped.
//
// The game in game/ is a folder of static files that a desktop browser opens offline, so handing it
// in is mostly a copy. The real work is refusal: every gate cap is checked before the dossier is
// built and the failure says which rule was broken, because the alternative is an opaque rejection
// at grading time.
//
// Runs as-is — `node main.ts`, no compile step, no install. Node's standard library plus the
// vendored ./vendor/makefun-game.ts, nothing else.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts     # stage into ./out instead of /output

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// ---------------------------------------------------------------- the bounty's limits

// Mirrors the gate: identical caps mean the program refuses exactly what the scorer would, in its
// own words. Only text_max_bytes reshapes the dossier's bytes — the rest can only refuse — so
// passing all of them is what makes a local run trustworthy.
const GATE = {
  text_max_bytes: 163_840, // 160 KiB of source text carried in the dossier
  screenshots: { max: 4, max_bytes: 262_144 }, // four renders at most, 256 KiB each
  game_max_files: 993, // game/ entries; /output as a whole is capped at 1000
  game_max_bytes: 50_331_648, // 48 MiB of files under game/
  game_path_max_bytes: 1000, // one path under game/, in UTF-8 bytes
} as const;

const SHOT_LIMIT_COUNT: number = GATE.screenshots.max;
const SHOT_LIMIT_BYTES: number = GATE.screenshots.max_bytes;

// ---------------------------------------------------------------- checks and small tools

/** Stop the run unless `condition` holds. The message names the broken rule, never a stack trace. */
function require_(condition: boolean, failure: string): void {
  if (condition) return;
  throw new Error(`entry refused: ${failure}`);
}

interface Measure {
  files: number;
  bytes: number;
}

/**
 * Every regular file below `root`, recursively, with the sum of their sizes. Subdirectories are
 * walked but not counted: this feeds the printed summary, while the file-and-directory cap belongs
 * to buildDossier, which counts entries the way the platform does.
 */
function measure(root: string): Measure {
  const total: Measure = { files: 0, bytes: 0 };
  const walk = (rel: string): void => {
    for (const entry of readdirSync(rel === '' ? root : join(root, rel), { withFileTypes: true })) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile()) {
        total.files += 1;
        total.bytes += statSync(join(root, child)).size;
      }
    }
  };
  walk('');
  return total;
}

type ImageKind = 'png' | 'jpeg';

/**
 * What a file's leading bytes prove it is, independent of its name. A render's extension is a hint,
 * and a mis-named file would eventually be refused with a message about neither PNG nor JPEG —
 * pointing at the wrong thing. Checking the magic bytes here points at the file itself.
 */
function imageKindOf(head: Buffer): ImageKind | null {
  const opensWith = (magic: readonly number[]): boolean =>
    head.length >= magic.length && magic.every((byte, at) => head[at] === byte);
  if (opensWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'; // \x89PNG\r\n\x1a\n
  if (opensWith([0xff, 0xd8, 0xff])) return 'jpeg'; // SOI + the first marker's leading byte
  return null;
}

interface Render {
  name: string;
  bytes: number;
}

/**
 * The renders to hand in: the visible files of the source screenshots/ folder, in name order, so
 * the first name is the cover. Each one is held to the count, size, extension and magic-byte rules
 * here rather than left for the dossier builder to discover.
 */
function collectRenders(dir: string): Render[] {
  require_(existsSync(dir) && statSync(dir).isDirectory(), `no screenshots/ folder at ${dir}`);

  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  require_(names.length > 0, 'screenshots/ holds nothing: at least one render is required, the first name the cover');
  require_(
    names.length <= SHOT_LIMIT_COUNT,
    `screenshots/ holds ${names.length} files, over the ${SHOT_LIMIT_COUNT} this bounty accepts`,
  );

  return names.map((name) => {
    const file = join(dir, name);
    const size = statSync(file).size;

    require_(size > 0, `screenshots/${name} is an empty file`);
    require_(size <= SHOT_LIMIT_BYTES, `screenshots/${name} weighs ${size} bytes, over the ${SHOT_LIMIT_BYTES} allowed`);

    const actual = imageKindOf(readFileSync(file));
    require_(actual !== null, `screenshots/${name} is neither PNG nor JPEG: its first bytes match neither magic`);

    const dot = name.lastIndexOf('.');
    const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
    const claimed: ImageKind | null = ext === 'png' ? 'png' : ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : null;

    require_(claimed !== null, `screenshots/${name}: renders are named .png or .jpg, not ".${ext}"`);
    require_(
      claimed === actual,
      `screenshots/${name} claims ".${ext}" but its bytes are ${actual.toUpperCase()} — renamed file?`,
    );

    return { name, bytes: size };
  });
}

// ---------------------------------------------------------------- what to stage, from where

const projectDir = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameSrc = join(projectDir, 'game');
const shotsSrc = join(projectDir, 'screenshots');

// game/index.html is the one file a game cannot be without. Grep for it before any copying, so a
// missing page never leaves a half-staged output directory behind.
const pageSrc = join(gameSrc, 'index.html');
require_(existsSync(pageSrc), `game/index.html is missing from ${gameSrc} — that page is the game`);
require_(statSync(pageSrc).isFile(), 'game/index.html is not a regular file');

const renders = collectRenders(shotsSrc);

// ---------------------------------------------------------------- staging

try {
  mkdirSync(outputDir, { recursive: true });
} catch (err) {
  // Outside the grader there is no writable /output; say what to do instead of dumping errno.
  throw new Error(
    `cannot create the output directory ${outputDir} (${(err as Error).message}); ` +
      'set MAKEFUN_OUTPUT_DIR to a writable path, e.g. MAKEFUN_OUTPUT_DIR=out node main.ts',
  );
}

// Each staged folder is cleared first: leftovers from an earlier run would be counted by the
// dossier and could push the entry past a cap for files that are no longer part of it.
for (const folder of ['game', 'screenshots']) rmSync(join(outputDir, folder), { recursive: true, force: true });

cpSync(gameSrc, join(outputDir, 'game'), { recursive: true });

const shotsOut = join(outputDir, 'screenshots');
mkdirSync(shotsOut, { recursive: true });
for (const render of renders) cpSync(join(shotsSrc, render.name), join(shotsOut, render.name));

// The page must be where the dossier will look for it, not merely present in the source tree.
require_(existsSync(join(outputDir, 'game', 'index.html')), 'game/index.html did not survive the copy into the output');

// ---------------------------------------------------------------- the dossier

const dossier = buildDossier(outputDir, GATE);
writeFileSync(join(outputDir, 'dossier.json'), dossier);

// ---------------------------------------------------------------- the summary

const stagedGame = measure(join(outputDir, 'game'));
const stagedShots = measure(shotsOut);
const column = (label: string): string => label.padEnd(16, ' ');
const row = (label: string, m: Measure): string =>
  `${column(label)}${String(m.files).padStart(3)} file${m.files === 1 ? '' : 's'}, ${m.bytes} bytes`;

console.log(`staged      ${outputDir}`);
console.log(row('game/', stagedGame));
console.log(row('screenshots/', stagedShots));
console.log(`${column('dossier.json')}     ${dossier.length} bytes`);
console.log(`cover       screenshots/${renders[0]!.name}`);
