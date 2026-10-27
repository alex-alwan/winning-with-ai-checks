import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
type Q = { id: string; text: string; options: Record<string, string>; key: string };
export const participantQs: Q[] = JSON.parse(readFileSync(join(ROOT, 'content/participant-questions.json'), 'utf8')).questions;
export const trainerQs: Q[] = JSON.parse(readFileSync(join(ROOT, 'content/trainer-questions.json'), 'utf8')).questions;

export const API = 'http://127.0.0.1:8787';

export interface Snapshot {
  tables: Record<string, { header: string[]; rows: unknown[][] }>;
  layouts: Record<string, unknown[][]>;
  log: { action: string; contentType: string }[];
}

export async function control(request: APIRequestContext, body: Record<string, unknown>): Promise<Snapshot> {
  const r = await request.post(API + '/__control', { data: body });
  return (await r.json()) as Snapshot;
}

export async function rows(request: APIRequestContext, tab: string) {
  const s = await control(request, { op: 'read' });
  const t = s.tables[tab] || { header: [], rows: [] };
  return t.rows.map((r) => Object.fromEntries(t.header.map((h, i) => [h, r[i]])));
}

export async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, 'page must not scroll sideways').toBeLessThanOrEqual(iw);
}

// every visible button, link, option card and input is at least 44 px tall
export async function tapTargets(page: Page) {
  const small = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('button, a, label.opt, label.sc span, input:not([type=radio]):not([tabindex="-1"]), select, textarea'));
    return els
      .filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => ({ id: e.id || e.className || e.tagName, h: e.getBoundingClientRect().height }))
      .filter((x) => x.h < 44);
  });
  expect(small, 'tap targets under 44 px').toEqual([]);
}

export async function shot(page: Page, info: TestInfo, name: string) {
  const dir = join(ROOT, 'test-results', 'screens');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${info.project.name}-${name}.png`), fullPage: true });
}

// Answers every question on screen: the first `right` questions in the content file correctly, the rest wrongly.
export async function answerAll(page: Page, qs: Q[], right: number, onEach?: (i: number) => Promise<void>) {
  const n = qs.length;
  for (let i = 0; i < n; i++) {
    await expect(page.locator('#qCount')).toHaveText(`Question ${i + 1} of ${n}`);
    const next = page.locator('#nextBtn');
    await expect(next).toBeDisabled();
    await expect(next).toHaveText(i === n - 1 ? 'Submit' : 'Next');
    const text = (await page.locator('#qText').textContent()) || '';
    const qi = qs.findIndex((q) => q.text === text);
    expect(qi, 'question on screen comes from the content file').toBeGreaterThanOrEqual(0);
    const q = qs[qi];
    const choice = qi < right ? q.key : Object.keys(q.options).find((k) => k !== q.key)!;
    await page.locator('label.opt', { hasText: q.options[choice] }).click();
    await expect(page.locator('label.opt.on')).toHaveCount(1);
    await expect(next).toBeEnabled();
    if (onEach) await onEach(i);
    await next.click();
  }
}

export async function start(page: Page, name: string, email: string, org?: string) {
  await page.locator('#name').fill(name);
  await page.locator('#email').fill(email);
  if (org !== undefined) await page.locator('#org').fill(org);
  await page.getByRole('button', { name: 'Start' }).click();
}
