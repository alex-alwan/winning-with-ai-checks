import { describe, it, expect } from 'vitest';
import { memoryDeps, buildContent, Core } from '../memory-store.mjs';

const content = buildContent();
const P = content.participants.questions;
const T = content.trainers.questions;
let seq = 0;
const sid = () => 'test-submission-' + String(++seq).padStart(6, '0');

// answers with exactly `right` correct, keyed by id
function answers(questions, right) {
  const a = {};
  questions.forEach((q, i) => {
    const wrong = Object.keys(q.options).find((k) => k !== q.key);
    a[q.id] = i < right ? q.key : wrong;
  });
  return a;
}

function check(env, { audience = 'participants', stage = 'before', cohort = 'HTU-Dec', name = 'Rania Haddad', email = 'rania@example.com', right = 5, organisation, submissionId } = {}) {
  const qs = audience === 'participants' ? P : T;
  return env.handle({
    action: 'submitCheck', audience, stage, cohort, name, email,
    organisation: organisation ?? (audience === 'trainers' ? 'Oasis500' : undefined),
    answers: answers(qs, right), seconds: 400, submissionId: submissionId || sid(),
    version: content.versions[audience],
  });
}

describe('grading', () => {
  it('scores by question id and option id, whatever the order', () => {
    const env = memoryDeps();
    const a = answers(P, 12);
    const shuffled = Object.fromEntries(Object.entries(a).reverse());
    const r = env.handle({ action: 'submitCheck', audience: 'participants', stage: 'before', cohort: '', name: 'Ali Saleh', email: 'ali@example.com', answers: shuffled, seconds: 300, submissionId: sid() });
    expect(r).toMatchObject({ ok: true, score: 12, total: 12, before: null });
  });

  it('counts each right answer once and records 1 or 0 per question in content order', () => {
    const env = memoryDeps();
    expect(check(env, { right: 7 }).score).toBe(7);
    const t = env.table(Core.TABS.pResponses);
    const idx = Core.indexOf_(t.header);
    const flags = P.map((_, i) => t.rows[0][idx['Q' + (i + 1) + ' correct']]);
    expect(flags).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
    expect(t.rows[0][idx['Q1 answer']]).toBe(P[0].key);
    expect(t.rows[0][idx['Percent']]).toBeCloseTo(7 / 12);
    expect(t.rows[0][idx['Minutes']]).toBe(6.7);
  });

  it('refuses a missing answer or an option that does not exist', () => {
    const env = memoryDeps();
    const a = answers(P, 3);
    delete a.q4;
    let r = env.handle({ action: 'submitCheck', audience: 'participants', stage: 'before', name: 'Ali Saleh', email: 'ali@example.com', answers: a, submissionId: sid() });
    expect(r).toMatchObject({ ok: false, code: 'validation', error: Core.MSG.answers });
    const b = answers(P, 3);
    b.q4 = 'z';
    r = env.handle({ action: 'submitCheck', audience: 'participants', stage: 'before', name: 'Ali Saleh', email: 'ali@example.com', answers: b, submissionId: sid() });
    expect(r.error).toBe(Core.MSG.answers);
    expect(env.table(Core.TABS.pResponses).rows).toHaveLength(0);
  });

  it('grades the trainer check out of 10 and stores the organisation', () => {
    const env = memoryDeps();
    const r = check(env, { audience: 'trainers', right: 9, name: 'Lina Odeh', email: 'Lina@Example.com ' });
    expect(r).toMatchObject({ ok: true, score: 9, total: 10 });
    const t = env.table(Core.TABS.tResponses);
    const idx = Core.indexOf_(t.header);
    expect(t.header.slice(0, 6)).toEqual(['Submitted at', 'Stage', 'Cohort', 'Name', 'Organisation', 'Email']);
    expect(t.rows[0][idx.Organisation]).toBe('Oasis500');
    expect(t.rows[0][idx.Email]).toBe('lina@example.com');
  });
});

