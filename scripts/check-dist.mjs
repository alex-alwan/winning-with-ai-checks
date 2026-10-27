// Runs after every site build. Fails the build if:
// - any answer key, skill tag, readiness threshold or server-only setting reaches the built site, or
// - the JavaScript and CSS together go over 150 KB.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from './content.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BUDGET = 150 * 1024;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(DIST);
const text = files.filter((f) => ['.js', '.css', '.html', '.json', '.map', '.txt'].includes(extname(f)));
const all = text.map((f) => ({ f: f.slice(DIST.length + 1), s: readFileSync(f, 'utf8') }));
const problems = [];

const { participants, trainers, rubric } = loadContent();
const forbidden = [
  // an answer key in any shape: "key":"d", key:"d", key: 'd'
  { name: 'an answer key field', re: /["']?\bkey\b["']?\s*:\s*["'][a-z0-9]{1,4}["']/i },
  { name: 'the skill field', re: /["']skill["']\s*:/ },
  { name: 'the readiness bar', re: /knowledge_after_min|every_rubric_line_min|readiness_bar|READY_KNOWLEDGE_MIN|READY_RUBRIC_MIN/ },
  { name: 'the scorer code setting', re: /SCORER_CODE/ },
];
for (const q of [...participants.questions, ...trainers.questions]) {
  // the skill tag text, which only the server and the Sheet need
  forbidden.push({ name: `${q.id} skill "${q.skill}"`, re: new RegExp(q.skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), skillOnly: true });
}
for (const { f, s } of all) {
  // skill names also appear inside course part names (for example "Module 1 · Find a real problem"),
  // which the scoring page needs, so those are taken out before looking for skills
  const withoutParts = rubric.course_parts.reduce((acc, p) => acc.split(JSON.stringify(p).slice(1, -1)).join(''), s);
  for (const x of forbidden) {
    if (x.re.test(x.skillOnly ? withoutParts : s)) problems.push(`${f} contains ${x.name}`);
  }
}

// every question must be in the site, so this check is not passing on an empty build
for (const q of [...participants.questions, ...trainers.questions]) {
  // the minifier may change how quotes are escaped, so look for the parts between quotes
  const pieces = q.text.split(/["'\\]/).filter((x) => x.length >= 8);
  if (!all.some(({ s }) => pieces.every((x) => s.includes(x)))) problems.push(`question ${q.id} is missing from the built site`);
}

const size = files.filter((f) => ['.js', '.css'].includes(extname(f))).reduce((n, f) => n + statSync(f).size, 0);
if (size > BUDGET) problems.push(`JavaScript and CSS are ${Math.round(size / 1024)} KB, over the 150 KB budget`);

if (problems.length) {
  console.error('dist check FAILED:\n- ' + [...new Set(problems)].join('\n- '));
  process.exit(1);
}
console.log(`dist check passed: no answer keys or server-only values in ${all.length} files; JS + CSS = ${(size / 1024).toFixed(1)} KB of 150 KB.`);
