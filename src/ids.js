import { randomBytes, createHash } from 'node:crypto';

export function randomHex(bytes) {
  return randomBytes(bytes).toString('hex');
}

export function newId(prefix) {
  return `${prefix}_${randomHex(6)}`;
}

export function newSecret() {
  return `whsec_${randomHex(16)}`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