describe('validation', () => {
  const base = () => ({ action: 'submitCheck', audience: 'participants', stage: 'before', name: 'Ali Saleh', email: 'ali@example.com', answers: answers(P, 1), submissionId: sid() });

  it('needs a full name, a valid email, a known stage and a valid submission id', () => {
    const env = memoryDeps();
    expect(env.handle({ ...base(), name: 'Ali' }).error).toBe(Core.MSG.name);
    expect(env.handle({ ...base(), name: '  Ali   ' }).error).toBe(Core.MSG.name);
    expect(env.handle({ ...base(), email: 'ali@example' }).error).toBe(Core.MSG.email);
    expect(env.handle({ ...base(), stage: 'during' }).error).toBe(Core.MSG.badRequest);
    expect(env.handle({ ...base(), submissionId: 'x' }).error).toBe(Core.MSG.badRequest);
    expect(env.handle({ ...base(), audience: 'admins' }).error).toBe(Core.MSG.badRequest);
    expect(env.handle({ ...base(), cohort: 'x'.repeat(41) }).error).toBe(Core.MSG.badRequest);
    expect(env.handle({ ...base(), name: 'A '.repeat(60) }).error).toBe(Core.MSG.name);
  });

  it('needs an organisation from trainers', () => {
    const env = memoryDeps();
    const r = env.handle({ ...base(), audience: 'trainers', answers: answers(T, 2), organisation: ' ' });
    expect(r.error).toBe(Core.MSG.org);
  });

  it('refuses a page built from other questions', () => {
    const env = memoryDeps();
    expect(env.handle({ ...base(), version: 'old' })).toMatchObject({ ok: false, code: 'stale' });
  });

  it('rejects the hidden honeypot field, unknown actions and non-objects', () => {
    const env = memoryDeps();
    expect(env.handle({ ...base(), website: 'http://spam' })).toMatchObject({ ok: false, code: 'validation' });
    expect(env.handle({ action: 'dropTables' })).toMatchObject({ ok: false });
    expect(Core.handle_(null, env.deps)).toMatchObject({ ok: false });
    expect(Core.handle_([1, 2], env.deps)).toMatchObject({ ok: false });
    expect(env.table(Core.TABS.pResponses).rows).toHaveLength(0);
  });

  it('stores text that starts like a formula with a leading apostrophe', () => {
    const env = memoryDeps();
    env.handle({ ...base(), name: '=HYPERLINK("x") Smith', cohort: '+cohort' });
    const t = env.table(Core.TABS.pResponses);
    const idx = Core.indexOf_(t.header);
    expect(t.rows[0][idx.Name]).toBe('\'=HYPERLINK("x") Smith');
    expect(t.rows[0][idx.Cohort]).toBe("'+cohort");
    expect(Core.safe_('@x')).toBe("'@x");
    expect(Core.safe_('-1')).toBe("'-1");
    expect(Core.safe_('Rania')).toBe('Rania');
  });

  it('never sends answer keys or skills with the questions', () => {
    const env = memoryDeps();
    const r = env.handle({ action: 'getQuestions', audience: 'participants' });
    expect(r.ok).toBe(true);
    expect(r.questions).toHaveLength(12);
    expect(JSON.stringify(r)).not.toMatch(/"key"|"skill"/);
    expect(r.version).toBe(content.versions.participants);
  });
});

describe('repeat submissions', () => {
  it('saves a double tap once and answers it the same way', () => {
    const env = memoryDeps();
    const id = sid();
    const a = check(env, { right: 6, submissionId: id });
    const b = check(env, { right: 6, submissionId: id });
    expect(a).toMatchObject({ ok: true, score: 6, duplicate: false });
    expect(b).toMatchObject({ ok: true, score: 6, duplicate: true });
    expect(env.table(Core.TABS.pResponses).rows).toHaveLength(1);
  });
});

describe('latest attempt and the before score', () => {
  it('gives the latest before score of the same email and cohort with an after submission', () => {
    const env = memoryDeps();
    check(env, { right: 3 });
    env.tick(60000);
    check(env, { right: 5 }); // a retake: this one counts
    env.tick(60000);
    check(env, { right: 4, cohort: 'Other' });
    env.tick(60000);
    const r = check(env, { stage: 'after', right: 10, email: 'RANIA@example.com' });
    expect(r).toMatchObject({ score: 10, before: 5 });
    const other = check(env, { stage: 'after', right: 9, cohort: 'Third' });
    expect(other.before).toBeNull();
  });

  it('keeps every attempt in Responses but only the latest in summaries', () => {
    const env = memoryDeps();
    check(env, { right: 2 });
    env.tick(1000);
    check(env, { right: 6 });
    env.tick(1000);
    check(env, { stage: 'after', right: 9 });
    expect(env.table(Core.TABS.pResponses).rows).toHaveLength(3);
    const spec = Core.audienceSpec_(content, 'participants');
    const s = Core.summarizeChecks_(Core.parseCheckRows_(env.table(Core.TABS.pResponses), spec), P);
    expect(s.before).toEqual({ n: 1, avg: 6 });
    expect(s.pairs).toHaveLength(1);
    expect(s.pairs[0]).toMatchObject({ before: 6, after: 9, change: 3 });
  });
});

