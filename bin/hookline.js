#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const API_URL = (process.env.HOOKLINE_API_URL ?? 'http://127.0.0.1:4242/v2').replace(/\/$/, '');
const INTERNAL_URL = (
  process.env.HOOKLINE_INTERNAL_URL ?? API_URL.replace(/\/v2$/, '')
).replace(/\/$/, '');
const KEY = process.env.HOOKLINE_API_KEY ?? '';
const SLEEP_MS = 1000;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(
    [
      'hookline <command>',
      '',
      'Commands',
      '  whoami                                   Show the account, key, and mode',
      "  events send <type> --payload '<json>'    Send an event",
      '  listen [--forward-to <url>]              Print test events as they arrive',
      '  login                                    Not available without the dashboard',
      '  --version                                Print the CLI version',
      '',
      'Environment',
      '  HOOKLINE_API_KEY    Required. A hl_test_ or hl_live_ key.',
      '  HOOKLINE_API_URL    Default http://127.0.0.1:4242/v2',
      '',
    ].join('\n'),
  );
}

function modeFor(key) {
  if (key.startsWith('hl_test_')) return 'test';
  if (key.startsWith('hl_live_')) return 'live';
  return 'unknown';
}

async function request(base, path, { method = 'GET', body } = {}) {
  if (!KEY) fail('Set HOOKLINE_API_KEY first.');
  const headers = { authorization: `Bearer ${KEY}` };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    fail(`Cannot reach ${base}. Is the server running? ${error.message}`);
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail = parsed?.error;
    fail(
      `${response.status} ${detail?.code ?? 'error'}  ${detail?.message ?? text ?? ''}`.trim(),
    );
  }
  return parsed;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) fail(`${flag} needs a value.`);
  return value;
}

function parsePayload(raw) {
  if (raw === undefined) fail('--payload is required.');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail('--payload must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('--payload must be a JSON object.');
  }
  return value;
}

async function whoami() {
  const account = await request(API_URL, '/account');
  process.stdout.write(`Account  ${account.id}\n`);
  process.stdout.write(`Key      ${KEY}\n`);
  process.stdout.write(`Mode     ${modeFor(KEY)}\n`);
}

async function sendEvent(args) {
  const type = args[0];
  if (!type) fail('Usage: hookline events send <type> --payload \'<json>\'');

  const payload = parsePayload(valueAfter(args, '--payload'));
  const idempotencyKey = valueAfter(args, '--idempotency-key');
  const body = { type, payload };
  if (idempotencyKey !== undefined) body.idempotency_key = idempotencyKey;

  const event = await request(API_URL, '/events', { method: 'POST', body });
  process.stdout.write(`Sent ${event.id} (${event.status})\n`);
}

function printEvent(event) {
  process.stdout.write(`\n${event.type}  ${event.id}  queued\n`);
  process.stdout.write(`${JSON.stringify(event.data, null, 2)}\n`);
}

async function forward(to, event) {
  try {
    const response = await fetch(to, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    process.stdout.write(`Forwarded to ${to} (${response.status})\n`);
  } catch (error) {
    process.stderr.write(`Forward to ${to} failed. ${error.message}\n`);
  }
}

async function listen(args) {
  const forwardTo = valueAfter(args, '--forward-to');
  let cursor = 0;
  let running = true;

  const stop = () => {
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  process.stdout.write('Listening for test events on this machine...\n');

  while (running) {
    const page = await request(
      INTERNAL_URL,
      `/internal/test-events?after=${cursor}`,
    );
    for (const item of page.data) {
      cursor = item.seq;
      printEvent(item.event);
      if (forwardTo) await forward(forwardTo, item.event);
    }
    if (!running) break;
    await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    usage();
    return;
  }
  if (args[0] === '--version' || args[0] === '-v') {
    process.stdout.write(`hookline/${pkg.version}\n`);
    return;
  }
  if (args[0] === 'whoami') {
    await whoami();
    return;
  }
  if (args[0] === 'events' && args[1] === 'send') {
    await sendEvent(args.slice(2));
    return;
  }
  if (args[0] === 'listen') {
    await listen(args.slice(1));
    return;
  }
  if (args[0] === 'login') {
    fail('The login flow needs the Hookline dashboard. Set HOOKLINE_API_KEY instead.');
  }
  usage();
  process.exit(1);
}

await main();
