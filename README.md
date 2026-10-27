# Winning with AI · Course check and Trainer check

Two small websites and one Google Sheet that prove the course works.

- **Participants** (founders) take the **Course check**: 12 questions at the start and at the end of the course.
- **Trainers** take the **Trainer check**: 10 questions at the start and at the end of the Training of Trainers.
- During the training, scorers fill in the **teach-back scoring** form for each trainer.
- Every answer lands in the Sheet **"Winning with AI · Course check results"**, which rebuilds its summaries by itself.

## The pages

| Page | Who uses it | Example link |
| --- | --- | --- |
| Course check | Participants | `/check?stage=before&cohort=HTU-Dec` and `/check?stage=after&cohort=HTU-Dec` |
| Trainer check | Trainers | `/trainer?stage=before&cohort=ToT-Nov` and `/trainer?stage=after&cohort=ToT-Nov` |
| Teach-back scoring | Lead trainer and peer scorers only | `/trainer/score?cohort=ToT-Nov` |
| Projector | The room's screen | `/show?audience=participants&stage=before&cohort=HTU-Dec` |

- `stage` is `before` or `after`. Without it, the page asks which check it is.
- `cohort` is any short name for the group. It keeps that group's results together. Use the same name in the start and end links.
- No page links to another. Participants never see a trainer page.
- The easiest way to get every link: in the Sheet, open the menu **Course check > Show the links**.

## How it works, in one paragraph

The pages are a small website on Vercel. When someone presses Submit, the page sends their answers to a Google Apps Script that lives inside the results Sheet. The script holds the answer keys (the pages never see them), marks the answers, writes one row, and rebuilds the summary tabs. Nothing else stores the data: it stays in your Google Drive.

## The Sheet

| Tab | What it holds |
| --- | --- |
| Participants · Responses | One row per submission. Never edited by the script after it is written. |
| Participants · Summary | Rebuilt after every submission: a headline you can quote, averages before and after, the people who took both, each question, each person. |
| Trainers · Responses | One row per trainer check, with organisation. |
| Trainers · Teach-backs | One row per teach-back score. |
| Trainers · Readiness | Rebuilt after every submission: one row per trainer, and who meets the readiness bar. |
| Config | One row per cohort: open or closed, and the dates it is open. |

Only the latest try per person, stage and cohort counts in the summaries. Earlier tries stay in Responses.

## Everyday tasks

### Add a cohort

1. Open the Sheet, then the **Config** tab.
2. Add a row: Cohort name (for example `HTU-Dec`), Audience (`participants` or `trainers`), Opens and Closes dates, Status `open`.
3. Open **Course check > Show the links**. The new cohort's links are there.

A cohort that is not in Config is always open. To stop late answers, set its Status to `closed`.

### Change the scorer code

1. Open the Sheet.
2. Menu **Course check > Set scorer code**.
3. Type the new code (4 to 40 letters, numbers or dashes) and press OK. The old code stops working at once.

### Change the readiness bar

The bar is "knowledge check after at least 8 of 10, and every teach-back line at least 3". To change it:

1. In the Sheet: **Extensions > Apps Script**.
2. **Project Settings** (the gear on the left) > **Script Properties**.
3. Edit `READY_KNOWLEDGE_MIN` or `READY_RUBRIC_MIN`, then Save.
4. Back in the Sheet: **Course check > Refresh summaries**.

### Change a question

The questions live in three files, and nowhere else:

- `content/participant-questions.json`
- `content/trainer-questions.json`
- `content/teachback-rubric.json`

1. Edit the file (text, options, `key` for the right answer, `skill`).
2. Run one command on a computer with this repo: `npm run build`. It checks the files, rebuilds the site and the script, and stops if anything is wrong (for example a key that is not one of the options, or a dash the writing rules forbid).
3. Redeploy both parts (below).

If you replace questions with different ones, rename the old Responses tab first (for example `Trainers · Responses (old questions)`). The script then starts a fresh tab, so old and new answers do not mix in the summaries.

## Redeploy

### The website (Vercel)

Merge the change into `main` on GitHub. Vercel builds and publishes it by itself. The setting `API_URL` (the Apps Script web app address, ending in `/exec`) lives in Vercel under Project > Settings > Environment Variables.

### The script (Google Apps Script)

**Option A, no install (about 3 minutes):**

1. Run `npm run build:script`. It writes `apps-script/build/Code.js`.
2. In the Sheet: **Extensions > Apps Script**, open `Code.gs`, select everything, and paste the whole of `Code.js` over it. Save.
3. **Deploy > Manage deployments**, the pencil on the web app, Version: **New version**, **Deploy**. The web address stays the same.

**Option B, one command (needs `clasp` signed in once on that computer with `npx clasp login`):**

1. Copy `.clasp.json.example` to `.clasp.json` and paste the Script ID (Apps Script > Project Settings > IDs).
2. Run `DEPLOYMENT_ID=<the web app deployment id> npm run deploy:script`.

## For developers

- `npm test`: unit tests (Vitest) for grading, validation, latest attempt, paired gain, per-question change, readiness, cohort windows, the scorer code, and duplicates. They run the real `apps-script/src/Core.js` in Node.
- `npm run test:e2e`: builds the site against a local mock of the Apps Script (same `Core.js`, an in-memory sheet, the same redirect), then runs Playwright on every flow at 390×844 and 1280×800. Screenshots land in `test-results/screens/`.
- `npm run build:site` ends with `scripts/check-dist.mjs`: it fails if any answer key, skill tag or server setting is in `dist/`, or if JavaScript and CSS go over 150 KB.
- `API_URL=... SCORER_CODE=... npm run live-test -- --cleanup`: the real end-to-end test in cohort `TEST`, then removes every `TEST` row.

### Layout

```
content/            the questions and the rubric (the only source of truth)
apps-script/src/    Core.js (pure logic, tested in Node) and Main.js (Sheet, menu, web app)
apps-script/build/  the built single file for Apps Script (made by npm run build:script)
site/               the four pages (Vite, plain TypeScript)
scripts/            build, dist check, live test
tests/              unit tests, the mock API, Playwright flows
```

### The API

One web app address, `POST` with `Content-Type: text/plain` (so the browser sends no preflight), body `{"action": ...}`:

| Action | Needs the scorer code | Does |
| --- | --- | --- |
| `getQuestions` | no | the questions without keys |
| `submitCheck` | no | marks and saves one check, returns the score and the before score |
| `listTrainees` | yes | names and organisations of trainers in a cohort (no emails) |
| `submitScore` | yes | saves one teach-back score |
| `deleteTestRows` | yes | removes only rows whose cohort is `TEST` |

Every save carries a `submissionId`; the script ignores one it already has, so a double tap saves once. A hidden field catches bots. Five wrong scorer codes from one browser bring a 30-second wait.

### Security notes

- Answer keys, the scorer code and the readiness thresholds exist only in Apps Script.
- Every field is checked on the server: lengths, stages, option ids, all questions answered, scores 1 to 4, payload under 20 KB.
- Text that starts with `=`, `+`, `-` or `@` is stored with a leading apostrophe, so the Sheet never runs it as a formula.
- The script asks only for access to this one spreadsheet (`@OnlyCurrentDoc`).
- No analytics and no trackers. The only outside request is Google Fonts.
