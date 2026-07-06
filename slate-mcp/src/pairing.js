// Pairing/token storage for the slate-mcp bridge (PRD §8.3).
// The paired token lives in ~/.slate-mcp/config.json (or a custom path for tests).

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function defaultConfigPath() {
  return join(homedir(), '.slate-mcp', 'config.json');
}

export function loadToken(configPath) {
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    return typeof cfg.token === 'string' && cfg.token.length >= 32 ? cfg.token : null;
  } catch {
    return null;
  }
}

export function saveToken(configPath, token) {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ token }, null, 2), { mode: 0o600 });
}

/** 256-bit random token, hex-encoded. */
export function newToken() {
  return randomBytes(32).toString('hex');
}

/** 4-digit pairing code, zero-padded. */
export function newPairingCode() {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

/** Constant-time string comparison. */
export function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
