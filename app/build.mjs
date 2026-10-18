// Builds the phone app's web content into app/www/: the page from public/, with
// js/api.js and js/speech.js swapped for app/src/'s, so it needs no server and
// reads aloud with Android's voices.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

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
console.log(`Built ${out}`);
