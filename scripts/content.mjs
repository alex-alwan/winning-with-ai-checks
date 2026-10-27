// Reads the content files and makes the two views of them:
// the full one for Apps Script (with answer keys) and the public one for the pages (without).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

export function loadContent() {
  const participants = readJson('content/participant-questions.json');
  const trainers = readJson('content/trainer-questions.json');
  const rubric = readJson('content/teachback-rubric.json');
  validateQuestions(participants, 'participants');
  validateQuestions(trainers, 'trainers');
  validateRubric(rubric);
  return { participants, trainers, rubric };
}

// A short fingerprint of the question and option ids. The pages send it with
// every answer, so the server can spot a page built from older questions.
export function contentVersion(file) {
  const shape = file.questions.map((q) => q.id + ':' + Object.keys(q.options).join(',')).join('|');
  return createHash('sha256').update(shape).digest('hex').slice(0, 12);
}

export function publicQuestions(file) {
  return {
    audience: file.audience,
    version: contentVersion(file),
    questions: file.questions.map((q) => ({
      id: q.id,
      text: q.text,
      options: Object.keys(q.options).map((k) => ({ id: k, text: q.options[k] })),
    })),
  };
}

export function publicRubric(file) {
  return {
    scale: file.scale,
    lines: file.lines.map((l) => ({ id: l.id, name: l.name, four: l.four_looks_like })),
    parts: file.course_parts.slice(),
  };
}

function fail(msg) {
  throw new Error('Content problem: ' + msg);
}

export function validateQuestions(file, audience) {
  if (file.audience !== audience) fail(`${audience} file has audience "${file.audience}"`);
  if (!Array.isArray(file.questions) || file.questions.length === 0) fail(`${audience} file has no questions`);
  const ids = new Set();
  for (const q of file.questions) {
    if (!/^[a-z0-9_-]{1,20}$/i.test(q.id || '')) fail(`question id "${q.id}" is not valid`);
    if (ids.has(q.id)) fail(`question id "${q.id}" appears twice`);
    ids.add(q.id);
    if (!q.text || typeof q.text !== 'string') fail(`${q.id} has no text`);
    const keys = Object.keys(q.options || {});
    if (keys.length < 2) fail(`${q.id} needs at least two options`);
    for (const k of keys) {
      if (!/^[a-z0-9]{1,4}$/i.test(k)) fail(`${q.id} option id "${k}" is not valid`);
      if (!q.options[k]) fail(`${q.id} option ${k} has no text`);
    }
    if (!keys.includes(q.key)) fail(`${q.id} answer key "${q.key}" is not one of its options`);
    if (!q.skill) fail(`${q.id} has no skill`);
    checkDashes(q.text, q.id);
    keys.forEach((k) => checkDashes(q.options[k], `${q.id} option ${k}`));
  }
}

export function validateRubric(file) {
  if (!Array.isArray(file.lines) || file.lines.length === 0) fail('rubric has no lines');
  for (const l of file.lines) {
    if (!/^[a-z0-9_-]{1,20}$/i.test(l.id || '')) fail(`rubric line id "${l.id}" is not valid`);
    if (!l.name || !l.four_looks_like) fail(`rubric line ${l.id} needs a name and four_looks_like`);
  }
  if (!Array.isArray(file.course_parts) || file.course_parts.length === 0) fail('rubric has no course_parts');
  const bar = file.readiness_bar || {};
  if (typeof bar.knowledge_after_min !== 'number' || typeof bar.every_rubric_line_min !== 'number') {
    fail('readiness_bar needs knowledge_after_min and every_rubric_line_min');
  }
}

// The writing rules ban em and en dashes in every visible string.
function checkDashes(text, where) {
  if (/[–—]/.test(text)) fail(`${where} contains an em or en dash`);
}
