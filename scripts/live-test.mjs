// End-to-end test against the deployed Apps Script, in the cohort TEST.
//   API_URL=https://script.google.com/macros/s/.../exec SCORER_CODE=... node scripts/live-test.mjs
//   add --cleanup to delete every TEST row afterwards (and nothing else)
import { randomUUID } from 'node:crypto';
import { loadContent, contentVersion } from './content.mjs';

const API = process.env.API_URL;
const CODE = process.env.SCORER_CODE;
if (!API || !CODE) {
  console.error('Set API_URL and SCORER_CODE.');
  process.exit(1);
}
const { participants, trainers } = loadContent();

async function call(payload) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
  const data = await res.json();
  console.log(payload.action.padEnd(14), JSON.stringify(data));
  return data;
}

function answers(file, right) {
  return Object.fromEntries(file.questions.map((q, i) => [q.id, i < right ? q.key : Object.keys(q.options).find((k) => k !== q.key)]));
}

function check(file, audience, stage, right, extra) {
  return call({
    action: 'submitCheck', audience, stage, cohort: 'TEST', answers: answers(file, right), seconds: 300,
    submissionId: randomUUID(), version: contentVersion(file), ...extra,
  });
}

const fails = [];
const expect = (ok, what) => { if (!ok) fails.push(what); };

if (process.argv.includes('--cleanup-only')) {
  const r = await call({ action: 'deleteTestRows', code: CODE, device: 'live-test' });
  process.exit(r.ok ? 0 : 1);
}

let r = await call({ action: 'getQuestions', audience: 'participants' });
expect(r.ok && r.questions.length === 12 && !JSON.stringify(r).includes('"key"'), 'getQuestions');
const person = { name: 'Test Participant', email: 'test.participant@example.com' };
r = await check(participants, 'participants', 'before', 5, person);
expect(r.ok && r.score === 5 && r.before === null, 'participant before');
r = await check(participants, 'participants', 'after', 10, person);
expect(r.ok && r.score === 10 && r.before === 5, 'participant after with before score');
const trainer = { name: 'Test Trainer', email: 'test.trainer@example.com', organisation: 'Test Hub' };
r = await check(trainers, 'trainers', 'before', 6, trainer);
expect(r.ok && r.score === 6, 'trainer before');
r = await check(trainers, 'trainers', 'after', 9, trainer);
expect(r.ok && r.score === 9 && r.before === 6, 'trainer after');
r = await call({ action: 'listTrainees', code: 'definitely-wrong', cohort: 'TEST', device: 'live-test' });
expect(!r.ok && r.code === 'code', 'wrong code refused');
r = await call({ action: 'listTrainees', code: CODE, cohort: 'TEST', device: 'live-test' });
expect(r.ok && r.trainees.length === 1, 'trainee list');
const id = r.ok && r.trainees[0] ? r.trainees[0].id : '';
r = await call({
  action: 'submitScore', code: CODE, device: 'live-test', cohort: 'TEST', scorer: 'Test Scorer', role: 'lead',
  part: 'Lab 2 · Give AI the right facts', trainee: { id }, scores: { timing: 4, clarity: 3, practice: 4, judgment: 3 },
  comment: 'Live test', submissionId: randomUUID(),
});
expect(r.ok && r.trainee === 'Test Trainer', 'teach-back score');

if (process.argv.includes('--cleanup')) {
  r = await call({ action: 'deleteTestRows', code: CODE, device: 'live-test' });
  expect(r.ok, 'clean-up');
}
if (fails.length) {
  console.error('LIVE TEST FAILED: ' + fails.join(', '));
  process.exit(1);
}
console.log('Live test passed.');
