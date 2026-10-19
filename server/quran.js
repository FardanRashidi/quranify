// The Quran search (lib/quran.js) with its text cached on disk in .cache/quran/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createQuran, downloadEdition } from '../lib/quran.js';
import { dataPath } from './paths.js';

const CACHE_DIR = dataPath('.cache', 'quran');

/** One edition, from the cache or else downloaded into it (app/build.mjs uses this too). */
export async function loadEdition(id) {
  const file = path.join(CACHE_DIR, `${id}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {}

  const surahs = await downloadEdition(id);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(surahs));
  return surahs;
}

export const { locate, getSurah, listSurahs, warmUp } = createQuran(loadEdition);