describe('paired gain and per-question change', () => {
  function rows(list) {
    // list of [email, cohort, stage, score, flags]
    return list.map(([email, cohort, stage, score, flags], i) => ({
      time: i, stage, cohort, cohortKey: cohort.toLowerCase(), name: email.split('@')[0] + ' X', org: '', email, score, flags, submissionId: 's' + i,
    }));
  }
  const f = (n) => P.map((_, i) => (i < n ? 1 : 0));

  it('matches people by email within the cohort and writes the headline', () => {
    const r = rows([
      ['a@x.io', 'C1', 'Before', 4, f(4)], ['a@x.io', 'C1', 'After', 9, f(9)],
      ['b@x.io', 'C1', 'Before', 5, f(5)], ['b@x.io', 'C1', 'After', 9, f(9)],
      ['c@x.io', 'C1', 'Before', 6, f(6)], ['c@x.io', 'C1', 'After', 6, f(6)],
      ['d@x.io', 'C1', 'Before', 7, f(7)],
      ['a@x.io', 'C2', 'After', 12, f(12)],
    ]);
    const s = Core.summarizeChecks_(r, P);
    expect(s.pairs.map((p) => p.email)).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
    expect(s).toMatchObject({ pairBefore: 5, pairAfter: 8, pairGain: 3, improved: 2, same: 1, lower: 0 });
    expect(s.before.n).toBe(4);
    expect(s.after.n).toBe(4);
    expect(Core.checksHeadline_(s)).toBe('For the 3 people who took both: average 5.0 of 12 before, 8.0 after (+3.0 points). 2 of 3 improved.');
  });

  it('uses the rounded averages so the quoted gain adds up', () => {
    const r = rows([
      ['a@x.io', 'C', 'Before', 4, f(4)], ['a@x.io', 'C', 'After', 9, f(9)],
      ['b@x.io', 'C', 'Before', 4, f(4)], ['b@x.io', 'C', 'After', 9, f(9)],
      ['c@x.io', 'C', 'Before', 5, f(5)], ['c@x.io', 'C', 'After', 9, f(9)],
    ]);
    const s = Core.summarizeChecks_(r, P);
    expect(s.pairBefore).toBe(4.3);
    expect(s.pairAfter).toBe(9);
    expect(Core.checksHeadline_(s)).toBe('For the 3 people who took both: average 4.3 of 12 before, 9.0 after (+4.7 points). 3 of 3 improved.');
  });

  it('says so when no one has taken both, and uses the singular for one person', () => {
    expect(Core.checksHeadline_(Core.summarizeChecks_(rows([['a@x.io', 'C', 'Before', 4, f(4)]]), P))).toBe('No one has taken both checks yet.');
    const one = Core.summarizeChecks_(rows([['a@x.io', 'C', 'Before', 8, f(8)], ['a@x.io', 'C', 'After', 7, f(7)]]), P);
    expect(Core.checksHeadline_(one)).toBe('For the 1 person who took both: average 8.0 of 12 before, 7.0 after (-1.0 points). 0 of 1 improved.');
    expect(one.lower).toBe(1);
  });

  it('works out % right before and after for each question, and the change', () => {
    const r = rows([
      ['a@x.io', 'C', 'Before', 1, f(1)], ['b@x.io', 'C', 'Before', 2, f(2)],
      ['a@x.io', 'C', 'After', 3, f(3)], ['b@x.io', 'C', 'After', 1, f(1)],
    ]);
    const s = Core.summarizeChecks_(r, P);
    expect(s.perQ[0]).toMatchObject({ n: 1, skill: 'Find a real problem', before: 1, after: 1, change: 0 });
    expect(s.perQ[1]).toMatchObject({ before: 0.5, after: 0.5, change: 0 });
    expect(s.perQ[2]).toMatchObject({ before: 0, after: 0.5, change: 0.5 });
    expect(s.perQ[11]).toMatchObject({ before: 0, after: 0, change: 0 });
  });

  it('builds one block for everyone and one per cohort, sorted by change', () => {
    const r = rows([
      ['a@x.io', 'B-group', 'Before', 2, f(2)], ['a@x.io', 'B-group', 'After', 3, f(3)],
      ['b@x.io', 'A-group', 'Before', 2, f(2)], ['b@x.io', 'A-group', 'After', 10, f(10)],
    ]);
    const L = Core.participantSummaryLayout_(r, P, 'now');
    const firstCol = L.values.map((v) => v[0]);
    expect(firstCol).toContain('All participants');
    expect(firstCol.indexOf('Cohort: A-group')).toBeLessThan(firstCol.indexOf('Cohort: B-group'));
    const nameRow = firstCol.indexOf('Name');
    expect(L.values[nameRow + 1].slice(0, 5)).toEqual(['b X', 'b@x.io', 2, 10, 8]);
    expect(L.formats.some((x) => x.kind === 'headline' && x.nc === 7)).toBe(true);
  });
});

