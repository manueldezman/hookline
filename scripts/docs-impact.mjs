#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = value;
      i += 1;
    }
  }
  return args;
}

function readChangedFiles(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\.\//, ''))
    .filter(Boolean);
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      yield* walk(full);
    } else if (/\.mdx?$/.test(entry.name)) {
      yield full;
    }
  }
}

function readFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  return lines.slice(1, end);
}

function unquote(value) {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function readDependsOn(frontMatter) {
  const start = frontMatter.findIndex((line) => /^depends_on\s*:/.test(line));
  if (start === -1) return [];

  const rest = frontMatter[start].replace(/^depends_on\s*:/, '').trim();
  if (rest === '[]') return [];
  if (rest.startsWith('[')) {
    const inner = rest.slice(1, rest.lastIndexOf(']'));
    return inner
      .split(',')
      .map(unquote)
      .filter(Boolean);
  }

  const values = [];
  for (let i = start + 1; i < frontMatter.length; i += 1) {
    const match = frontMatter[i].match(/^\s*-\s+(.*)$/);
    if (!match) break;
    const value = unquote(match[1]);
    if (value) values.push(value);
  }
  return values;
}

function readTitle(frontMatter, fallback) {
  const line = frontMatter.find((entry) => /^title\s*:/.test(entry));
  if (!line) return fallback;
  return unquote(line.replace(/^title\s*:/, '')) || fallback;
}

function readPages(docsRoot) {
  const docsDir = path.join(docsRoot, 'docs');
  const pages = [];
  for (const file of walk(docsDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const frontMatter = readFrontMatter(text);
    if (!frontMatter) continue;

    const dependsOn = readDependsOn(frontMatter);
    if (dependsOn.length === 0) continue;

    pages.push({
      file: path.relative(docsRoot, file).split(path.sep).join('/'),
      title: readTitle(frontMatter, path.basename(file)),
      dependsOn,
    });
  }
  return pages;
}

function findAffected(changedFiles, pages) {
  const affected = new Map();
  for (const changed of changedFiles) {
    for (const page of pages) {
      if (!page.dependsOn.includes(changed)) continue;
      if (!affected.has(page.file)) {
        affected.set(page.file, { file: page.file, title: page.title, reasons: [] });
      }
      affected.get(page.file).reasons.push(changed);
    }
  }
  return [...affected.values()];
}

function buildSummary(result) {
  const lines = ['## Docs impact', ''];
  if (result.count === 0) {
    lines.push('No docs page depends on the changed files.');
    return `${lines.join('\n')}\n`;
  }

  lines.push(`${result.count} docs ${result.count === 1 ? 'page is' : 'pages are'} affected.`, '');
  lines.push('| Docs page | Changed files |');
  lines.push('| --- | --- |');
  for (const page of result.pages) {
    const reasons = page.reasons.map((reason) => `\`${reason}\``).join('<br>');
    lines.push(`| \`${page.file}\` | ${reasons} |`);
  }
  return `${lines.join('\n')}\n`;
}

const args = parseArgs(process.argv.slice(2));
if (!args['changed-files'] || !args.docs) {
  console.error('Usage: node scripts/docs-impact.mjs --changed-files <file> --docs <dir> [--json <file>] [--summary <file>]');
  process.exit(1);
}

const docsRoot = path.resolve(args.docs);
if (!fs.existsSync(docsRoot)) {
  console.error(`Docs directory not found: ${docsRoot}`);
  process.exit(1);
}

const changedFiles = readChangedFiles(args['changed-files']);
const pages = readPages(docsRoot);
const affected = findAffected(changedFiles, pages);
const result = { changedFiles, pages: affected, count: affected.length };

if (args.json) {
  fs.writeFileSync(args.json, `${JSON.stringify(result, null, 2)}\n`);
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${result.count}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `pages=${JSON.stringify(affected)}\n`);
}

const summary = buildSummary(result);
if (args.summary) fs.writeFileSync(args.summary, summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);

if (result.count === 0) {
  console.log('No docs page depends on the changed files.');
} else {
  console.log(`${result.count} docs ${result.count === 1 ? 'page' : 'pages'} affected.`);
  for (const page of affected) {
    console.log(`- ${page.file} (${page.reasons.join(', ')})`);
  }
}
