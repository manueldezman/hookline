import { ApiError } from '../errors.js';

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

function classify(error) {
  const code = error?.cause?.code ?? error?.code;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_error';
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'timeout';
  if (TLS_CODES.has(code) || String(code ?? '').startsWith('CERT_')) return 'tls_error';
  return 'connection_refused';
}

export async function httpSender({ url, body, headers, timeoutMs }) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.arrayBuffer().catch(() => {});
    return { status: response.status, error: null };
  } catch (error) {
    return { status: null, error: classify(error) };
  }
}

export { classify as classifyDeliveryError };
