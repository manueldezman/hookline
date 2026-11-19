import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyEndpointUrl, isPrivateAddress } from '../src/http/verifier.js';

test('private address detection covers the usual ranges', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.4.2', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '203.0.113.10', '2001:4860:4860::8888']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test('an invalid URL is rejected before any network call', async () => {
  await assert.rejects(
    () => verifyEndpointUrl('not a url'),
    (error) => error.code === 'validation_failed',
  );
});

test('http is rejected when private URLs are not allowed', async () => {
  await assert.rejects(
    () => verifyEndpointUrl('http://example.com/webhooks'),
    (error) => error.code === 'endpoint_unreachable' && /HTTPS/.test(error.message),
  );
});

test('a loopback address is rejected when private URLs are not allowed', async () => {
  await assert.rejects(
    () => verifyEndpointUrl('https://127.0.0.1/webhooks'),
    (error) => error.code === 'endpoint_unreachable' && /public/.test(error.message),
  );
});
