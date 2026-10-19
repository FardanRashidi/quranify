// Builds the phone app's web content into app/www/: the page from public/, with
// js/api.js and js/speech.js swapped for app/src/'s, so it needs no server and
// reads aloud with Android's voices, and the Quran text in quran/, so it works
// offline from the start.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { BUNDLED_EDITIONS } from '../lib/quran.js';
import { loadEdition } from '../server/quran.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('www/', import.meta.url));

await fs.rm(out, { recursive: true, force: true });
await fs.cp(`${root}public/`, out, { recursive: true });
await esbuild.build({
  absWorkingDir: root,
  entryPoints: { 'js/api': 'app/src/api.js', 'js/speech': 'app/src/speech.js' },
  outdir: out,
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'chrome110',
  logLevel: 'warning',
});
// From the server's cache in .cache/quran/, downloaded into it the first time
await fs.mkdir(`${out}quran`);
for (const id of BUNDLED_EDITIONS) await fs.writeFile(`${out}quran/${id}.json`, JSON.stringify(await loadEdition(id)));
console.log(`Built ${out}`);
