// Talks to the Apps Script web app.
// text/plain means the browser sends no CORS preflight; Apps Script answers with a redirect that fetch follows.

declare const __API_URL__: string;

export type ApiOk = { ok: true } & Record<string, unknown>;
export type ApiFail = { ok: false; code: string; error: string };
export type ApiResult = ApiOk | ApiFail;

const TIMEOUT_MS = 20000;
const RETRYABLE = ['busy', 'server', 'network'];

export const NETWORK_FAIL: ApiFail = {
  ok: false,
  code: 'network',
  error: 'Check your internet connection, then try again.',
};

async function once(payload: Record<string, unknown>): Promise<ApiResult> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(__API_URL__, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctl.signal,
    });
    if (!res.ok) return NETWORK_FAIL;
    const data = (await res.json()) as ApiResult;
    if (!data || typeof data.ok !== 'boolean') return NETWORK_FAIL;
    return data;
  } catch {
    return NETWORK_FAIL;
  } finally {
    window.clearTimeout(timer);
  }
}

// One automatic retry when the network or the server stumbles; the caller then offers "Try again".
// A repeat is safe: every save carries a submissionId, and the server ignores one it already has.
export async function api(payload: Record<string, unknown>): Promise<ApiResult> {
  const first = await once(payload);
  if (first.ok || !RETRYABLE.includes(first.code)) return first;
  await new Promise((r) => window.setTimeout(r, 1000));
  return once(payload);
}
