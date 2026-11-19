const CATALOG = {
  'invoice.paid': {
    invoiceId: 'string',
    amount: 'integer',
    currency: 'string',
  },
  'invoice.failed': {
    invoiceId: 'string',
    reason: 'string',
    attempt: 'integer',
  },
  'invoice.voided': {
    invoiceId: 'string',
    voidedBy: 'string',
  },
  'payout.sent': {
    payoutId: 'string',
    amount: 'integer',
    bankAccountId: 'string',
  },
  'payout.returned': {
    payoutId: 'string',
    reason: 'string',
  },
  'customer.created': {
    customerId: 'string',
    email: 'string',
  },
  'customer.updated': {
    customerId: 'string',
    changedFields: 'string[]',
  },
  'endpoint.disabled': {
    endpointId: 'string',
    reason: 'string',
  },
};

const RESOURCES = new Set([
  'invoice',
  'payout',
  'customer',
  'endpoint',
]);

export function isKnownType(type) {
  return Object.hasOwn(CATALOG, type);
}

export function isKnownSubscription(pattern) {
  if (isKnownType(pattern)) return true;
  const match = /^([a-z]+)\.\*$/.exec(pattern);
  return Boolean(match && RESOURCES.has(match[1]));
}

export function matchesSubscription(patterns, type) {
  const prefix = type.split('.')[0];
  return patterns.some((pattern) => pattern === type || pattern === `${prefix}.*`);
}

export function validatePayload(type, payload) {
  const fields = CATALOG[type];
  if (!fields) return [];

  const problems = [];
  for (const [field, expected] of Object.entries(fields)) {
    if (!Object.hasOwn(payload, field)) continue;
    const value = payload[field];
    if (expected === 'string' && typeof value !== 'string') {
      problems.push(`payload.${field} must be a string.`);
    }
    if (expected === 'integer' && !Number.isInteger(value)) {
      problems.push(`payload.${field} must be an integer.`);
    }
    if (expected === 'string[]') {
      const ok = Array.isArray(value) && value.every((item) => typeof item === 'string');
      if (!ok) problems.push(`payload.${field} must be an array of strings.`);
    }
  }
  return problems;
}

export const EVENT_TYPES = Object.keys(CATALOG);
