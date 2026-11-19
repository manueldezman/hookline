import { invalidField } from './errors.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalidField(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  return limit;
}

export function encodeCursor(seq) {
  return Buffer.from(JSON.stringify({ s: seq }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Number.isInteger(parsed.s) || parsed.s < 0) throw new Error('bad cursor');
    return parsed.s;
  } catch {
    throw invalidField('starting_after is not a valid cursor.');
  }
}

export function cursorFromQuery(query) {
  const value = query.starting_after;
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidField('starting_after is not a valid cursor.');
  }
  return decodeCursor(value);
}

export function buildPage(rows, limit, mapRow) {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    data: pageRows.map(mapRow),
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last.seq) : null,
  };
}
