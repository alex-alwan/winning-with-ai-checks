import { test, expect } from '@playwright/test';
import { control, rows, noHorizontalScroll, tapTargets, shot, answerAll, start, participantQs, trainerQs } from './helpers';

const P_TAB = 'Participants · Responses';
const T_TAB = 'Trainers · Responses';
const S_TAB = 'Trainers · Teach-backs';

test.beforeEach(async ({ request }) => {
  await control(request, { op: 'reset' });
});

test.describe('participant course check', () => {
  test('before, then after: saved, scored on the server, before and today side by side', async ({ page, request }, info) => {
    await page.goto('/check?stage=before&cohort=E2E');
    await expect(page.locator('#stageLabel')).toHaveText('Before the course');
    await expect(page.locator('#s-start h1')).toHaveText('Winning with AI');
    await expect(page.locator('.note')).toContainText('There is no pass or fail.');
    await expect(page.locator('.note')).toContainText('Rania');
    await expect(page.locator('#intro')).toHaveText('Twelve short questions about starting a business with AI. It takes about 10 minutes. You will answer the same questions again at the end of the course.');
    await noHorizontalScroll(page);
    await tapTargets(page);
    await shot(page, info, '01-participant-start');

    await start(page, 'Rania Haddad', '  Rania.Haddad@Example.com ');
    let shotTaken = false;
    await answerAll(page, participantQs, 5, async () => {
      if (!shotTaken) {
        await noHorizontalScroll(page);
        await tapTargets(page);
        await shot(page, info, '02-participant-question');
        shotTaken = true;
      }
    });
    await expect(page.locator('#doneTitle')).toHaveText('Thank you, Rania. Your answers are saved.');
    await expect(page.locator('#doneBody')).toHaveText('You will answer the same questions at the end of the course. Enjoy the two days.');
    await expect(page.locator('.cmp')).toHaveCount(0); // no score and no answers shown before the course
    await shot(page, info, '03-participant-done-before');

    let saved = await rows(request, P_TAB);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ Stage: 'Before', Cohort: 'E2E', Name: 'Rania Haddad', Email: 'rania.haddad@example.com', Score: 5, 'Out of': 12 });
    expect(saved[0]['Q1 correct']).toBe(1);
    expect(saved[0]['Q6 correct']).toBe(0);
    expect(String(saved[0]['Submission ID'])).toMatch(/^[0-9a-f-]{36}$/);

    await page.goto('/check?stage=after&cohort=E2E');
    await expect(page.locator('#stageLabel')).toHaveText('After the course');
    await start(page, 'Rania Haddad', 'rania.haddad@example.com');
    await answerAll(page, participantQs, 10);
    await expect(page.locator('#doneTitle')).toHaveText('Thank you, Rania. Your answers are saved.');
    const cells = page.locator('.cmp > div');
    await expect(cells).toHaveCount(2);
    await expect(cells.nth(0)).toHaveText(/5 \/ 12\s*Start of course/);
    await expect(cells.nth(1)).toHaveText(/10 \/ 12\s*Today/);
    await expect(page.locator('#doneBody')).toContainText('Keep practising for the next 30 days with your Launch Kit.');
    await noHorizontalScroll(page);
    await shot(page, info, '04-participant-done-after');

    saved = await rows(request, P_TAB);
    expect(saved.map((r) => r.Score)).toEqual([5, 10]);
    const snap = await control(request, { op: 'read' });
    const summary = snap.layouts['Participants · Summary'].map((r) => r[0]);
    expect(summary).toContain('For the 1 person who took both: average 5.0 of 12 before, 10.0 after (+5.0 points). 1 of 1 improved.');
    // simple requests only: no CORS preflight, and text/plain
    expect(snap.log.some((l) => l.action === 'PREFLIGHT')).toBe(false);
    expect(snap.log.every((l) => l.contentType.startsWith('text/plain'))).toBe(true);
  });

  test('shuffles questions and options for each person', async ({ page }) => {
    const firsts = new Set<string>();
    const optionOrders = new Set<string>();
    for (let i = 0; i < 4; i++) {
      await page.goto('/check?stage=before&cohort=S' + i);
      await start(page, 'Test Person', `p${i}@example.com`);
      firsts.add((await page.locator('#qText').textContent()) || '');
      optionOrders.add((await page.locator('label.opt .t').allTextContents()).join('|'));
    }
    expect(firsts.size + optionOrders.size).toBeGreaterThan(2);
  });

  test('no stage in the link: the chooser asks which check this is', async ({ page }) => {
    await page.goto('/check');
    await expect(page.getByRole('button', { name: 'At the start of the course' })).toBeVisible();
    await page.getByRole('button', { name: 'At the end of the course' }).click();
    await expect(page.locator('#stageLabel')).toHaveText('After the course');
    await expect(page).toHaveURL(/stage=after/);
  });

  test('the root address goes to the participant check', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/check$/);
  });

  test('checks the name and email before starting, and announces errors', async ({ page }) => {
    await page.goto('/check?stage=before');
    await start(page, 'Rania', 'rania@example.com');
    const err = page.locator('#startErr');
    await expect(err).toHaveAttribute('role', 'alert');
    await expect(err).toHaveText('Please write your full name (first and last).');
    await expect(page.locator('#name')).toBeFocused();
    await start(page, 'Rania Haddad', 'rania@example');
    await expect(err).toHaveText('Please write a valid email. Use the same one at the start and the end.');
    await start(page, 'Rania Haddad', 'rania@example.com');
    await expect(page.locator('#qCount')).toHaveText('Question 1 of 12');
  });

  test('a refresh keeps the answers, and Back shows them', async ({ page }) => {
    await page.goto('/check?stage=before&cohort=R');
    await start(page, 'Omar Khalil', 'omar@example.com');
    const picked: string[] = [];
    for (let i = 0; i < 3; i++) {
      const opt = page.locator('label.opt').nth(1);
      picked.push((await opt.locator('.t').textContent()) || '');
      await opt.click();
      await page.locator('#nextBtn').click();
    }
    await page.reload();
    await expect(page.locator('#qCount')).toHaveText('Question 4 of 12');
    await page.locator('#backBtn').click();
    await expect(page.locator('#qCount')).toHaveText('Question 3 of 12');
    await expect(page.locator('label.opt.on .t')).toHaveText(picked[2]);
    await expect(page.locator('label.opt.on input')).toBeChecked();
  });

  test('weak Wi-Fi: one automatic retry, then Try again, keeping every answer, and saving once', async ({ page, request }, info) => {
    await page.goto('/check?stage=before&cohort=W');
    await start(page, 'Lina Odeh', 'lina@example.com');
    await answerAll(page, participantQs, 12, async (i) => {
      if (i === 11) await control(request, { op: 'failNext', n: 2 });
    });
    await expect(page.locator('#failTitle')).toHaveText('Your answers were not saved yet');
    await expect(page.locator('#failMsg')).toHaveText('Check your internet connection, then try again. Your answers are still here.');
    await shot(page, info, '05-participant-try-again');
    expect(await rows(request, P_TAB)).toHaveLength(0);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#doneTitle')).toHaveText('Thank you, Lina. Your answers are saved.');
    const saved = await rows(request, P_TAB);
    expect(saved).toHaveLength(1);
    expect(saved[0].Score).toBe(12);
    const log = (await control(request, { op: 'read' })).log.filter((l) => l.action === 'submitCheck');
    expect(log).toHaveLength(3); // first try, automatic retry, Try again
  });

  test('a closed cohort is refused with a clear message', async ({ page, request }) => {
    await control(request, { op: 'config', rows: [{ cohort: 'Old', audience: 'participants', opens: '', closes: '', status: 'closed' }] });
    await page.goto('/check?stage=before&cohort=Old');
    await start(page, 'Sami Aziz', 'sami@example.com');
    await answerAll(page, participantQs, 3);
    await expect(page.locator('#failMsg')).toHaveText('This check is closed. Please ask your trainer.');
    expect(await rows(request, P_TAB)).toHaveLength(0);
  });

  test('works with the keyboard alone', async ({ page }) => {
    test.skip(test.info().project.name === 'phone', 'keyboard flow runs on desktop');
    await page.goto('/check?stage=before');
    await page.locator('#name').focus();
    await page.keyboard.type('Key Board');
    await page.keyboard.press('Tab');
    await page.keyboard.type('kb@example.com');
    await page.keyboard.press('Enter');
    await expect(page.locator('#qCount')).toHaveText('Question 1 of 12');
    await expect(page.locator('#qText')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.locator('label.opt.on')).toHaveCount(1);
    const outline = await page.locator('label.opt.on').evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(outline).toBe('solid'); // the focus ring shows
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('label.opt.on')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.locator('#qCount')).toHaveText('Question 2 of 12');
  });
});

