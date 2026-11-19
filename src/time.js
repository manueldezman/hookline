export function isoSeconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseTimestamp(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
