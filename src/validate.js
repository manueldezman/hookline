import { malformed, invalidField } from './errors.js';
import { parseTimestamp } from './time.js';

export function bodyObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw malformed('The request body must be a JSON object.');
  }
  return body;
}

export function requireString(body, field) {
  const value = body[field];
  if (value === undefined || value === null) {
    throw malformed(`${field} is required.`);
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidField(`${field} must be a non-empty string.`);
  }
  return value;
}

export function optionalString(body, field) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalidField(`${field} must be a string.`);
  return value;
}

export function requireObject(body, field) {
  const value = body[field];
  if (value === undefined || value === null) {
    throw malformed(`${field} is required.`);
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidField(`${field} must be an object.`);
  }
  return value;
}

export function requireStringArray(body, field) {
  const value = body[field];
  if (value === undefined || value === null) {
    throw malformed(`${field} is required.`);
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalidField(`${field} must be an array of strings.`);
  }
  return value;
}

export function optionalBoolean(body, field) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw invalidField(`${field} must be a boolean.`);
  return value;
}

export function requireTimestamp(body, field) {
  const value = requireString(body, field);
  const ms = parseTimestamp(value);
  if (ms === null) throw invalidField(`${field} must be an ISO 8601 timestamp.`);
  return ms;
}

export function optionalTimestamp(body, field) {
  if (body[field] === undefined) return null;
  return requireTimestamp(body, field);
}

export function optionalEnum(body, field, allowed) {
  if (body[field] === undefined) return null;
  if (typeof body[field] !== 'string' || !allowed.includes(body[field])) {
    throw invalidField(`${field} must be one of ${allowed.join(', ')}.`);
  }
  return body[field];
}

export function queryTimestamp(query, field) {
  const value = query[field];
  if (value === undefined) return null;
  const ms = parseTimestamp(value);
  if (ms === null) throw invalidField(`${field} must be an ISO 8601 timestamp.`);
  return ms;
}