test.describe('trainer knowledge check', () => {
  test('before, then after, with organisation', async ({ page, request }, info) => {
    await page.goto('/trainer?stage=before&cohort=ToT-E2E');
    await expect(page.locator('#stageLabel')).toHaveText('Before the training');
    await expect(page.locator('#intro')).toHaveText('Ten short questions about running this course. About 8 minutes. You will answer the same questions at the end of the training.');
    await expect(page.locator('.note')).not.toContainText('Rania');
    await noHorizontalScroll(page);
    await tapTargets(page);
    await shot(page, info, '06-trainer-start');
    await start(page, 'Zaid Nasser', 'zaid@example.com', '');
    await expect(page.locator('#startErr')).toHaveText('Please write the name of your organisation.');
    await start(page, 'Zaid Nasser', 'zaid@example.com', 'ZINC');
    await answerAll(page, trainerQs, 6);
    await expect(page.locator('#doneTitle')).toHaveText('Thank you, Zaid. Your answers are saved.');
    await expect(page.locator('#doneBody')).toHaveText('You will answer the same questions at the end of the training. Enjoy the two days.');

    await page.goto('/trainer?stage=after&cohort=ToT-E2E');
    await expect(page.locator('#stageLabel')).toHaveText('After the training');
    await start(page, 'Zaid Nasser', 'zaid@example.com', 'ZINC');
    await answerAll(page, trainerQs, 9);
    await expect(page.locator('.cmp > div').nth(0)).toHaveText(/6 \/ 10\s*Start of training/);
    await expect(page.locator('.cmp > div').nth(1)).toHaveText(/9 \/ 10\s*Today/);
    await shot(page, info, '07-trainer-done-after');
    const saved = await rows(request, T_TAB);
    expect(saved.map((r) => [r.Stage, r.Organisation, r.Score, r['Out of']])).toEqual([['Before', 'ZINC', 6, 10], ['After', 'ZINC', 9, 10]]);
  });

  test('the trainer chooser speaks of the training', async ({ page }) => {
    await page.goto('/trainer');
    await expect(page.getByRole('button', { name: 'At the start of the training' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'At the end of the training' })).toBeVisible();
  });
});

