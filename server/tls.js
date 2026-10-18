// Browsers only allow the microphone on https:// pages (or localhost), so other
// devices on the network need TLS. We make a self-signed certificate on first
// run; drop your own cert.pem/key.pem (e.g. from mkcert) into certs/ to use
// those instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dataPath } from './paths.js';

const CERT_DIR = dataPath('certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

/** @returns {{ cert: Buffer, key: Buffer } | null} null if no certificate could be made */
export function loadOrCreateCert() {
  try {
    if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) createSelfSigned();
    return { cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) };
  } catch (err) {
    console.warn(`HTTPS disabled (${err.message}). Other devices won't be able to use the microphone.`);
    return null;
  }
}

/** Non-loopback IPv4 addresses of this machine. */
export function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

function createSelfSigned() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const names = ['DNS:localhost', `DNS:${os.hostname()}`, 'IP:127.0.0.1', ...lanAddresses().map((ip) => `IP:${ip}`)];
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
      '-subj', '/CN=quran-whisperer',
      '-addext', `subjectAltName=${names.join(',')}`,
      '-keyout', KEY_FILE, '-out', CERT_FILE,
    ],
    { stdio: 'ignore' },
  );
  console.log(`Created a self-signed certificate in ${CERT_DIR} (delete it to regenerate)`);
}