describe('teach-back scores and readiness', () => {
  const rubric = content.rubric;
  const bar = { knowledgeMin: 8, rubricMin: 3 };
  const lines = (t, c, p, j) => ({ timing: t, clarity: c, practice: p, judgment: j });
  function srow(i, email, role, scorer, l, cohort = 'ToT') {
    return { time: i, cohort, cohortKey: cohort.toLowerCase(), scorer, role, traineeName: 'Someone Else', traineeEmail: email, part: 'Opening talk', lines: l, submissionId: 's' + i };
  }
  function crow(i, email, stage, score, name = 'Lina Odeh', org = 'Oasis500', cohort = 'ToT') {
    return { time: i, stage, cohort, cohortKey: cohort.toLowerCase(), name, org, email, score, flags: [], submissionId: 'c' + i };
  }

  it('uses the lead trainer score where there is one, otherwise the peer average to one decimal', () => {
    const checks = [crow(1, 'l@x.io', 'Before', 5), crow(2, 'l@x.io', 'After', 9)];
    const scores = [
      srow(1, 'l@x.io', 'Peer', 'P1', lines(2, 2, 2, 2)),
      srow(2, 'l@x.io', 'Peer', 'P2', lines(3, 4, 4, 3)),
      srow(3, 'l@x.io', 'Peer', 'P3', lines(3, 4, 3, 3)),
      srow(4, 'l@x.io', 'Lead trainer', 'Alex', lines(4, 3, 3, 3)),
    ];
    const r = Core.readiness_(checks, scores, rubric, bar);
    expect(r.trainers).toHaveLength(1);
    const t = r.trainers[0];
    expect(t).toMatchObject({ name: 'Lina Odeh', org: 'Oasis500', before: 5, after: 9, gain: 4, count: 4, ready: true });
    expect(t.lines).toEqual({ timing: 4, clarity: 3, practice: 3, judgment: 3 });
    const peersOnly = Core.readiness_(checks, scores.slice(0, 3), rubric, bar).trainers[0];
    expect(peersOnly.lines).toEqual({ timing: 2.7, clarity: 3.3, practice: 3, judgment: 2.7 });
    expect(peersOnly.ready).toBe(false);
  });

  it('is ready only with knowledge after at or above the bar and every line at or above the bar', () => {
    const ok = lines(3, 3, 3, 3);
    const mk = (after, l) => Core.readiness_([crow(1, 'a@x.io', 'After', after)], l ? [srow(1, 'a@x.io', 'Lead trainer', 'Alex', l)] : [], rubric, bar).trainers[0].ready;
    expect(mk(8, ok)).toBe(true);
    expect(mk(7, ok)).toBe(false);
    expect(mk(10, lines(3, 3, 2, 4))).toBe(false);
    expect(mk(10, null)).toBe(false);
    expect(Core.readiness_([crow(1, 'a@x.io', 'After', 7)], [srow(1, 'a@x.io', 'Lead trainer', 'Alex', ok)], rubric, { knowledgeMin: 7, rubricMin: 3 }).trainers[0].ready).toBe(true);
  });

  it('counts only the latest score from each scorer, and keeps cohorts apart', () => {
    const checks = [crow(1, 'a@x.io', 'After', 9), crow(2, 'a@x.io', 'After', 9, 'Lina Odeh', 'Oasis500', 'ToT-2')];
    const scores = [
      srow(1, 'a@x.io', 'Lead trainer', 'Alex', lines(2, 2, 2, 2)),
      srow(2, 'a@x.io', 'Lead trainer', 'alex', lines(4, 4, 4, 4)),
    ];
    const r = Core.readiness_(checks, scores, rubric, bar);
    expect(r.total).toBe(2);
    const tot = r.trainers.find((t) => t.cohort === 'ToT');
    expect(tot).toMatchObject({ count: 1, ready: true });
    expect(r.trainers.find((t) => t.cohort === 'ToT-2')).toMatchObject({ count: 0, ready: false });
    expect(Core.readinessHeadline_(r)).toBe('1 of 2 trainers meet the readiness bar.');
  });

  it('includes a trainee typed in by a scorer who never took the knowledge check', () => {
    const r = Core.readiness_([], [srow(1, 'new@x.io', 'Peer', 'P1', lines(4, 4, 4, 4))], rubric, bar);
    expect(r.trainers[0]).toMatchObject({ name: 'Someone Else', email: 'new@x.io', after: null, ready: false });
    expect(Core.readinessHeadline_(r)).toBe('0 of 1 trainer meets the readiness bar.');
  });

  it('reads the thresholds from Script Properties, with the rubric file as the default', () => {
    expect(Core.readinessBar_(memoryDeps().deps)).toEqual({ knowledgeMin: 8, rubricMin: 3 });
    expect(Core.readinessBar_(memoryDeps({ props: { READY_KNOWLEDGE_MIN: '7', READY_RUBRIC_MIN: '2.5' } }).deps)).toEqual({ knowledgeMin: 7, rubricMin: 2.5 });
  });
});

