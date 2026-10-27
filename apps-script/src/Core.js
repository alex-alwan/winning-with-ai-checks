/**
 * Core: the grading, validation, summary and readiness logic.
 * Pure functions only: no SpreadsheetApp, no PropertiesService, no CacheService.
 * The same file runs inside Apps Script and in Node for the unit tests.
 * Everything Google-specific is passed in as `deps` (see Main.js and tests/memory-store.mjs).
 */

var TABS = {
  pResponses: 'Participants · Responses',
  pSummary: 'Participants · Summary',
  tResponses: 'Trainers · Responses',
  tScores: 'Trainers · Teach-backs',
  tReadiness: 'Trainers · Readiness',
  config: 'Config'
};
var TAB_ORDER = [TABS.pResponses, TABS.pSummary, TABS.tResponses, TABS.tScores, TABS.tReadiness, TABS.config];
var CONFIG_HEADER = ['Cohort', 'Audience', 'Opens', 'Closes', 'Status'];

var MAX_BODY = 20000;
var LIMITS = { name: 80, email: 120, org: 100, cohort: 40, scorer: 80, comment: 500, code: 100 };
var CODE_TRIES = 5;          // wrong scorer codes from one device before a wait
var CODE_WAIT_SECONDS = 30;
var CODE_TRIES_ALL = 30;     // wrong codes from everyone together, within 5 minutes, before a wait for all
var DIRTY = { participants: 'DIRTY_PARTICIPANTS', trainers: 'DIRTY_TRAINERS' };

var MSG = {
  generic: 'Something went wrong on our side. Please try again.',
  badRequest: 'Please open the link your trainer shared, then try again.',
  busy: 'Many people are saving at once. Please try again.',
  stale: 'This page is out of date. Please reload the page, then try again.',
  name: 'Please write your full name (first and last).',
  email: 'Please write a valid email. Use the same one at the start and the end.',
  org: 'Please write the name of your organisation.',
  answers: 'Please answer every question.',
  closed: 'This check is closed. Please ask your trainer.',
  code: 'That code is not right. Please check it with the lead trainer.',
  wait: 'Too many tries. Please wait 30 seconds, then try again.',
  noCode: 'Scoring is not open yet. Ask the lead trainer to set the scorer code.',
  scorer: 'Please write your name.',
  role: 'Please choose your role.',
  part: 'Please choose the course part.',
  trainee: 'Please choose the trainer you are scoring.',
  traineeGone: 'That trainer is not on the list any more. Please refresh the list.',
  traineeName: "Please write the trainer's full name (first and last).",
  traineeEmail: "Please write the trainer's email.",
  scores: 'Please choose a score from 1 to 4 for every line.',
  comment: 'Please keep the comment to 500 characters or fewer.'
};
var ROLES = { lead: 'Lead trainer', peer: 'Peer' };
var READY_YES = 'Yes';
var READY_NO = 'Co-deliver first cohort';

// ---------- small helpers ----------

function userError_(code, message) {
  var e = new Error(message);
  e.userCode = code;
  return e;
}

