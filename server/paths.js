// Where generated files go: the TLS certificate and the downloaded models and
// Quran text. Defaults to the project folder; the Home Assistant add-on sets
// DATA_DIR=/data, the only place that survives a restart there.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : fileURLToPath(new URL('..', import.meta.url));

export const dataPath = (...parts) => path.join(DATA_DIR, ...parts);