describe('Config windows', () => {
  const cfg = Core.parseConfig_([
    { cohort: 'HTU-Dec', audience: 'participants', opens: '2026-12-01', closes: '2026-12-02', status: 'open' },
    { cohort: 'Old', audience: '', opens: '', closes: '', status: 'closed' },
    { cohort: 'ToT-Nov', audience: 'trainers', opens: '2026-11-10', closes: '', status: 'Open' },
  ]);

  it('accepts cohorts that are not listed, and open cohorts inside their dates', () => {
    expect(Core.windowCheck_(cfg, 'participants', 'Unlisted', '2026-12-01')).toBeNull();
    expect(Core.windowCheck_(cfg, 'participants', '', '2026-12-01')).toBeNull();
    expect(Core.windowCheck_(cfg, 'participants', 'htu-dec', '2026-12-01')).toBeNull();
    expect(Core.windowCheck_(cfg, 'participants', 'HTU-Dec', '2026-12-02')).toBeNull();
  });

  it('refuses closed cohorts and dates outside the window, with a clear message', () => {
    expect(Core.windowCheck_(cfg, 'trainers', 'Old', '2026-12-01')).toBe(Core.MSG.closed);
    expect(Core.windowCheck_(cfg, 'participants', 'HTU-Dec', '2026-11-30')).toBe('This check opens on 1 Dec 2026. Please ask your trainer.');
    expect(Core.windowCheck_(cfg, 'participants', 'HTU-Dec', '2026-12-03')).toBe('This check closed on 2 Dec 2026. Please ask your trainer.');
  });

  it('applies a row only to its own audience', () => {
    expect(Core.windowCheck_(cfg, 'trainers', 'HTU-Dec', '2026-11-01')).toBeNull();
    expect(Core.windowCheck_(cfg, 'trainers', 'ToT-Nov', '2026-11-09')).toMatch(/opens on 10 Nov 2026/);
  });

  it('refuses a submission to a closed cohort and saves nothing', () => {
    const env = memoryDeps({ config: [{ cohort: 'Old', audience: 'participants', opens: '', closes: '', status: 'closed' }] });
    expect(check(env, { cohort: 'Old' })).toMatchObject({ ok: false, code: 'closed', error: Core.MSG.closed });
    expect(env.table(Core.TABS.pResponses).rows).toHaveLength(0);
  });
});

