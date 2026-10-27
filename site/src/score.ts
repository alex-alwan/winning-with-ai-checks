// Teach-back scoring (/trainer/score). Nothing shows until the server accepts the scorer code.
import './styles.css';
import rubric from 'virtual:rubric';
import { api, type ApiResult } from './api';
import { $, input, setText, uuid, store, cohortFromLink, cleanText, isFullName, isEmail, show, deviceId } from './util';

interface Trainee {
  id: string;
  name: string;
  organisation: string;
}

interface Scorer {
  scorer: string;
  role: string;
  part: string;
}

const SECTIONS = ['s-gate', 's-form'];
const cohort = cohortFromLink();
const KEY_CODE = `wwai:v1:score-code:${cohort}`;
const KEY_SCORER = `wwai:v1:scorer:${cohort}`;
const KEY_SCORED = `wwai:v1:scored:${cohort}`;
const scored = (): string[] => store.get<string[]>('session', KEY_SCORED) || [];
const NETWORK = 'Your score was not saved yet. Check your internet connection, then try again. Everything you entered is still here.';
const ERR = {
  scorer: 'Please write your name.',
  role: 'Please choose your role.',
  part: 'Please choose the course part they taught.',
  trainee: 'Please choose the trainer you are scoring.',
  traineeName: "Please write the trainer's full name (first and last).",
  traineeEmail: "Please write the trainer's email.",
  scores: 'Please choose a score from 1 to 4 for every line.',
};

let code = '';
let submissionId = uuid();
let typing = false;
let saving = false;
let lastFailed = false; // after a failed save, any change makes it a new submission

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function markup(): string {
  const parts = rubric.parts.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const scale: number[] = [];
  for (let v = rubric.scale.min; v <= rubric.scale.max; v++) scale.push(v);
  const lines = rubric.lines.map((l) => `
    <fieldset class="line" id="line-${l.id}" aria-describedby="four-${l.id}">
      <legend>${esc(l.name)}</legend>
      <p class="four" id="four-${l.id}"><b>A ${rubric.scale.max} looks like:</b> ${esc(l.four)}</p>
      <div class="scale">${scale.map((v) => `<label class="sc"><input type="radio" name="line-${l.id}" value="${v}"><span>${v}</span></label>`).join('')}</div>
    </fieldset>`).join('');
  const group = cohort ? `<p class="lead">Group: <b>${esc(cohort)}</b></p>` : '';
  return `
  <section id="s-gate" class="hidden">
    <div class="eyebrow">Teach-back scoring</div>
    <h1>Winning with <em>AI</em></h1>
    ${group}
    <form id="gateForm" novalidate>
      <label class="field" for="code">Scorer code</label>
      <p class="hint" id="codeHint">The lead trainer gives you this code.</p>
      <input type="text" id="code" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="40" aria-describedby="codeHint">
      <div class="err" id="gateErr" role="alert"></div>
      <button type="submit" class="btn" id="gateBtn">Continue</button>
    </form>
  </section>

  <section id="s-form" class="hidden">
    <div class="eyebrow">Teach-back scoring</div>
    <h1>Winning with <em>AI</em></h1>
    ${group}
    <form id="scoreForm" novalidate>
      <fieldset class="block">
        <legend>About you</legend>
        <label class="field" for="scorer">Your name</label>
        <input type="text" id="scorer" autocomplete="name" maxlength="80">
        <fieldset class="sub" id="roleBox">
          <legend class="field">Your role</legend>
          <div class="pair">
            <label class="opt"><input type="radio" name="role" value="lead"><span class="dot" aria-hidden="true"></span><span class="t">Lead trainer</span></label>
            <label class="opt"><input type="radio" name="role" value="peer"><span class="dot" aria-hidden="true"></span><span class="t">Peer</span></label>
          </div>
        </fieldset>
      </fieldset>

      <div class="saved hidden" id="savedMsg" role="status" tabindex="-1"></div>
      <fieldset class="block" id="traineeBlock">
        <legend>The trainer you are scoring</legend>
        <div id="pickBox">
          <label class="field" for="trainee">Name</label>
          <select id="trainee"><option value="">Choose a name</option></select>
          <p class="hint hidden" id="traineeEmpty">No one in this group has taken the trainer check yet. Type their name instead.</p>
          <div class="links">
            <button type="button" class="link" id="refreshBtn">Refresh the list</button>
            <button type="button" class="link" id="typeBtn">Someone is missing? Type their name</button>
          </div>
        </div>
        <div id="typeBox" class="hidden">
          <label class="field" for="tName">Their full name</label>
          <input type="text" id="tName" maxlength="80" autocomplete="off">
          <label class="field" for="tEmail">Their email</label>
          <p class="hint" id="tEmailHint">The email they used for the trainer check, if they took it.</p>
          <input type="email" id="tEmail" maxlength="120" inputmode="email" autocapitalize="none" spellcheck="false" autocomplete="off" aria-describedby="tEmailHint">
          <div class="links"><button type="button" class="link" id="pickBtn">Choose from the list instead</button></div>
        </div>
        <label class="field" for="part">Course part they taught</label>
        <select id="part"><option value="">Choose a part</option>${parts}</select>
      </fieldset>

      <fieldset class="block">
        <legend>Scores</legend>
        <p class="hint">Choose 1, 2, 3 or 4 for each line. All four are needed.</p>
        ${lines}
      </fieldset>

      <div class="block">
        <label class="field" for="comment">Comment (optional)</label>
        <textarea id="comment" rows="4" maxlength="500" aria-describedby="commentCount"></textarea>
        <div class="count" id="commentCount" aria-live="polite">0 of 500 characters</div>
      </div>

      <div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input type="text" id="website" tabindex="-1" autocomplete="off"></div>
      <div class="err" id="formErr"></div>
      <button type="submit" class="btn" id="saveBtn">Save score</button>
    </form>
  </section>`;
}

