import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  signBody,
  signatureHeader,
  verifySignatureHeader,
} from '../src/delivery/signature.js';

const SECRET = 'whsec_9f2c';
const BODY = '{"id":"evt_8f2a91","type":"invoice.paid"}';
const NOW = 1_700_000_000;

test('the signature is HMAC-SHA256 over the timestamp, a period, and the body', () => {
  const expected = createHmac('sha256', SECRET)
    .update(`${NOW}.${BODY}`)
    .digest('hex');
  assert.equal(signBody(SECRET, NOW, BODY), expected);
});

test('the header carries one v1 value per secret', () => {
  const header = signatureHeader([SECRET, 'whsec_next'], NOW, BODY);
  const parts = header.split(',');
  assert.equal(parts[0], `t=${NOW}`);
  assert.match(parts[1], /^v1=[0-9a-f]{64}$/);
  assert.match(parts[2], /^v1=[0-9a-f]{64}$/);
  assert.notEqual(parts[1], parts[2]);
});

test('either secret verifies during a rotation', () => {
  const header = signatureHeader([SECRET, 'whsec_next'], NOW, BODY);
  assert.equal(verifySignatureHeader(header, BODY, [SECRET], NOW), true);
  assert.equal(verifySignatureHeader(header, BODY, ['whsec_next'], NOW), true);
  assert.equal(verifySignatureHeader(header, BODY, ['whsec_other'], NOW), false);
});

test('a stale timestamp fails the check', () => {
  const header = signatureHeader([SECRET], NOW, BODY);
  assert.equal(verifySignatureHeader(header, BODY, [SECRET], NOW + 600), false);
});

test('a changed body fails the check', () => {
  const header = signatureHeader([SECRET], NOW, BODY);
  assert.equal(verifySignatureHeader(header, `${BODY} `, [SECRET], NOW), false);
});
