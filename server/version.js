// Which version this is: package.json's, and the git commit when there is one
// (not in the Home Assistant add-on, which has no .git). The server sends it as
// /version.json, and app/build.mjs writes it into the app, for the bottom of the settings.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** @returns {{ version: string, commit: string | null }} */
export function versionInfo() {
  const { version } = JSON.parse(fs.readFileSync(`${root}package.json`, 'utf8'));
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {}
  return { version, commit };
}