$('app').innerHTML = markup();

// ---------- the code gate ----------

function gateError(r: ApiResult) {
  if (r.ok) return;
  const btn = $('gateBtn') as HTMLButtonElement;
  setText($('gateErr'), r.code === 'network' ? 'Check your internet connection, then try again.' : r.error);
  input('code').setAttribute('aria-invalid', 'true');
  input('code').focus();
  if (r.code === 'wait') {
    btn.disabled = true;
    window.setTimeout(() => {
      btn.disabled = false;
      setText($('gateErr'), '');
    }, 30000);
  }
}

async function loadTrainees(r?: ApiResult): Promise<boolean> {
  const res = r || (await api({ action: 'listTrainees', code, cohort, device: deviceId() }));
  if (!res.ok) {
    if (['code', 'wait', 'nocode'].includes(res.code)) {
      backToGate(res);
    } else {
      setText($('formErr'), res.code === 'network' ? 'The list did not load. Check your internet connection, then try again.' : res.error);
    }
    return false;
  }
  const list = (res.trainees as Trainee[]) || [];
  const sel = $('trainee') as HTMLSelectElement;
  const keep = sel.value;
  sel.innerHTML = '<option value="">Choose a name</option>';
  // people this scorer already scored go last and say so; a rescore is still allowed
  const done = scored();
  const ordered = list.filter((t) => !done.includes(t.id)).concat(list.filter((t) => done.includes(t.id)));
  ordered.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = (t.organisation ? `${t.name} · ${t.organisation}` : t.name) + (done.includes(t.id) ? ' · scored' : '');
    sel.appendChild(o);
  });
  if (keep && ordered.some((t) => t.id === keep)) sel.value = keep;
  $('traineeEmpty').classList.toggle('hidden', list.length > 0);
  return true;
}

function backToGate(r: ApiResult) {
  code = '';
  store.remove('session', KEY_CODE);
  show(SECTIONS, 's-gate');
  gateError(r);
}