describe('scorer code', () => {
  const list = (env, code, device = 'dev-1') => env.handle({ action: 'listTrainees', code, cohort: 'ToT', device });

  it('is closed until a code is set', () => {
    expect(list(memoryDeps(), 'anything')).toMatchObject({ ok: false, code: 'nocode' });
  });

  it('asks for a 30-second wait after 5 wrong tries, then accepts the right code', () => {
    const env = memoryDeps({ props: { SCORER_CODE: 'Teach-2026' } });
    for (let i = 0; i < 4; i++) expect(list(env, 'wrong')).toMatchObject({ ok: false, code: 'code', error: Core.MSG.code });
    expect(list(env, 'wrong')).toMatchObject({ ok: false, code: 'wait', error: Core.MSG.wait });
    expect(list(env, 'Teach-2026')).toMatchObject({ ok: false, code: 'wait' });
    expect(list(env, 'Teach-2026', 'dev-2')).toMatchObject({ ok: true });
    env.tick(31000);
    expect(list(env, ' teach-2026 ')).toMatchObject({ ok: true, trainees: [] });
  });

  it('compares codes without regard to case', () => {
    expect(Core.sameCode_('ABC-1', 'abc-1')).toBe(true);
    expect(Core.sameCode_('abc', 'abcd')).toBe(false);
  });
});

describe('teach-back scoring API', () => {
  function setup() {
    const env = memoryDeps({ props: { SCORER_CODE: 'code-1234' } });
    check(env, { audience: 'trainers', cohort: 'ToT', name: 'Zaid Nasser', email: 'zaid@x.io', organisation: 'ZINC' });
    check(env, { audience: 'trainers', cohort: 'ToT', name: 'Amal Khoury', email: 'amal@x.io', organisation: 'Oasis500' });
    check(env, { audience: 'trainers', cohort: 'Other', name: 'Basel Omar', email: 'basel@x.io', organisation: 'iPark' });
    return env;
  }
  const score = (over = {}) => ({
    action: 'submitScore', code: 'code-1234', device: 'd1', cohort: 'ToT', scorer: 'Alex Alwan', role: 'lead',
    part: 'Lab 2 · Give AI the right facts', scores: { timing: 4, clarity: 3, practice: 4, judgment: 3 },
    comment: 'Clear and calm.', submissionId: sid(), ...over,
  });

  it('lists this cohort\'s trainers by name, without emails', () => {
    const env = setup();
    const r = env.handle({ action: 'listTrainees', code: 'code-1234', cohort: 'ToT', device: 'd1' });
    expect(r.trainees.map((t) => t.name + ' · ' + t.organisation)).toEqual(['Amal Khoury · Oasis500', 'Zaid Nasser · ZINC']);
    expect(JSON.stringify(r)).not.toContain('@');
  });

  it('saves a score for a listed trainer, and for one typed in by hand', () => {
    const env = setup();
    const { trainees } = env.handle({ action: 'listTrainees', code: 'code-1234', cohort: 'ToT', device: 'd1' });
    expect(env.handle(score({ trainee: { id: trainees[1].id } }))).toMatchObject({ ok: true, trainee: 'Zaid Nasser' });
    expect(env.handle(score({ role: 'peer', scorer: 'Peer One', trainee: { name: 'New Person', email: 'New@x.io' } }))).toMatchObject({ ok: true });
    const t = env.table(Core.TABS.tScores);
    expect(t.header).toEqual(['Submitted at', 'Cohort', 'Scorer', 'Role', 'Trainee name', 'Trainee email', 'Course part', 'Timing', 'Clarity', 'Practice', 'Judgment and safety', 'Comment', 'Submission ID']);
    expect(t.rows[0].slice(1, 11)).toEqual(['ToT', 'Alex Alwan', 'Lead trainer', 'Zaid Nasser', 'zaid@x.io', 'Lab 2 · Give AI the right facts', 4, 3, 4, 3]);
    expect(t.rows[1].slice(3, 6)).toEqual(['Peer', 'New Person', 'new@x.io']);
    const layout = env.layouts.get(Core.TABS.tReadiness);
    expect(layout.values[1][0]).toBe('0 of 4 trainers meet the readiness bar.');
  });

  it('refuses missing or out-of-range scores, unknown parts, long comments and a wrong trainee id', () => {
    const env = setup();
    const t = { trainee: { name: 'New Person', email: 'new@x.io' } };
    expect(env.handle(score({ ...t, scores: { timing: 4, clarity: 3, practice: 4 } })).error).toBe(Core.MSG.scores);
    expect(env.handle(score({ ...t, scores: { timing: 5, clarity: 3, practice: 4, judgment: 1 } })).error).toBe(Core.MSG.scores);
    expect(env.handle(score({ ...t, scores: { timing: '4', clarity: 3, practice: 4, judgment: 1 } })).error).toBe(Core.MSG.scores);
    expect(env.handle(score({ ...t, part: 'Module 9' })).error).toBe(Core.MSG.part);
    expect(env.handle(score({ ...t, role: 'boss' })).error).toBe(Core.MSG.role);
    expect(env.handle(score({ ...t, comment: 'x'.repeat(501) })).error).toBe(Core.MSG.comment);
    expect(env.handle(score({ trainee: { id: 'nope' } })).error).toBe(Core.MSG.traineeGone);
    expect(env.handle(score({ trainee: { name: 'Solo', email: 'a@b.co' } })).error).toBe(Core.MSG.traineeName);
    expect(env.handle(score({ ...t, code: 'bad' })).code).toBe('code');
    expect(env.table(Core.TABS.tScores).rows).toHaveLength(0);
  });

  it('saves a double tap once', () => {
    const env = setup();
    const p = score({ trainee: { name: 'New Person', email: 'new@x.io' } });
    env.handle(p);
    expect(env.handle(p)).toMatchObject({ ok: true, duplicate: true });
    expect(env.table(Core.TABS.tScores).rows).toHaveLength(1);
  });
});

