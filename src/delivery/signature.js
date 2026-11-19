import { createHmac, timingSafeEqual } from 'node:crypto';

export function signBody(secret, timestampSeconds, rawBody) {
  return createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
}

export function signatureHeader(secrets, timestampSeconds, rawBody) {
  const values = secrets.map(
    (secret) => `v1=${signBody(secret, timestampSeconds, rawBody)}`,
  );
  return [`t=${timestampSeconds}`, ...values].join(',');
}

export function verifySignatureHeader(header, rawBody, secrets, nowSeconds, toleranceSeconds = 300) {
  const parts = String(header).split(',').map((part) => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) >= toleranceSeconds) return false;
  return secrets.some((secret) => {
    const expected = Buffer.from(signBody(secret, timestamp, rawBody));
    return signatures.some((signature) => {
      const actual = Buffer.from(signature);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    });
  });
}