$('gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('gateBtn') as HTMLButtonElement;
  const given = cleanText(input('code').value);
  input('code').removeAttribute('aria-invalid');
  if (!given) {
    setText($('gateErr'), 'Please type the scorer code.');
    input('code').focus();
    return;
  }
  btn.disabled = true;
  setText(btn, 'Checking…');
  const r = await api({ action: 'listTrainees', code: given, cohort, device: deviceId() });
  btn.disabled = false;
  setText(btn, 'Continue');
  if (!r.ok) return gateError(r);
  code = given;
  store.set('session', KEY_CODE, code);
  setText($('gateErr'), '');
  await loadTrainees(r);
  openForm();
});

function openForm() {
  show(SECTIONS, 's-form');
  const saved = store.get<Scorer>('session', KEY_SCORER);
  if (saved) {
    input('scorer').value = saved.scorer || '';
    const role = document.querySelector<HTMLInputElement>(`input[name="role"][value="${saved.role}"]`);
    if (role) role.checked = true;
    if (rubric.parts.includes(saved.part)) ($('part') as HTMLSelectElement).value = saved.part;
  }
  syncOn();
  input('scorer').focus();
}

// ---------- the form ----------

function setTyping(on: boolean) {
  typing = on;
  $('pickBox').classList.toggle('hidden', on);
  $('typeBox').classList.toggle('hidden', !on);
  (on ? input('tName') : ($('trainee') as HTMLSelectElement)).focus();
}
$('typeBtn').addEventListener('click', () => setTyping(true));
$('pickBtn').addEventListener('click', () => setTyping(false));
$('refreshBtn').addEventListener('click', async () => {
  const b = $('refreshBtn') as HTMLButtonElement;
  b.disabled = true;
  setText(b, 'Refreshing…');
  if (await loadTrainees()) setText($('formErr'), '');
  b.disabled = false;
  setText(b, 'Refresh the list');
});

// the selected look for the role and score cards
function syncOn() {
  document.querySelectorAll<HTMLLabelElement>('#s-form label.opt, #s-form label.sc').forEach((l) => {
    const i = l.querySelector('input');
    l.classList.toggle('on', !!i && i.checked);
  });
}
$('scoreForm').addEventListener('change', () => {
  syncOn();
  clearErrors();
  if (lastFailed) {
    submissionId = uuid();
    lastFailed = false;
  }
});

const comment = $('comment') as HTMLTextAreaElement;
comment.addEventListener('input', () => {
  setText($('commentCount'), `${comment.value.length} of 500 characters`);
  if (lastFailed) {
    submissionId = uuid();
    lastFailed = false;
  }
});

function rememberScorer() {
  const role = document.querySelector<HTMLInputElement>('input[name="role"]:checked');
  store.set('session', KEY_SCORER, {
    scorer: cleanText(input('scorer').value),
    role: role ? role.value : '',
    part: ($('part') as HTMLSelectElement).value,
  });
}
['scorer', 'part'].forEach((id) => $(id).addEventListener('change', rememberScorer));
document.querySelectorAll('input[name="role"]').forEach((r) => r.addEventListener('change', rememberScorer));

// shows the message right under the part of the form that needs it, and turns that part red
function fail(el: HTMLElement, msg: string, boxes?: HTMLElement[]) {
  const box = (el.closest('fieldset.line, fieldset.sub') || el) as HTMLElement;
  (boxes || [box]).forEach((b) => b.classList.add('invalid'));
  el.setAttribute('aria-invalid', 'true');
  const p = document.createElement('p');
  p.className = 'err inline-err';
  p.setAttribute('role', 'alert');
  p.textContent = msg;
  box.after(p);
  setText($('formErr'), msg);
  box.scrollIntoView({ block: 'center' });
  el.focus({ preventScroll: true });
}

