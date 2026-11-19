import dns from 'node:dns/promises';
import net from 'node:net';
import { ApiError } from '../errors.js';

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address) {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) {
    return true;
  }
  if (value.startsWith('::ffff:')) {
    return isPrivateIpv4(value.slice('::ffff:'.length));
  }
  return false;
}

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) return isPrivateIpv4(address);
  if (net.isIPv6(address)) return isPrivateIpv6(address);
  return true;
}

export async function verifyEndpointUrl(rawUrl, { allowPrivate = false, timeoutMs = 5000 } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ApiError(422, 'validation_failed', 'url must be a valid URL.');
  }

  if (!allowPrivate && url.protocol !== 'https:') {
    throw new ApiError(422, 'endpoint_unreachable', 'The URL must use HTTPS.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ApiError(422, 'endpoint_unreachable', 'The URL must use HTTP or HTTPS.');
  }

  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError(422, 'endpoint_unreachable', 'The hostname did not resolve.');
  }

  if (!allowPrivate && addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new ApiError(422, 'endpoint_unreachable', 'The URL must resolve to a public address.');
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(422, 'endpoint_unreachable', 'The URL did not answer a HEAD request.');
  }

  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(
      422,
      'endpoint_unreachable',
      `The URL returned ${response.status} to a HEAD request.`,
    );
  }
}
