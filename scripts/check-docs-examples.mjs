#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DOCS_REPO = path.resolve(process.env.DOCS_REPO ?? path.join(ROOT, '..', 'hookline'));
const TEST_KEY = 'hl_test_examples';
const LIVE_KEY = 'hl_live_examples';
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function pass(message) {
  console.log(`ok   ${message}`);
}

async function writeSummary(fatal) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;

  const lines = ['## Docs examples', ''];
  if (fatal) lines.push(`Fatal error. ${fatal}`);

  if (failures.length === 0 && !fatal) {
    lines.push('All docs examples match the product.');
  } else if (failures.length > 0) {
    lines.push(`${failures.length} failure(s).`);
    lines.push('');
    for (const failure of failures) {
      lines.push(`- ${failure.replace(/\n/g, ' ')}`);
    }
  }

  await writeFile(file, `${lines.join('\n')}\n`);
}

function run(command, args, { env = {}, cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function start(command, args, { env = {}, cwd = ROOT } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  return {
    child,
    output: () => stdout,
    errors: () => stderr,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once('close', resolve);
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }, 2000).unref();
      }),
  };
}

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function extractCurlBlocks(markdown) {
  const blocks = [];
  const pattern = /```bash\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    const code = match[1].trim();
    if (/^curl\b/m.test(code)) blocks.push(code);
  }
  return blocks;
}

function responseInfo(markdown) {
  const responses = markdown.split('## Responses')[1];
  if (!responses) return null;

  const statusMatch = responses.match(/<TabItem value="(\d{3})"/);
  const tab = responses.split('<TabItem')[1]?.split('</TabItem>')[0] ?? '';
  const required = new Set();
  const allowed = new Set();

  for (const line of tab.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const field = cells[1].replace(/`/g, '');
    if (!field || field === 'Field' || field.startsWith('---')) continue;
    const top = field.split(/[.[]/)[0];
    if (!top) continue;
    allowed.add(top);
    if (cells[3] === 'Yes') required.add(top);
  }

  return {
    status: statusMatch ? Number(statusMatch[1]) : null,
    required,
    allowed,
  };
}