function clean_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// keeps line breaks, removes other control characters
function cleanMultiline_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// stops a name, email or comment from being read as a spreadsheet formula
function safe_(v) {
  var s = String(v === undefined || v === null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function unsafe_(v) {
  var s = String(v === undefined || v === null ? '' : v);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

function isFullName_(name) {
  return name.length >= 3 && name.length <= LIMITS.name && name.split(' ').filter(function (w) { return w.length > 0; }).length >= 2;
}

function isEmail_(email) {
  return email.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isSubmissionId_(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

function hasOwn_(o, k) {
  return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
}

function toTime_(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  var t = Date.parse(String(v || ''));
  return isNaN(t) ? 0 : t;
}

function round1_(x) {
  return x === null || x === undefined ? null : Math.round(x * 10) / 10;
}

function round2_(x) {
  return x === null || x === undefined ? null : Math.round(x * 100) / 100;
}

function signed1_(x) {
  var r = Math.round(x * 10) / 10;
  return (r < 0 ? '-' : '+') + Math.abs(r).toFixed(1);
}

function avg_(list, f) {
  if (!list.length) return null;
  var s = 0;
  list.forEach(function (x) { s += f(x); });
  return s / list.length;
}

function byName_(a, b) {
  return String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });
}

function indexOf_(header) {
  var idx = {};
  header.forEach(function (h, i) { if (!(h in idx)) idx[String(h)] = i; });
  return idx;
}

function cell_(row, idx, name) {
  return name in idx ? row[idx[name]] : '';
}

// Adds any wanted column the sheet does not have yet, at the end, so old rows keep their place.
function mergeHeader_(existing, wanted) {
  var out = existing.slice();
  wanted.forEach(function (h) { if (out.indexOf(h) < 0) out.push(h); });
  return out;
}

function rowFor_(header, record) {
  return header.map(function (h) { return hasOwn_(record, h) ? record[h] : ''; });
}

var MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function prettyDate_(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? Number(m[3]) + ' ' + MONTHS_[Number(m[2]) - 1] + ' ' + m[1] : ymd;
}

function normalizeDay_(v) {
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v || '').trim());
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

// ---------- the two checks ----------

function audienceSpec_(content, audience) {
  if (audience === 'participants') {
    return { audience: audience, file: content.participants, responses: TABS.pResponses, hasOrg: false, version: content.versions.participants };
  }
  if (audience === 'trainers') {
    return { audience: audience, file: content.trainers, responses: TABS.tResponses, hasOrg: true, version: content.versions.trainers };
  }
  return null;
}

function responseHeader_(spec) {
  var h = ['Submitted at', 'Stage', 'Cohort', 'Name'];
  if (spec.hasOrg) h.push('Organisation');
  h = h.concat(['Email', 'Score', 'Out of', 'Percent', 'Minutes', 'Submission ID']);
  spec.file.questions.forEach(function (q, i) { h.push('Q' + (i + 1) + ' correct'); });
  spec.file.questions.forEach(function (q, i) { h.push('Q' + (i + 1) + ' answer'); });
  return h;
}

function publicQuestions_(spec) {
  return spec.file.questions.map(function (q) {
    return { id: q.id, text: q.text, options: Object.keys(q.options).map(function (k) { return { id: k, text: q.options[k] }; }) };
  });
}

// Checks every field and grades the answers. Throws a user error with a plain message.
function gradeCheck_(p, spec) {
  var stage = p.stage === 'before' ? 'Before' : p.stage === 'after' ? 'After' : null;
  if (!stage) throw userError_('validation', MSG.badRequest);
  if (p.version !== undefined && p.version !== spec.version) throw userError_('stale', MSG.stale);
  if (!isSubmissionId_(p.submissionId)) throw userError_('validation', MSG.badRequest);
  var name = clean_(p.name);
  var email = clean_(p.email).toLowerCase();
  var cohort = clean_(p.cohort);
  if (cohort.length > LIMITS.cohort) throw userError_('validation', MSG.badRequest);
  if (!isFullName_(name)) throw userError_('validation', MSG.name);
  if (!isEmail_(email)) throw userError_('validation', MSG.email);
  var org = '';
  if (spec.hasOrg) {
    org = clean_(p.organisation);
    if (org.length < 2 || org.length > LIMITS.org) throw userError_('validation', MSG.org);
  }
  var answers = p.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw userError_('validation', MSG.answers);
  var score = 0, flags = [], letters = [];
  spec.file.questions.forEach(function (q) {
    var a = hasOwn_(answers, q.id) ? String(answers[q.id]) : '';
    if (!hasOwn_(q.options, a)) throw userError_('validation', MSG.answers);
    var ok = a === q.key ? 1 : 0;
    score += ok;
    flags.push(ok);
    letters.push(a);
  });
  var seconds = Number(p.seconds);
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  seconds = Math.min(seconds, 86400);
  return {
    stage: stage, cohort: cohort, name: name, email: email, org: org,
    score: score, total: spec.file.questions.length, flags: flags, letters: letters,
    minutes: Math.round(seconds / 6) / 10, submissionId: p.submissionId
  };
}

function checkRecord_(g, spec, now) {
  var r = {
    'Submitted at': now,
    'Stage': g.stage,
    'Cohort': safe_(g.cohort),
    'Name': safe_(g.name),
    'Email': safe_(g.email),
    'Score': g.score,
    'Out of': g.total,
    'Percent': g.score / g.total,
    'Minutes': g.minutes,
    'Submission ID': g.submissionId
  };
  if (spec.hasOrg) r['Organisation'] = safe_(g.org);
  g.flags.forEach(function (f, i) { r['Q' + (i + 1) + ' correct'] = f; });
  g.letters.forEach(function (a, i) { r['Q' + (i + 1) + ' answer'] = a; });
  return r;
}

function parseCheckRows_(table, spec) {
  var idx = indexOf_(table.header);
  var qn = spec.file.questions.length;
  return table.rows.map(function (v) {
    var flags = [];
    for (var i = 0; i < qn; i++) flags.push(Number(cell_(v, idx, 'Q' + (i + 1) + ' correct')) === 1 ? 1 : 0);
    var cohort = clean_(unsafe_(cell_(v, idx, 'Cohort')));
    return {
      time: toTime_(cell_(v, idx, 'Submitted at')),
      stage: String(cell_(v, idx, 'Stage')),
      cohort: cohort,
      cohortKey: cohort.toLowerCase(),
      name: clean_(unsafe_(cell_(v, idx, 'Name'))),
      org: clean_(unsafe_(cell_(v, idx, 'Organisation'))),
      email: clean_(unsafe_(cell_(v, idx, 'Email'))).toLowerCase(),
      score: Number(cell_(v, idx, 'Score')) || 0,
      flags: flags,
      submissionId: String(cell_(v, idx, 'Submission ID'))
    };
  }).filter(function (r) { return (r.stage === 'Before' || r.stage === 'After') && r.email; });
}

// The latest attempt per email, stage and cohort counts. Earlier ones stay in Responses only.
function latestAttempts_(rows) {
  var latest = {};
  rows.forEach(function (r) {
    var k = r.cohortKey + '|' + r.email + '|' + r.stage;
    if (!latest[k] || r.time >= latest[k].time) latest[k] = r;
  });
  return latest;
}

function latestScore_(rows, email, stage, cohortKey) {
  var best = null;
  rows.forEach(function (r) {
    if (r.email === email && r.stage === stage && r.cohortKey === cohortKey && (!best || r.time >= best.time)) best = r;
  });
  return best ? best.score : null;
}

function summarizeChecks_(rows, questions) {
  var latest = latestAttempts_(rows);
  var people = Object.keys(latest).map(function (k) { return latest[k]; });
  var by = { Before: [], After: [] };
  people.forEach(function (r) { by[r.stage].push(r); });
  var pairs = [];
  by.Before.forEach(function (b) {
    var a = latest[b.cohortKey + '|' + b.email + '|After'];
    if (a) pairs.push({ name: a.name || b.name, org: a.org || b.org, email: b.email, cohort: a.cohort, before: b.score, after: a.score, change: a.score - b.score });
  });
  pairs.sort(function (x, y) { return (y.change - x.change) || byName_(x.name, y.name); });
  var total = questions.length;
  var perQ = questions.map(function (q, i) {
    var pb = round2_(avg_(by.Before, function (r) { return r.flags[i]; }));
    var pa = round2_(avg_(by.After, function (r) { return r.flags[i]; }));
    return { n: i + 1, id: q.id, skill: q.skill, text: q.text, before: pb, after: pa, change: (pb === null || pa === null) ? null : round2_(pa - pb) };
  });
  var pairBefore = round1_(avg_(pairs, function (p) { return p.before; }));
  var pairAfter = round1_(avg_(pairs, function (p) { return p.after; }));
  return {
    total: total,
    before: { n: by.Before.length, avg: round1_(avg_(by.Before, function (r) { return r.score; })) },
    after: { n: by.After.length, avg: round1_(avg_(by.After, function (r) { return r.score; })) },
    pairs: pairs,
    pairBefore: pairBefore,
    pairAfter: pairAfter,
    // the gain uses the rounded averages, so the headline adds up when someone checks it
    pairGain: pairs.length ? round1_(pairAfter - pairBefore) : null,
    improved: pairs.filter(function (p) { return p.change > 0; }).length,
    same: pairs.filter(function (p) { return p.change === 0; }).length,
    lower: pairs.filter(function (p) { return p.change < 0; }).length,
    perQ: perQ
  };
}

function checksHeadline_(s) {
  var n = s.pairs.length;
  if (!n) return 'No one has taken both checks yet.';
  return 'For the ' + n + (n === 1 ? ' person' : ' people') + ' who took both: average ' + s.pairBefore.toFixed(1) +
    ' of ' + s.total + ' before, ' + s.pairAfter.toFixed(1) + ' after (' + signed1_(s.pairGain) + ' points). ' +
    s.improved + ' of ' + n + ' improved.';
}

// ---------- Config: cohort windows ----------

function parseConfig_(rows) {
  return (rows || []).map(function (r) {
    var cohort = clean_(unsafe_(r.cohort));
    return {
      cohort: cohort,
      cohortKey: cohort.toLowerCase(),
      audience: clean_(r.audience).toLowerCase(),
      opens: normalizeDay_(r.opens),
      closes: normalizeDay_(r.closes),
      status: clean_(r.status).toLowerCase()
    };
  }).filter(function (r) { return r.cohort; });
}

// Returns null when the cohort may submit, or the message to show. Cohorts not listed are open.
function windowCheck_(config, audience, cohort, today) {
  var key = clean_(cohort).toLowerCase();
  if (!key) return null;
  var row = null;
  for (var i = 0; i < config.length && !row; i++) {
    var c = config[i];
    if (c.cohortKey === key && (!c.audience || c.audience === audience)) row = c;
  }
  if (!row) return null;
  if (row.status === 'closed') return MSG.closed;
  if (row.opens && today < row.opens) return 'This check opens on ' + prettyDate_(row.opens) + '. Please ask your trainer.';
  if (row.closes && today > row.closes) return 'This check closed on ' + prettyDate_(row.closes) + '. Please ask your trainer.';
  return null;
}

// ---------- teach-back scores and readiness ----------

function scoreHeader_(rubric) {
  return ['Submitted at', 'Cohort', 'Scorer', 'Role', 'Trainee name', 'Trainee email', 'Course part']
    .concat(rubric.lines.map(function (l) { return l.name; }))
    .concat(['Comment', 'Submission ID']);
}

function parseScoreRows_(table, rubric) {
  var idx = indexOf_(table.header);
  return table.rows.map(function (v) {
    var cohort = clean_(unsafe_(cell_(v, idx, 'Cohort')));
    var lines = {};
    rubric.lines.forEach(function (l) {
      var n = Number(cell_(v, idx, l.name));
      lines[l.id] = (n >= rubric.scale.min && n <= rubric.scale.max) ? n : null;
    });
    return {
      time: toTime_(cell_(v, idx, 'Submitted at')),
      cohort: cohort,
      cohortKey: cohort.toLowerCase(),
      scorer: clean_(unsafe_(cell_(v, idx, 'Scorer'))),
      role: String(cell_(v, idx, 'Role')),
      traineeName: clean_(unsafe_(cell_(v, idx, 'Trainee name'))),
      traineeEmail: clean_(unsafe_(cell_(v, idx, 'Trainee email'))).toLowerCase(),
      part: String(cell_(v, idx, 'Course part')),
      lines: lines,
      submissionId: String(cell_(v, idx, 'Submission ID'))
    };
  }).filter(function (r) { return r.traineeEmail; });
}

// One row per trainer per cohort. Lead trainer's score where one exists, else the peers' average.
function readiness_(checkRows, scoreRows, rubric, bar) {
  var people = {};
  function person(cohort, cohortKey, email) {
    var k = cohortKey + '|' + email;
    if (!people[k]) people[k] = { cohort: cohort, cohortKey: cohortKey, email: email, name: '', org: '', nameTime: -1, before: null, after: null, scores: [] };
    return people[k];
  }
  var latest = latestAttempts_(checkRows);
  Object.keys(latest).forEach(function (k) {
    var r = latest[k];
    var p = person(r.cohort, r.cohortKey, r.email);
    if (r.stage === 'Before') p.before = r.score; else p.after = r.score;
    if (r.time >= p.nameTime) { p.name = r.name; p.org = r.org; p.nameTime = r.time; }
  });
  // the latest score from each scorer counts, so a corrected score replaces the first one
  var latestByScorer = {};
  scoreRows.forEach(function (s) {
    var k = s.cohortKey + '|' + s.traineeEmail + '|' + s.role + '|' + s.scorer.toLowerCase();
    if (!latestByScorer[k] || s.time >= latestByScorer[k].time) latestByScorer[k] = s;
  });
  Object.keys(latestByScorer).forEach(function (k) {
    var s = latestByScorer[k];
    var p = person(s.cohort, s.cohortKey, s.traineeEmail);
    p.scores.push(s);
    if (!p.name) p.name = s.traineeName;
  });
  var trainers = Object.keys(people).map(function (k) {
    var p = people[k];
    var leads = p.scores.filter(function (s) { return s.role === ROLES.lead; });
    var peers = p.scores.filter(function (s) { return s.role !== ROLES.lead; });
    var lines = {};
    rubric.lines.forEach(function (l) {
      var src = leads.filter(function (s) { return s.lines[l.id] !== null; });
      if (!src.length) src = peers.filter(function (s) { return s.lines[l.id] !== null; });
      lines[l.id] = src.length ? round1_(avg_(src, function (s) { return s.lines[l.id]; })) : null;
    });
    var ready = p.after !== null && p.after >= bar.knowledgeMin && rubric.lines.every(function (l) {
      return lines[l.id] !== null && lines[l.id] >= bar.rubricMin;
    });
    return {
      cohort: p.cohort, name: p.name, org: p.org, email: p.email,
      before: p.before, after: p.after,
      gain: (p.before !== null && p.after !== null) ? p.after - p.before : null,
      lines: lines, count: p.scores.length, ready: ready
    };
  });
  trainers.sort(function (a, b) { return byName_(a.cohort, b.cohort) || byName_(a.name, b.name); });
  return { trainers: trainers, ready: trainers.filter(function (t) { return t.ready; }).length, total: trainers.length };
}

function readinessHeadline_(r) {
  if (!r.total) return 'No trainers yet.';
  return r.ready + ' of ' + r.total + (r.total === 1 ? ' trainer meets' : ' trainers meet') + ' the readiness bar.';
}

// ---------- sheet layouts (values plus formatting instructions) ----------

function Layout_(width) {
  this.width = width;
  this.values = [];
  this.formats = [];
  this.colWidths = [];
}
Layout_.prototype.row = function (cells) {
  // names, emails and cohorts come from the public, so every text cell goes through safe_
  var r = (cells || []).slice(0, this.width).map(function (v) { return typeof v === 'string' ? safe_(v) : v; });
  while (r.length < this.width) r.push('');
  this.values.push(r);
  return this.values.length;
};
Layout_.prototype.fmt = function (r, c, nr, nc, kind) {
  if (nr > 0 && nc > 0) this.formats.push({ r: r, c: c, nr: nr, nc: nc, kind: kind });
};
Layout_.prototype.table = function (header, rows, colKinds) {
  var h = this.row(header);
  this.fmt(h, 1, 1, header.length, 'header');
  var first = this.values.length + 1;
  var self = this;
  rows.forEach(function (r) { self.row(r); });
  if (rows.length && colKinds) {
    Object.keys(colKinds).forEach(function (c) { self.fmt(first, Number(c), rows.length, 1, colKinds[c]); });
  }
  return h;
};

function blank_(v) {
  return v === null || v === undefined ? '' : v;
}

function participantSummaryLayout_(rows, questions, updated) {
  var L = new Layout_(7);
  L.colWidths = [130, 190, 420, 120, 120, 110, 110];
  L.fmt(L.row(['Participants · Summary']), 1, 1, 1, 'title');
  L.fmt(L.row(['Updated ' + updated + '. Only the latest try per person, stage and cohort counts.']), 1, 1, 1, 'muted');
  L.row([]);
  var cohorts = {}, order = [], noCohort = false;
  rows.forEach(function (r) {
    if (!r.cohortKey) { noCohort = true; return; }
    if (!cohorts[r.cohortKey]) { cohorts[r.cohortKey] = r.cohort; order.push(r.cohortKey); }
  });
  order.sort(function (a, b) { return byName_(cohorts[a], cohorts[b]); });
  participantBlock_(L, 'All participants', summarizeChecks_(rows, questions));
  order.forEach(function (k) {
    participantBlock_(L, 'Cohort: ' + cohorts[k], summarizeChecks_(rows.filter(function (r) { return r.cohortKey === k; }), questions));
  });
  if (noCohort && order.length) {
    participantBlock_(L, 'No cohort in the link', summarizeChecks_(rows.filter(function (r) { return !r.cohortKey; }), questions));
  }
  return L;
}

function participantBlock_(L, title, s) {
  L.fmt(L.row([title]), 1, 1, 1, 'blockTitle');
  L.fmt(L.row([checksHeadline_(s)]), 1, 1, L.width, 'headline');
  L.row([]);
  L.table(['Check', 'People', 'Average score', 'Average %'], [
    ['Before', s.before.n, blank_(s.before.avg), s.before.avg === null ? '' : s.before.avg / s.total],
    ['After', s.after.n, blank_(s.after.avg), s.after.avg === null ? '' : s.after.avg / s.total]
  ], { 3: 'dec1', 4: 'pct' });
  L.row([]);
  L.table(['Took both', 'Average before', 'Average after', 'Average gain', 'Improved', 'Same', 'Lower'], [
    [s.pairs.length, blank_(s.pairBefore), blank_(s.pairAfter), blank_(s.pairGain), s.improved, s.same, s.lower]
  ], { 2: 'dec1', 3: 'dec1', 4: 'dec1Change' });
  L.row([]);
  var qh = L.table(['Question', 'Skill', 'Question text', '% right before', '% right after', 'Change'],
    s.perQ.map(function (q) { return ['Q' + q.n, q.skill, q.text, blank_(q.before), blank_(q.after), blank_(q.change)]; }),
    { 4: 'pct', 5: 'pct', 6: 'pctChange' });
  L.fmt(qh + 1, 3, s.perQ.length, 1, 'wrap');
  L.row([]);
  L.table(['Name', 'Email', 'Before', 'After', 'Change'],
    s.pairs.map(function (p) { return [p.name, p.email, p.before, p.after, p.change]; }),
    { 5: 'intChange' });
  L.row([]);
  L.row([]);
}

function readinessLayout_(r, knowledge, bar, barStatus, outOf, rubric, updated) {
  var lineNames = rubric.lines.map(function (l) { return l.name; });
  var header = ['Cohort', 'Name', 'Organisation', 'Email', 'Knowledge before', 'Knowledge after', 'Knowledge gain']
    .concat(lineNames).concat(['Number of scores', 'Ready to deliver alone']);
  var L = new Layout_(header.length);
  L.colWidths = [110, 180, 180, 220, 100, 100, 100].concat(lineNames.map(function () { return 100; })).concat([100, 190]);
  L.fmt(L.row(['Trainers · Readiness']), 1, 1, 1, 'title');
  L.fmt(L.row([readinessHeadline_(r)]), 1, 1, L.width, 'headline');
  L.fmt(L.row(['The bar: knowledge check after at least ' + bar.knowledgeMin + ' of ' + outOf +
    ', and every teach-back line at least ' + bar.rubricMin + ' of ' + rubric.scale.max + '.' +
    (barStatus ? ' ' + barStatus + '.' : '')]), 1, 1, 1, 'muted');
  L.fmt(L.row([knowledgeLine_(knowledge)]), 1, 1, 1, 'muted');
  L.fmt(L.row(['Updated ' + updated + '. Teach-back lines use the lead trainer\'s score where there is one, otherwise the average of the peers\' scores.']), 1, 1, 1, 'muted');
  L.row([]);
  var first = L.values.length + 2;
  L.table(header, r.trainers.map(function (t) {
    return [t.cohort, t.name, t.org, t.email, blank_(t.before), blank_(t.after), blank_(t.gain)]
      .concat(rubric.lines.map(function (l) { return blank_(t.lines[l.id]); }))
      .concat([t.count, t.ready ? READY_YES : READY_NO]);
  }), { 7: 'intChange' });
  if (r.trainers.length) {
    L.fmt(first, 8, r.trainers.length, lineNames.length, 'dec1');
    L.fmt(first, header.length, r.trainers.length, 1, 'ready');
  }
  return L;
}

function knowledgeLine_(s) {
  var n = s.pairs.length;
  if (!n) return 'Knowledge check: no trainer has taken both yet.';
  return 'Knowledge check: for the ' + n + (n === 1 ? ' trainer' : ' trainers') + ' who took both, average ' +
    s.pairBefore.toFixed(1) + ' of ' + s.total + ' before, ' + s.pairAfter.toFixed(1) + ' after (' + signed1_(s.pairGain) + ' points).';
}

// ---------- scorer code ----------

function sameCode_(a, b) {
  a = String(a).toLowerCase();
  b = String(b).toLowerCase();
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function checkCode_(p, deps) {
  var device = String(p.device || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64) || 'unknown';
  if (deps.cache.get('codelock:' + device)) throw userError_('wait', MSG.wait);
  var real = clean_(deps.props.get('SCORER_CODE'));
  if (!real) throw userError_('nocode', MSG.noCode);
  var given = clean_(p.code).slice(0, LIMITS.code);
  // a burst of wrong guesses from anywhere pauses checking for everyone, the right code included
  if (deps.cache.get('codelock:all')) throw userError_('wait', MSG.wait);
  if (given && sameCode_(given, real)) {
    deps.cache.remove('codetries:' + device);
    return;
  }
  // counted under the write lock, so parallel guesses cannot all read the same count
  var locked = deps.store.withLock(function () {
    var n = Number(deps.cache.get('codetries:' + device) || 0) + 1;
    if (n >= CODE_TRIES) {
      deps.cache.put('codelock:' + device, '1', CODE_WAIT_SECONDS);
      deps.cache.remove('codetries:' + device);
    } else {
      deps.cache.put('codetries:' + device, String(n), 600);
    }
    var all = Number(deps.cache.get('codetries:all') || 0) + 1;
    if (all >= CODE_TRIES_ALL) {
      deps.cache.put('codelock:all', '1', CODE_WAIT_SECONDS);
      deps.cache.remove('codetries:all');
    } else {
      deps.cache.put('codetries:all', String(all), 300);
    }
    return n >= CODE_TRIES;
  });
  if (locked) throw userError_('wait', MSG.wait);
  throw userError_('code', MSG.code);
}

// ---------- the API ----------

function handle_(payload, deps) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw userError_('validation', MSG.badRequest);
    // hidden field that people never see; only bots fill it
    if (clean_(payload.website)) throw userError_('validation', MSG.badRequest);
    switch (payload.action) {
      case 'getQuestions': return getQuestions_(payload, deps);
      case 'submitCheck': return submitCheck_(payload, deps);
      case 'listTrainees': return listTrainees_(payload, deps);
      case 'submitScore': return submitScore_(payload, deps);
      default: throw userError_('validation', MSG.badRequest);
    }
  } catch (err) {
    if (err && err.userCode) return { ok: false, code: err.userCode, error: err.message };
    if (deps && deps.log) deps.log(err);
    return { ok: false, code: 'server', error: MSG.generic };
  }
}

function getQuestions_(p, deps) {
  var spec = audienceSpec_(deps.content, p.audience);
  if (!spec) throw userError_('validation', MSG.badRequest);
  return { ok: true, audience: spec.audience, version: spec.version, questions: publicQuestions_(spec) };
}

function submitCheck_(p, deps) {
  var spec = audienceSpec_(deps.content, p.audience);
  if (!spec) throw userError_('validation', MSG.badRequest);
  var g = gradeCheck_(p, spec);
  var closed = windowCheck_(parseConfig_(deps.store.readConfig()), spec.audience, g.cohort, deps.today());
  if (closed) throw userError_('closed', closed);
  var result = deps.store.withLock(function () {
    var rows = parseCheckRows_(deps.store.read(spec.responses), spec);
    var mine = null, duplicate = false;
    rows.forEach(function (r) { if (r.submissionId === g.submissionId) mine = r; });
    if (mine) {
      duplicate = true;
    } else {
      var now = deps.now();
      deps.store.append(spec.responses, responseHeader_(spec), checkRecord_(g, spec, now));
      deps.props.set(DIRTY[spec.audience], '1');
      mine = { stage: g.stage, cohortKey: g.cohort.toLowerCase(), email: g.email, score: g.score, time: now.getTime() };
    }
    return {
      ok: true,
      score: mine.score,
      total: spec.file.questions.length,
      before: mine.stage === 'After' ? latestScore_(rows, mine.email, 'Before', mine.cohortKey) : null,
      duplicate: duplicate
    };
  });
  refreshIfDirty_(deps);
  return result;
}

function traineeId_(deps, cohortKey, email) {
  return deps.hash(cohortKey + '|' + email).slice(0, 16);
}

function traineeList_(deps, cohort) {
  var spec = audienceSpec_(deps.content, 'trainers');
  var key = clean_(cohort).toLowerCase();
  var rows = parseCheckRows_(deps.store.read(spec.responses), spec).filter(function (r) { return r.cohortKey === key; });
  var latest = {};
  rows.forEach(function (r) { if (!latest[r.email] || r.time >= latest[r.email].time) latest[r.email] = r; });
  return Object.keys(latest).map(function (email) {
    var r = latest[email];
    return { id: traineeId_(deps, key, email), name: r.name, organisation: r.org, email: email };
  }).sort(function (a, b) { return byName_(a.name, b.name) || byName_(a.organisation, b.organisation); });
}

function listTrainees_(p, deps) {
  checkCode_(p, deps);
  var cohort = clean_(p.cohort);
  if (cohort.length > LIMITS.cohort) throw userError_('validation', MSG.badRequest);
  // the page gets names and organisations only; emails stay on the server
  return {
    ok: true,
    trainees: traineeList_(deps, cohort).map(function (t) { return { id: t.id, name: t.name, organisation: t.organisation }; })
  };
}

function submitScore_(p, deps) {
  checkCode_(p, deps);
  var rubric = deps.content.rubric;
  if (!isSubmissionId_(p.submissionId)) throw userError_('validation', MSG.badRequest);
  var cohort = clean_(p.cohort);
  if (cohort.length > LIMITS.cohort) throw userError_('validation', MSG.badRequest);
  var scorer = clean_(p.scorer);
  if (scorer.length < 2 || scorer.length > LIMITS.scorer) throw userError_('validation', MSG.scorer);
  var role = ROLES[p.role];
  if (!hasOwn_(ROLES, p.role)) throw userError_('validation', MSG.role);
  var part = String(p.part || '');
  if (rubric.course_parts.indexOf(part) < 0) throw userError_('validation', MSG.part);
  var trainee = p.trainee;
  if (!trainee || typeof trainee !== 'object') throw userError_('validation', MSG.trainee);
  var scores = p.scores;
  var values = {};
  rubric.lines.forEach(function (l) {
    var v = scores && typeof scores === 'object' && hasOwn_(scores, l.id) ? scores[l.id] : null;
    if (typeof v !== 'number' || Math.floor(v) !== v || v < rubric.scale.min || v > rubric.scale.max) throw userError_('validation', MSG.scores);
    values[l.name] = v;
  });
  var comment = cleanMultiline_(p.comment);
  if (comment.length > LIMITS.comment) throw userError_('validation', MSG.comment);
  var closed = windowCheck_(parseConfig_(deps.store.readConfig()), 'trainers', cohort, deps.today());
  if (closed) throw userError_('closed', closed);

  var result = deps.store.withLock(function () {
    var name, email;
    if (trainee.id !== undefined && trainee.id !== null && trainee.id !== '') {
      var found = null;
      traineeList_(deps, cohort).forEach(function (t) { if (t.id === String(trainee.id)) found = t; });
      if (!found) throw userError_('validation', MSG.traineeGone);
      name = found.name;
      email = found.email;
    } else {
      name = clean_(trainee.name);
      email = clean_(trainee.email).toLowerCase();
      if (!isFullName_(name)) throw userError_('validation', MSG.traineeName);
      if (!isEmail_(email)) throw userError_('validation', MSG.traineeEmail);
    }
    var table = deps.store.read(TABS.tScores);
    var idx = indexOf_(table.header);
    var duplicate = table.rows.some(function (v) { return String(cell_(v, idx, 'Submission ID')) === p.submissionId; });
    if (!duplicate) {
      var record = {
        'Submitted at': deps.now(),
        'Cohort': safe_(cohort),
        'Scorer': safe_(scorer),
        'Role': role,
        'Trainee name': safe_(name),
        'Trainee email': safe_(email),
        'Course part': safe_(part),
        'Comment': safe_(comment),
        'Submission ID': p.submissionId
      };
      Object.keys(values).forEach(function (k) { record[k] = values[k]; });
      deps.store.append(TABS.tScores, scoreHeader_(rubric), record);
      deps.props.set(DIRTY.trainers, '1');
    }
    return { ok: true, trainee: name, duplicate: duplicate };
  });
  refreshIfDirty_(deps);
  return result;
}

// Removes the rows of the cohort called TEST from every data tab. Menu only, never the public API.
function deleteTestRows_(deps) {
  var isTest = function (row, idx) { return clean_(unsafe_(cell_(row, idx, 'Cohort'))).toLowerCase() === 'test'; };
  var counts = deps.store.withLock(function () {
    return {
      participants: deps.store.deleteRows(TABS.pResponses, isTest),
      trainers: deps.store.deleteRows(TABS.tResponses, isTest),
      teachBacks: deps.store.deleteRows(TABS.tScores, isTest)
    };
  });
  deps.props.set(DIRTY.participants, '1');
  deps.props.set(DIRTY.trainers, '1');
  refreshIfDirty_(deps);
  return counts;
}

// ---------- rebuilding the summary tabs ----------

function numberProp_(deps, name, fallback) {
  var v = deps.props.get(name);
  if (v === null || v === undefined || String(v).trim() === '') return fallback;
  var n = Number(v);
  return isFinite(n) ? n : fallback;
}

// Thresholds live in Script Properties because YGA has not confirmed them; the rubric file gives the defaults.
function readinessBar_(deps) {
  var bar = deps.content.rubric.readiness_bar;
  return {
    knowledgeMin: numberProp_(deps, 'READY_KNOWLEDGE_MIN', bar.knowledge_after_min),
    rubricMin: numberProp_(deps, 'READY_RUBRIC_MIN', bar.every_rubric_line_min)
  };
}

function rebuildParticipants_(deps) {
  var spec = audienceSpec_(deps.content, 'participants');
  var rows = parseCheckRows_(deps.store.read(spec.responses), spec);
  deps.store.writeLayout(TABS.pSummary, participantSummaryLayout_(rows, spec.file.questions, deps.stamp(deps.now())));
}

function rebuildReadiness_(deps) {
  var spec = audienceSpec_(deps.content, 'trainers');
  var rubric = deps.content.rubric;
  var checks = parseCheckRows_(deps.store.read(spec.responses), spec);
  var scores = parseScoreRows_(deps.store.read(TABS.tScores), rubric);
  var bar = readinessBar_(deps);
  var r = readiness_(checks, scores, rubric, bar);
  var knowledge = summarizeChecks_(checks, spec.file.questions);
  deps.store.writeLayout(TABS.tReadiness, readinessLayout_(r, knowledge, bar, rubric.readiness_bar.status,
    spec.file.questions.length, rubric, deps.stamp(deps.now())));
}

function rebuildAll_(deps) {
  rebuildParticipants_(deps);
  rebuildReadiness_(deps);
}

// One request at a time rebuilds; others leave a flag that the rebuilding request picks up.
// A failure here never turns a saved answer into an error for the person who sent it.
function refreshIfDirty_(deps) {
  try {
    deps.store.trySummaryLock(function () {
      for (var i = 0; i < 5; i++) {
        var p = deps.props.get(DIRTY.participants) === '1';
        var t = deps.props.get(DIRTY.trainers) === '1';
        if (!p && !t) return;
        if (p) {
          deps.props.set(DIRTY.participants, '0');
          try { rebuildParticipants_(deps); } catch (e) { deps.props.set(DIRTY.participants, '1'); if (deps.log) deps.log(e); return; }
        }
        if (t) {
          deps.props.set(DIRTY.trainers, '0');
          try { rebuildReadiness_(deps); } catch (e) { deps.props.set(DIRTY.trainers, '1'); if (deps.log) deps.log(e); return; }
        }
      }
    });
  } catch (e) {
    if (deps.log) deps.log(e);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TABS: TABS, TAB_ORDER: TAB_ORDER, CONFIG_HEADER: CONFIG_HEADER, MSG: MSG, MAX_BODY: MAX_BODY, ROLES: ROLES,
    READY_YES: READY_YES, READY_NO: READY_NO,
    clean_: clean_, safe_: safe_, unsafe_: unsafe_, isFullName_: isFullName_, isEmail_: isEmail_,
    mergeHeader_: mergeHeader_, rowFor_: rowFor_, indexOf_: indexOf_, prettyDate_: prettyDate_, normalizeDay_: normalizeDay_,
    audienceSpec_: audienceSpec_, responseHeader_: responseHeader_, gradeCheck_: gradeCheck_, checkRecord_: checkRecord_,
    parseCheckRows_: parseCheckRows_, latestAttempts_: latestAttempts_, latestScore_: latestScore_,
    summarizeChecks_: summarizeChecks_, checksHeadline_: checksHeadline_,
    parseConfig_: parseConfig_, windowCheck_: windowCheck_,
    scoreHeader_: scoreHeader_, parseScoreRows_: parseScoreRows_, readiness_: readiness_, readinessHeadline_: readinessHeadline_,
    participantSummaryLayout_: participantSummaryLayout_, readinessLayout_: readinessLayout_, knowledgeLine_: knowledgeLine_,
    sameCode_: sameCode_, deleteTestRows_: deleteTestRows_, signed1_: signed1_, handle_: handle_, rebuildAll_: rebuildAll_, readinessBar_: readinessBar_
  };
}
