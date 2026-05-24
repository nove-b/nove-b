import { readFile, writeFile } from 'node:fs/promises';

const FEED_URL = 'https://tangled.org/nove-b.dev/feed.atom';
const README_PATH = new URL('../../README.md', import.meta.url);
const START_MARKER = '<!-- BLOG-POST-LIST:START -->';
const END_MARKER = '<!-- BLOG-POST-LIST:END -->';
const MAX_ENTRIES = 10;

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lpar;/g, '(')
    .replace(/&rpar;/g, ')')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeMarkdown(text) {
  return text.replace(/([\\\[\]])/g, '\\$1');
}

function extractTag(source, tagName) {
  const match = source.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'));
  return match ? decodeEntities(match[1].trim()) : '';
}

function classifyEntry(id, title) {
  if (/\/pulls\//.test(id)) {
    return '🔀 Pull Request';
  }

  if (/\/issues\//.test(id)) {
    return '📝 Issue';
  }

  if (/created repository/i.test(title)) {
    return '📦 Repository';
  }

  return '📌 Activity';
}

function toDate(value) {
  if (!value) {
    return '';
  }

  const [date] = value.split('T');
  return date ?? value;
}

function parseEntries(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;

  for (const match of xml.matchAll(entryRegex)) {
    const entryXml = match[1];
    const title = extractTag(entryXml, 'title');
    const id = extractTag(entryXml, 'id');
    const updated = extractTag(entryXml, 'updated');
    const linkMatch = entryXml.match(/<link[^>]*href="([^"]+)"[^>]*rel="alternate"[^>]*>/i);
    const url = linkMatch ? decodeEntities(linkMatch[1]) : '';

    if (!title || !url) {
      continue;
    }

    entries.push({
      title,
      id,
      updated,
      url,
      label: classifyEntry(id, title),
    });
  }

  return entries.slice(0, MAX_ENTRIES);
}

function formatEntries(entries) {
  return entries
    .map(({ title, updated, url, label }) => `- ${toDate(updated)} ${label}: [${escapeMarkdown(title)}](${url})`)
    .join('\n');
}

function replaceSection(readme, content) {
  const pattern = new RegExp(`(${START_MARKER})([\\s\\S]*?)(${END_MARKER})`, 'm');

  if (!pattern.test(readme)) {
    throw new Error('README markers not found');
  }

  return readme.replace(pattern, `$1\n${content}\n$3`);
}

const response = await fetch(FEED_URL, {
  headers: {
    'user-agent': 'nove-b-readme-updater',
    accept: 'application/atom+xml, application/xml, text/xml',
  },
});

if (!response.ok) {
  throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
}

const xml = await response.text();
const entries = parseEntries(xml);

if (entries.length === 0) {
  throw new Error('No feed entries found');
}

const readme = await readFile(README_PATH, 'utf8');
const nextReadme = replaceSection(readme, formatEntries(entries));

if (nextReadme !== readme) {
  await writeFile(README_PATH, nextReadme);
}