test.describe('teach-back scoring', () => {
  async function seedTrainers(page: import('@playwright/test').Page) {
    for (const [name, email, org] of [['Zaid Nasser', 'zaid@example.com', 'ZINC'], ['Amal Khoury', 'amal@example.com', 'Oasis500']]) {
      await page.goto('/trainer?stage=before&cohort=ToT-E2E');
      await start(page, name, email, org);
      await answerAll(page, trainerQs, 5);
      await expect(page.locator('#doneTitle')).toBeVisible();
    }
  }

  test('a wrong code, then the right one; save a score; ready for the next person', async ({ page, request }, info) => {
    await control(request, { op: 'setCode', code: 'Teach-4821' });
    await seedTrainers(page);
    await page.goto('/trainer/score?cohort=ToT-E2E');
    await expect(page.locator('#scoreForm')).toBeHidden();
    await noHorizontalScroll(page);
    await tapTargets(page);
    await shot(page, info, '08-score-gate');
    await page.locator('#code').fill('wrong-code');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('#gateErr')).toHaveText('That code is not right. Please check it with the lead trainer.');
    await expect(page.locator('#scoreForm')).toBeHidden();
    await page.locator('#code').fill('teach-4821');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('#scoreForm')).toBeVisible();

    const options = await page.locator('#trainee option').allTextContents();
    expect(options).toEqual(['Choose a name', 'Amal Khoury · Oasis500', 'Zaid Nasser · ZINC']);
    await expect(page.locator('.line')).toHaveCount(4);
    await expect(page.locator('.line').first()).toContainText('A 4 looks like: Finishes in time and keeps the part that must never be cut');

    // nothing is saved until every line has a score
    await page.locator('#scorer').fill('Alex Alwan');
    await page.locator('label.opt', { hasText: 'Lead trainer' }).click();
    await page.locator('#part').selectOption('Lab 2 · Give AI the right facts');
    await page.locator('#trainee').selectOption({ label: 'Zaid Nasser · ZINC' });
    await page.locator('label.sc', { has: page.locator('input[name="line-timing"][value="4"]') }).click();
    await page.getByRole('button', { name: 'Save score' }).click();
    await expect(page.locator('#formErr')).toHaveText('Please choose a score from 1 to 4 for every line.');
    // the message shows next to the lines that need a score, in view, and those lines turn red
    const inline = page.locator('.inline-err');
    await expect(inline).toHaveText('Please choose a score from 1 to 4 for every line.');
    await expect(inline).toBeInViewport();
    await expect(page.locator('fieldset.line.invalid')).toHaveCount(3);

    for (const [line, v] of [['clarity', 3], ['practice', 4], ['judgment', 3]] as const) {
      await page.locator('label.sc', { has: page.locator(`input[name="line-${line}"][value="${v}"]`) }).click();
    }
    await page.locator('#comment').fill('Calm, clear, kept to time.');
    await expect(page.locator('#commentCount')).toHaveText('26 of 500 characters');
    await noHorizontalScroll(page);
    await tapTargets(page);
    await shot(page, info, '09-score-form-filled');
    await page.getByRole('button', { name: 'Save score' }).click();
    await expect(page.locator('#savedMsg')).toHaveText('Saved: Zaid Nasser, Lab 2 · Give AI the right facts. Choose the next trainer below, and check the course part.');
    await expect(page.locator('#trainee option')).toHaveText(['Choose a name', 'Amal Khoury · Oasis500', 'Zaid Nasser · ZINC · scored']);

    // kept: scorer and part; cleared: trainee and scores
    await expect(page.locator('#scorer')).toHaveValue('Alex Alwan');
    await expect(page.locator('#part')).toHaveValue('Lab 2 · Give AI the right facts');
    await expect(page.locator('input[name="role"][value="lead"]')).toBeChecked();
    await expect(page.locator('#trainee')).toHaveValue('');
    await expect(page.locator('#scoreForm input[name^="line-"]:checked')).toHaveCount(0);
    await expect(page.locator('#comment')).toHaveValue('');
    await shot(page, info, '10-score-saved');

    const saved = await rows(request, S_TAB);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      Cohort: 'ToT-E2E', Scorer: 'Alex Alwan', Role: 'Lead trainer', 'Trainee name': 'Zaid Nasser', 'Trainee email': 'zaid@example.com',
      'Course part': 'Lab 2 · Give AI the right facts', Timing: 4, Clarity: 3, Practice: 4, 'Judgment and safety': 3, Comment: 'Calm, clear, kept to time.',
    });

    // someone missing from the list: type their name and email
    await page.getByRole('button', { name: 'Someone is missing? Type their name' }).click();
    await page.locator('#tName').fill('Huda Saleh');
    await page.locator('#tEmail').fill('huda@example.com');
    for (const line of ['timing', 'clarity', 'practice', 'judgment']) {
      await page.locator('label.sc', { has: page.locator(`input[name="line-${line}"][value="2"]`) }).click();
    }
    await page.getByRole('button', { name: 'Save score' }).click();
    await expect(page.locator('#savedMsg')).toContainText('Saved: Huda Saleh, Lab 2');
    expect((await rows(request, S_TAB)).map((r) => r['Trainee email'])).toEqual(['zaid@example.com', 'huda@example.com']);

    const readiness = (await control(request, { op: 'read' })).layouts['Trainers · Readiness'];
    expect(readiness[1][0]).toBe('0 of 3 trainers meet the readiness bar.');
  });

  test('five wrong codes bring a 30-second wait', async ({ page, request }) => {
    await control(request, { op: 'setCode', code: 'Teach-4821' });
    await page.goto('/trainer/score?cohort=ToT-E2E');
    for (let i = 0; i < 4; i++) {
      await page.locator('#code').fill('nope-' + i);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.locator('#gateErr')).toHaveText('That code is not right. Please check it with the lead trainer.');
    }
    await page.locator('#code').fill('nope-5');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('#gateErr')).toHaveText('Too many tries. Please wait 30 seconds, then try again.');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  test('no code set yet: scoring is not open', async ({ page }) => {
    await page.goto('/trainer/score');
    await page.locator('#code').fill('anything');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('#gateErr')).toHaveText('Scoring is not open yet. Ask the lead trainer to set the scorer code.');
  });
});

