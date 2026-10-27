// The shared check flow: participants (/check) and trainers (/trainer) use this with their own content and copy.
import { api, type ApiResult } from './api';
import {
  $, input, setText, shuffle, uuid, store, param, cohortFromLink, cleanText, isFullName, isEmail, show,
} from './util';

type Stage = 'before' | 'after';

export interface CheckCopy {
  chooserEyebrow: string;
  chooser: Record<Stage, string>;
  stages: Record<Stage, { label: string; intro: string }>;
  noteHtml: string; // fixed, trusted copy
  doneBefore: string;
  doneAfter: string;
  startLabel: string; // "Start of course"
  orgLabel?: string;
  orgHint?: string;
}

export interface CheckConfig {
  audience: 'participants' | 'trainers';
  content: PublicQuestionSet;
  copy: CheckCopy;
  askOrg: boolean;
}

interface Saved {
  name: string;
  email: string;
  org: string;
  order: string[];
  opts: Record<string, string[]>;
  i: number;
  answers: Record<string, string>;
  t0: number;
  submissionId: string;
  version: string;
}

const SECTIONS = ['s-choose', 's-start', 's-q', 's-save', 's-fail', 's-done'];
const MSG = {
  name: 'Please write your full name (first and last).',
  email: 'Please write a valid email. Use the same one at the start and the end.',
  org: 'Please write the name of your organisation.',
  network: 'Check your internet connection, then try again. Your answers are still here.',
};

function markup(c: CheckConfig): string {
  const org = c.askOrg
    ? `<label class="field" for="org">${c.copy.orgLabel}</label>
       <p class="hint" id="orgHint">${c.copy.orgHint}</p>
       <input type="text" id="org" autocomplete="organization" maxlength="100" aria-describedby="orgHint">`
    : '';
  return `
  <section id="s-choose" class="hidden">
    <div class="eyebrow">${c.copy.chooserEyebrow}</div>
    <h1>Winning with <em>AI</em></h1>
    <p class="lead">Which check are you taking?</p>
    <div class="stack">
      <button type="button" class="btn" data-stage="before">${c.copy.chooser.before}</button>
      <button type="button" class="btn" data-stage="after">${c.copy.chooser.after}</button>
    </div>
  </section>

  <section id="s-start" class="hidden">
    <form id="startForm" novalidate>
      <div class="eyebrow" id="stageLabel"></div>
      <h1>Winning with <em>AI</em></h1>
      <p class="lead" id="intro"></p>
      <div class="note">${c.copy.noteHtml}</div>
      <label class="field" for="name">Your full name</label>
      <input type="text" id="name" autocomplete="name" maxlength="80">
      <label class="field" for="email">Your email</label>
      <input type="email" id="email" autocomplete="email" maxlength="120" inputmode="email" autocapitalize="none" spellcheck="false">
      ${org}
      <div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input type="text" id="website" tabindex="-1" autocomplete="off"></div>
      <div class="err" id="startErr" role="alert"></div>
      <button type="submit" class="btn">Start</button>
    </form>
  </section>

  <section id="s-q" class="hidden">
    <form id="qForm" novalidate>
      <div class="progress"><span id="qCount"></span><div class="bar" aria-hidden="true"><b id="qBar"></b></div></div>
      <h2 class="qtext" id="qText" tabindex="-1"></h2>
      <div class="opts" id="qOpts" role="radiogroup" aria-labelledby="qText"></div>
      <div class="row">
        <button type="button" class="link" id="backBtn">Back</button>
        <button type="submit" class="btn" id="nextBtn" disabled>Next</button>
      </div>
    </form>
  </section>

  <section id="s-save" class="hidden center" role="status" aria-live="polite">
    <div class="spin" aria-hidden="true"></div>
    <p>Saving your answers…</p>
  </section>

  <section id="s-fail" class="hidden center">
    <h2 id="failTitle" tabindex="-1">Your answers were not saved yet</h2>
    <p class="lead" id="failMsg" role="alert"></p>
    <div class="stack center-row">
      <button type="button" class="btn" id="retryBtn">Try again</button>
      <button type="button" class="link" id="reviewBtn">Back to the questions</button>
    </div>
  </section>

  <section id="s-done" class="hidden center">
    <div class="eyebrow">Thank you</div>
    <h2 id="doneTitle" tabindex="-1"></h2>
    <div id="doneBody"></div>
  </section>`;
}

