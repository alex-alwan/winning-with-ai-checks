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
  let shape = file.questions.map((q) => q.id + ':' + Object.keys(q.options).join(',')).join('|');
  if (file.topics) shape += '#topics:' + file.topics.items.map((t) => t.id).join(',') + ':' + file.topics.min + '-' + file.topics.max;
  return createHash('sha256').update(shape).digest('hex').slice(0, 12);
}

export function publicQuestions(file) {
  const out = {
    audience: file.audience,
    version: contentVersion(file),
    questions: file.questions.map((q) => ({
      id: q.id,
      text: q.text,
      ...(q.text_ar ? { text_ar: q.text_ar } : {}),
      options: Object.keys(q.options).map((k) => ({
        id: k,
        text: q.options[k],
        ...(q.options_ar ? { text_ar: q.options_ar[k] } : {}),
      })),
    })),
  };
  // the end-of-training topic question is not scored, so all of it is public
  if (file.topics) {
    out.topics = {
      question: file.topics.question,
      question_ar: file.topics.question_ar,
      min: file.topics.min,
      max: file.topics.max,
      items: file.topics.items.map((t) => ({ id: t.id, label: t.label, label_ar: t.label_ar })),
    };
  }
  return out;
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
  // Arabic is all or nothing: once one question has it, every question and option needs it
  if (file.questions.some((q) => q.text_ar || q.options_ar)) {
    for (const q of file.questions) {
      if (!q.text_ar) fail(`${q.id} has no Arabic text (text_ar)`);
      checkDashes(q.text_ar, `${q.id} Arabic text`);
      const en = Object.keys(q.options).sort().join(',');
      const ar = Object.keys(q.options_ar || {}).sort().join(',');
      if (en !== ar) fail(`${q.id} options_ar must have the same option ids as options (${en})`);
      Object.keys(q.options_ar).forEach((k) => {
        if (!q.options_ar[k]) fail(`${q.id} Arabic option ${k} is empty`);
        checkDashes(q.options_ar[k], `${q.id} Arabic option ${k}`);
      });
    }
  }
  // trainer check: the right answer must be shorter than the longest wrong one, in both languages,
  // so picking the longest option is not a way to pass
  if (audience === 'trainers') {
    for (const q of file.questions) {
      for (const [lang, opts] of [['English', q.options], ['Arabic', q.options_ar]]) {
        if (!opts) continue;
        const longestWrong = Math.max(...Object.keys(opts).filter((k) => k !== q.key).map((k) => opts[k].length));
        if (opts[q.key].length >= longestWrong) fail(`${q.id} right answer is the longest ${lang} option (${opts[q.key].length} vs ${longestWrong})`);
      }
    }
  }
  if (file.topics) validateTopics(file.topics, audience);
}

function validateTopics(t, audience) {
  if (!t.question || !t.question_ar) fail(`${audience} topics need question and question_ar`);
  if (!Array.isArray(t.items) || t.items.length < 2) fail(`${audience} topics need at least two items`);
  if (!Number.isInteger(t.min) || !Number.isInteger(t.max) || t.min < 1 || t.max < t.min || t.max > t.items.length) {
    fail(`${audience} topics need whole numbers min >= 1 and max between min and the number of items`);
  }
  const ids = new Set();
  for (const item of t.items) {
    if (!/^[a-z0-9-]{1,30}$/.test(item.id || '')) fail(`topic id "${item.id}" is not valid (lowercase letters, numbers, dashes)`);
    if (ids.has(item.id)) fail(`topic id "${item.id}" appears twice`);
    ids.add(item.id);
    if (!item.label || !item.label_ar) fail(`topic ${item.id} needs label and label_ar`);
    // labels are stored in one Sheet cell, separated by semicolons
    if (item.label.includes(';')) fail(`topic ${item.id} label must not contain a semicolon`);
    [item.label, item.label_ar].forEach((x) => checkDashes(x, `topic ${item.id}`));
  }
  [t.question, t.question_ar].forEach((x) => checkDashes(x, `${audience} topic question`));
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