test.describe('projector page', () => {
  test('shows the title, Scan to start, a QR code made in the browser, and the short link', async ({ page }, info) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (!['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname)) external.push(r.url());
    });
    await page.goto('/show?audience=participants&stage=before&cohort=HTU-Dec');
    await expect(page.locator('h1')).toHaveText('Winning with AI');
    await expect(page.locator('.scan')).toHaveText('Scan to start');
    await expect(page.locator('#showStage')).toHaveText('Before the course');
    await expect(page.locator('#showLink')).toHaveText('127.0.0.1:4173/check?stage=before&cohort=HTU-Dec');
    await expect(page.locator('#qr svg path')).toHaveCount(1);
    const box = await page.locator('#qr').boundingBox();
    expect(box!.width).toBeGreaterThan(300);
    await noHorizontalScroll(page);
    await shot(page, info, '11-projector');
    expect(external).toEqual([]);
    await page.goto('/show?audience=trainers&stage=after&cohort=ToT-E2E');
    await expect(page.locator('#showLink')).toHaveText('127.0.0.1:4173/trainer?stage=after&cohort=ToT-E2E');
    await expect(page.locator('#showStage')).toHaveText('After the training');
  });
});

test.describe('separation and privacy', () => {
  test('participant pages hold no link to any trainer page, and no answer keys', async ({ page }) => {
    for (const path of ['/check?stage=before', '/show?stage=before']) {
      await page.goto(path);
      const html = await page.content();
      expect(html).not.toMatch(/href="[^"]*trainer/);
    }
    const res = await page.request.get('/check?stage=before');
    expect(await res.text()).not.toContain('trainer');
  });
});