export function runCheck(c: CheckConfig): void {
  const app = $('app');
  app.innerHTML = markup(c);
  const questions = c.content.questions;
  const byId: Record<string, PublicQuestion> = {};
  questions.forEach((q) => (byId[q.id] = q));
  const n = questions.length;
  const cohort = cohortFromLink();
  let stage: Stage | null = null;
  let s: Saved | null = null;
  let sending = false;

  const key = () => `wwai:v1:${c.audience}:${stage}:${cohort}`;
  const save = () => s && store.set('session', key(), s);

  // ---------- stage ----------
  function setStage(st: Stage, focus: boolean) {
    stage = st;
    setText($('stageLabel'), c.copy.stages[st].label);
    setText($('intro'), c.copy.stages[st].intro);
    const saved = store.get<Saved>('session', key());
    if (saved && isUsable(saved)) {
      s = saved;
      renderQ(false);
      return;
    }
    show(SECTIONS, 's-start');
    if (focus) input('name').focus();
  }

  function isUsable(x: Saved): boolean {
    return Array.isArray(x.order) && x.order.length === n && x.order.every((id) => byId[id]) &&
      typeof x.i === 'number' && x.i >= 0 && x.i < n && !!x.submissionId && x.version === c.content.version;
  }

  const fromLink = param('stage').toLowerCase();
  if (fromLink === 'before' || fromLink === 'after') {
    setStage(fromLink, false);
  } else {
    show(SECTIONS, 's-choose');
  }
  app.querySelectorAll<HTMLButtonElement>('#s-choose [data-stage]').forEach((b) => {
    b.addEventListener('click', () => {
      const st = b.dataset.stage as Stage;
      const url = new URL(window.location.href);
      url.searchParams.set('stage', st);
      try { window.history.replaceState(null, '', url.toString()); } catch { /* fine */ }
      setStage(st, true);
    });
  });

  // ---------- start ----------
  $('startForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('startErr');
    const nameEl = input('name'), emailEl = input('email');
    const orgEl = c.askOrg ? input('org') : null;
    [nameEl, emailEl, orgEl].forEach((x) => {
      if (!x) return;
      x.removeAttribute('aria-invalid');
      if (x === orgEl) x.setAttribute('aria-describedby', 'orgHint');
      else x.removeAttribute('aria-describedby');
    });
    const name = cleanText(nameEl.value);
    const email = cleanText(emailEl.value).toLowerCase();
    const org = orgEl ? cleanText(orgEl.value) : '';
    const fail = (el: HTMLInputElement, msg: string) => {
      setText(err, msg);
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', el === orgEl ? 'orgHint startErr' : 'startErr');
      el.focus();
    };
    if (!isFullName(name)) return fail(nameEl, MSG.name);
    if (!isEmail(email)) return fail(emailEl, MSG.email);
    if (orgEl && (org.length < 2 || org.length > 100)) return fail(orgEl, MSG.org);
    setText(err, '');
    const opts: Record<string, string[]> = {};
    questions.forEach((q) => (opts[q.id] = shuffle(q.options.map((o) => o.id))));
    s = {
      name, email, org,
      order: shuffle(questions.map((q) => q.id)),
      opts, i: 0, answers: {}, t0: Date.now(), submissionId: uuid(), version: c.content.version,
    };
    save();
    renderQ(true);
  });

  // ---------- questions ----------
  function renderQ(focus: boolean) {
    if (!s) return;
    const q = byId[s.order[s.i]];
    setText($('qCount'), `Question ${s.i + 1} of ${n}`);
    ($('qBar') as HTMLElement).style.width = Math.round((100 * s.i) / n) + '%';
    setText($('qText'), q.text);
    const box = $('qOpts');
    box.innerHTML = '';
    const order = s.opts[q.id] && s.opts[q.id].length === q.options.length ? s.opts[q.id] : q.options.map((o) => o.id);
    order.forEach((oid) => {
      const o = q.options.find((x) => x.id === oid);
      if (!o) return;
      const lab = document.createElement('label');
      lab.className = 'opt' + (s!.answers[q.id] === o.id ? ' on' : '');
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'opt';
      inp.value = o.id;
      inp.checked = s!.answers[q.id] === o.id;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.setAttribute('aria-hidden', 'true');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = o.text;
      lab.append(inp, dot, t);
      inp.addEventListener('change', () => {
        s!.answers[q.id] = o.id;
        save();
        box.querySelectorAll('.opt').forEach((x) => x.classList.toggle('on', x === lab));
        (document.getElementById('nextBtn') as HTMLButtonElement).disabled = false;
      });
      box.appendChild(lab);
    });
    const next = $('nextBtn') as HTMLButtonElement;
    next.disabled = !s.answers[q.id];
    setText(next, s.i === n - 1 ? 'Submit' : 'Next');
    ($('backBtn') as HTMLElement).style.visibility = s.i === 0 ? 'hidden' : 'visible';
    show(SECTIONS, 's-q');
    if (focus) $('qText').focus({ preventScroll: true });
  }

  $('qForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!s || !s.answers[s.order[s.i]]) return;
    if (s.i < n - 1) {
      s.i++;
      save();
      renderQ(true);
    } else {
      submit();
    }
  });
  $('backBtn').addEventListener('click', () => {
    if (s && s.i > 0) {
      s.i--;
      save();
      renderQ(true);
    }
  });

  // ---------- submit ----------
  async function submit() {
    if (!s || sending || !stage) return;
    sending = true;
    show(SECTIONS, 's-save');
    const payload = {
      action: 'submitCheck',
      audience: c.audience,
      version: c.content.version,
      stage,
      cohort,
      name: s.name,
      email: s.email,
      ...(c.askOrg ? { organisation: s.org } : {}),
      answers: s.answers,
      seconds: Math.round((Date.now() - s.t0) / 1000),
      submissionId: s.submissionId,
      website: input('website').value,
    };
    const r = await api(payload);
    sending = false;
    if (r.ok) return done(r);
    setText($('failMsg'), r.code === 'network' ? MSG.network : r.error);
    show(SECTIONS, 's-fail');
    $('failTitle').focus({ preventScroll: true });
  }
  $('retryBtn').addEventListener('click', () => void submit());
  $('reviewBtn').addEventListener('click', () => renderQ(true));

  // ---------- done ----------
  function done(r: ApiResult) {
    if (!s || !r.ok) return;
    const first = s.name.split(' ')[0];
    setText($('doneTitle'), `Thank you, ${first}. Your answers are saved.`);
    const body = $('doneBody');
    body.innerHTML = '';
    if (stage === 'before') {
      const p = document.createElement('p');
      p.textContent = c.copy.doneBefore;
      body.appendChild(p);
    } else {
      const total = Number(r.total);
      const cmp = document.createElement('div');
      cmp.className = 'cmp';
      const cell = (label: string, val: string) => {
        const d = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = val;
        const sp = document.createElement('span');
        sp.textContent = label;
        d.append(b, sp);
        return d;
      };
      if (typeof r.before === 'number') cmp.appendChild(cell(c.copy.startLabel, `${r.before} / ${total}`));
      cmp.appendChild(cell('Today', `${Number(r.score)} / ${total}`));
      body.appendChild(cmp);
      if (c.copy.doneAfter) {
        const p2 = document.createElement('p');
        p2.textContent = c.copy.doneAfter;
        body.appendChild(p2);
      }
    }
    store.remove('session', key());
    s = null;
    show(SECTIONS, 's-done');
    $('doneTitle').focus({ preventScroll: true });
  }
}