function quickstartInfo(markdown) {
  const statusMatch = markdown.match(/HTTP\/\S+\s+(\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  const output = markdown.match(/```text[^\n]*\n([\s\S]*?)```/);
  if (!output) return { status, required: new Set(), allowed: new Set() };

  const start = output[1].indexOf('{');
  const end = output[1].lastIndexOf('}');
  if (start === -1 || end === -1) return { status, required: new Set(), allowed: new Set() };

  const keys = new Set(Object.keys(JSON.parse(output[1].slice(start, end + 1))));
  return { status, required: keys, allowed: keys };
}

function rewrite(block, replacements) {
  return Object.entries(replacements).reduce(
    (text, [from, to]) => text.replaceAll(from, to),
    block,
  );
}

async function checkCurlBlock({ file, block, info, replacements, apiKey }) {
  const label = path.relative(DOCS_REPO, file);
  if (!info) {
    fail(`${label} has no response section`);
    return;
  }

  const command = `${rewrite(block, replacements)} -s -w '\\n__STATUS__%{http_code}'`;
  const result = await run('bash', ['-c', command], { env: { HOOKLINE_API_KEY: apiKey } });

  if (result.code !== 0) {
    fail(`${label} curl exited ${result.code}\n${result.stderr.trim()}`);
    return;
  }

  const marker = '__STATUS__';
  const index = result.stdout.lastIndexOf(marker);
  if (index === -1) {
    fail(`${label} did not report an HTTP status`);
    return;
  }

  const status = Number(result.stdout.slice(index + marker.length).trim());
  const body = result.stdout.slice(0, index).trim();

  if (info.status !== null && status !== info.status) {
    fail(`${label} expected ${info.status}, got ${status}\n${body}`);
    return;
  }

  if (body) {
    let value;
    try {
      value = JSON.parse(body);
    } catch {
      fail(`${label} response is not JSON\n${body}`);
      return;
    }

    const keys = new Set(Object.keys(value));
    for (const key of info.required) {
      if (!keys.has(key)) fail(`${label} missing required field ${key}`);
    }
    for (const key of keys) {
      if (!info.allowed.has(key)) fail(`${label} has undocumented field ${key}`);
    }
  }

  pass(`${label} ${status}`);
}

async function api(baseUrl, method, pathname, { key, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, text };
}

async function sendTestEvent(baseUrl) {
  const response = await api(baseUrl, 'POST', '/v2/events', {
    key: TEST_KEY,
    body: {
      type: 'invoice.paid',
      payload: { invoiceId: 'inv_cli', amount: 4900, currency: 'USD' },
    },
  });
  if (response.status !== 202) {
    throw new Error(`test event failed with ${response.status}`);
  }
  return response.body;
}

async function checkCli({ baseUrl, receiverUrl, receiver }) {
  const cli = path.join(ROOT, 'bin', 'hookline.js');
  const env = {
    HOOKLINE_API_URL: `${baseUrl}/v2`,
    HOOKLINE_INTERNAL_URL: baseUrl,
    HOOKLINE_API_KEY: TEST_KEY,
  };
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));

  const version = await run(process.execPath, [cli, '--version'], { env });
  if (version.code !== 0) {
    fail(`cli --version exited ${version.code}\n${version.stderr.trim()}`);
  } else if (version.stdout.trim() !== `hookline/${pkg.version}`) {
    fail(`cli --version expected hookline/${pkg.version}, got ${version.stdout.trim()}`);
  } else {
    pass('cli --version');
  }

  const whoami = await run(process.execPath, [cli, 'whoami'], { env });
  const whoamiOk =
    /^Account\s+\S+/m.test(whoami.stdout) &&
    /^Key\s+\S+/m.test(whoami.stdout) &&
    /^Mode\s+test/m.test(whoami.stdout);
  if (whoami.code !== 0) {
    fail(`cli whoami exited ${whoami.code}\n${whoami.stderr.trim()}`);
  } else if (!whoamiOk) {
    fail(`cli whoami output did not match\n${whoami.stdout.trim()}`);
  } else {
    pass('cli whoami');
  }

  const send = await run(
    process.execPath,
    [
      cli,
      'events',
      'send',
      'invoice.paid',
      '--payload',
      '{"invoiceId":"inv_1042","amount":4900,"currency":"USD"}',
    ],
    { env },
  );
  if (send.code !== 0) {
    fail(`cli events send exited ${send.code}\n${send.stderr.trim()}`);
  } else if (!/^Sent evt_[a-z0-9]+ \(queued\)$/m.test(send.stdout)) {
    fail(`cli events send output did not match\n${send.stdout.trim()}`);
  } else {
    pass('cli events send');
  }

  const listen = start(process.execPath, [cli, 'listen'], { env });
  try {
    if (!(await waitFor(() => /Listening for test events/.test(listen.output())))) {
      fail('cli listen did not start');
    } else {
      const event = await sendTestEvent(baseUrl);
      if (!(await waitFor(() => listen.output().includes(event.id)))) {
        fail(`cli listen did not print ${event.id}\n${listen.output()}`);
      } else {
        pass('cli listen');
      }
    }
  } finally {
    await listen.stop();
  }

  receiver.requests.length = 0;
  const forward = start(process.execPath, [cli, 'listen', '--forward-to', receiverUrl], {
    env,
  });
  try {
    if (!(await waitFor(() => /Listening for test events/.test(forward.output())))) {
      fail('cli listen --forward-to did not start');
    } else {
      const event = await sendTestEvent(baseUrl);
      const forwarded = await waitFor(() =>
        receiver.requests.some((item) => item.body.includes(event.id)),
      );
      if (!forwarded) {
        fail(`cli listen --forward-to did not forward ${event.id}\n${forward.output()}`);
      } else {
        pass('cli listen --forward-to');
      }
    }
  } finally {
    await forward.stop();
  }
}

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'hookline-examples-'));
  const receiver = createServer((request, response) => {
    if (request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        receiver.requests.push({ url: request.url, body });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      });
      return;
    }

    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
  });
  receiver.requests = [];
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const receiverUrl = `http://127.0.0.1:${receiver.address().port}/webhooks`;

  const config = loadConfig({
    HOOKLINE_DATA_DIR: dataDir,
    HOOKLINE_TEST_KEY: TEST_KEY,
    HOOKLINE_LIVE_KEY: LIVE_KEY,
    HOOKLINE_ALLOW_PRIVATE_URLS: '1',
    HOOKLINE_PLAN: 'business',
  });
  const app = createApp({ config, startWorker: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const endpoint = await api(baseUrl, 'POST', '/v2/endpoints', {
      key: LIVE_KEY,
      body: { url: receiverUrl, event_types: ['invoice.paid', 'invoice.failed'] },
    });
    if (endpoint.status !== 201) {
      throw new Error(`fixture endpoint failed with ${endpoint.status}`);
    }

    const event = await api(baseUrl, 'POST', '/v2/events', {
      key: LIVE_KEY,
      body: {
        type: 'invoice.paid',
        payload: { invoiceId: 'inv_1042', amount: 4900, currency: 'USD' },
      },
    });
    if (event.status !== 202) {
      throw new Error(`fixture event failed with ${event.status}`);
    }

    const deliveries = await api(baseUrl, 'GET', '/v2/deliveries?limit=20', {
      key: LIVE_KEY,
    });
    const delivery = deliveries.body?.data?.[0];
    if (!delivery) throw new Error('fixture delivery was not created');

    const replacements = {
      'https://api.hookline.example': baseUrl,
      'https://example.com/webhooks': receiverUrl,
      'evt_8f2a91': event.body.id,
      'ep_2201': endpoint.body.id,
      'dlv_44c1': delivery.id,
      hl_test_replace_me: TEST_KEY,
    };

    const files = (await walk(path.join(DOCS_REPO, 'docs')))
      .filter(
        (file) =>
          file.includes(`${path.sep}api${path.sep}`) ||
          file.endsWith(`${path.sep}getting-started${path.sep}quick-start.md`),
      )
      .sort((a, b) => {
        const aDelete = a.endsWith(`${path.sep}endpoints${path.sep}delete.md`);
        const bDelete = b.endsWith(`${path.sep}endpoints${path.sep}delete.md`);
        if (aDelete !== bDelete) return aDelete ? 1 : -1;
        return a.localeCompare(b);
      });

    for (const file of files) {
      const markdown = await readFile(file, 'utf8');
      const blocks = extractCurlBlocks(markdown);
      if (blocks.length === 0) continue;

      const isQuickstart = file.endsWith(`${path.sep}getting-started${path.sep}quick-start.md`);
      const info = isQuickstart ? quickstartInfo(markdown) : responseInfo(markdown);
      const apiKey = isQuickstart ? TEST_KEY : LIVE_KEY;

      for (const block of blocks) {
        await checkCurlBlock({ file, block, info, replacements, apiKey });
      }
    }

    await checkCli({ baseUrl, receiverUrl, receiver });
    await writeSummary();

    if (failures.length > 0) {
      console.error(`\n${failures.length} failure(s)`);
      process.exitCode = 1;
    } else {
      console.log('\nAll docs examples match the product.');
    }
  } finally {
    await app.close();
    await new Promise((resolve) => receiver.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`FAIL ${error.message}`);
  await writeSummary(error.message);
  process.exitCode = 1;
}