describe('clean-up of test rows', () => {
  it('deletes only rows whose cohort is TEST, and needs the code', () => {
    const env = memoryDeps({ props: { SCORER_CODE: 'code-1234' } });
    check(env, { cohort: 'TEST' });
    check(env, { cohort: 'test', email: 'b@x.io' });
    check(env, { cohort: 'Real' });
    check(env, { audience: 'trainers', cohort: 'TEST' });
    expect(env.handle({ action: 'deleteTestRows', code: 'nope', device: 'd' })).toMatchObject({ ok: false });
    const r = env.handle({ action: 'deleteTestRows', code: 'code-1234', device: 'd' });
    expect(r).toMatchObject({ ok: true, deleted: { participants: 2, trainers: 1, teachBacks: 0 } });
    expect(env.table(Core.TABS.pResponses).rows).toHaveLength(1);
  });
});

describe('summaries rebuild after each submission', () => {
  it('writes the participant summary and the readiness tab', () => {
    const env = memoryDeps();
    check(env, { right: 4 });
    check(env, { stage: 'after', right: 9 });
    const L = env.layouts.get(Core.TABS.pSummary);
    expect(L.values.map((v) => v[0])).toContain('For the 1 person who took both: average 4.0 of 12 before, 9.0 after (+5.0 points). 1 of 1 improved.');
    expect(env.props.get('DIRTY_PARTICIPANTS')).toBe('0');
  });

  it('keeps the flag set when a rebuild fails, so the next request tries again', () => {
    const env = memoryDeps();
    const write = env.deps.store.writeLayout;
    env.deps.store.writeLayout = () => { throw new Error('quota'); };
    expect(check(env, { right: 4 })).toMatchObject({ ok: true });
    expect(env.props.get('DIRTY_PARTICIPANTS')).toBe('1');
    expect(env.errors).toHaveLength(1);
    env.deps.store.writeLayout = write;
    check(env, { right: 5, email: 'z@x.io' });
    expect(env.props.get('DIRTY_PARTICIPANTS')).toBe('0');
  });
});

describe('small helpers', () => {
  it('formats dates and headers', () => {
    expect(Core.prettyDate_('2026-11-05')).toBe('5 Nov 2026');
    expect(Core.normalizeDay_('2026-1-5')).toBe('2026-01-05');
    expect(Core.mergeHeader_(['A', 'B'], ['B', 'C'])).toEqual(['A', 'B', 'C']);
    expect(Core.rowFor_(['A', 'C'], { C: 1, A: 2, Z: 3 })).toEqual([2, 1]);
    expect(Core.isFullName_('رانيا حداد')).toBe(true);
  });
});