function clearErrors() {
  document.querySelectorAll('#scoreForm [aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
  document.querySelectorAll('#scoreForm .invalid').forEach((x) => x.classList.remove('invalid'));
  document.querySelectorAll('#scoreForm .inline-err').forEach((x) => x.remove());
  setText($('formErr'), '');
}

$('scoreForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (saving) return;
  clearErrors();
  const scorer = cleanText(input('scorer').value);
  const role = document.querySelector<HTMLInputElement>('input[name="role"]:checked');
  const part = ($('part') as HTMLSelectElement).value;
  if (scorer.length < 2) return fail(input('scorer'), ERR.scorer);
  if (!role) return fail(document.querySelector<HTMLInputElement>('input[name="role"]')!, ERR.role);
  let trainee: Record<string, string>;
  let traineeLabel: string;
  if (typing) {
    const name = cleanText(input('tName').value);
    const email = cleanText(input('tEmail').value).toLowerCase();
    if (!isFullName(name)) return fail(input('tName'), ERR.traineeName);
    if (!isEmail(email)) return fail(input('tEmail'), ERR.traineeEmail);
    trainee = { name, email };
    traineeLabel = name;
  } else {
    const sel = $('trainee') as HTMLSelectElement;
    if (!sel.value) return fail(sel, ERR.trainee);
    trainee = { id: sel.value };
    traineeLabel = (sel.options[sel.selectedIndex].textContent || '').split(' · ')[0];
  }
  if (!part) return fail($('part'), ERR.part);
  const scores: Record<string, number> = {};
  const missing: HTMLElement[] = [];
  for (const l of rubric.lines) {
    const picked = document.querySelector<HTMLInputElement>(`input[name="line-${l.id}"]:checked`);
    if (picked) scores[l.id] = Number(picked.value);
    else missing.push($(`line-${l.id}`));
  }
  if (missing.length) {
    return fail(missing[0].querySelector<HTMLInputElement>('input')!, ERR.scores, missing);
  }
  rememberScorer();
  saving = true;
  const btn = $('saveBtn') as HTMLButtonElement;
  btn.disabled = true;
  setText(btn, 'Saving…');
  const r = await api({
    action: 'submitScore', code, device: deviceId(), cohort, scorer, role: role.value, part, trainee, scores,
    comment: comment.value.slice(0, 500), submissionId, website: input('website').value,
  });
  saving = false;
  btn.disabled = false;
  setText(btn, 'Save score');
  if (!r.ok) {
    if (['code', 'wait', 'nocode'].includes(r.code)) return backToGate(r);
    lastFailed = true;
    setText($('formErr'), r.code === 'network' ? NETWORK : r.error);
    return;
  }
  lastFailed = false;
  if (trainee.id) store.set('session', KEY_SCORED, Array.from(new Set(scored().concat(trainee.id))));
  // ready for the next person: keep the scorer and the part, clear the trainee and the scores
  submissionId = uuid();
  ($('trainee') as HTMLSelectElement).value = '';
  input('tName').value = '';
  input('tEmail').value = '';
  if (typing) setTyping(false);
  document.querySelectorAll<HTMLInputElement>('#scoreForm input[name^="line-"]').forEach((x) => (x.checked = false));
  comment.value = '';
  setText($('commentCount'), '0 of 500 characters');
  syncOn();
  if (!typing) void loadTrainees();
  const msg = $('savedMsg');
  setText(msg, `Saved: ${String(r.trainee || traineeLabel)}, ${part}. Choose the next trainer below, and check the course part.`);
  msg.classList.remove('hidden');
  msg.scrollIntoView({ block: 'start' });
  msg.focus({ preventScroll: true });
});

// ---------- start ----------

code = store.get<string>('session', KEY_CODE) || '';
if (code) {
  // a refresh: check the remembered code again before showing anything
  show(SECTIONS, 's-gate');
  void (async () => {
    const r = await api({ action: 'listTrainees', code, cohort, device: deviceId() });
    if (r.ok) {
      await loadTrainees(r);
      openForm();
    } else {
      backToGate(r);
    }
  })();
} else {
  show(SECTIONS, 's-gate');
  input('code').focus();
}
