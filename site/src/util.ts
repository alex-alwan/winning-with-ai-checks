// Small helpers shared by every page.

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('Missing element #' + id);
  return el;
}

export function input(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

export function setText(el: HTMLElement, text: string): void {
  el.textContent = text;
}

export function shuffle<T>(list: readonly T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomInt(n: number): number {
  if (window.crypto && window.crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}

export function uuid(): string {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  const b = new Uint8Array(16);
  window.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Storage can be missing or throw (private windows, blocked site data). Never let that break a page.
export const store = {
  get<T>(area: 'session' | 'local', key: string): T | null {
    try {
      const raw = (area === 'session' ? window.sessionStorage : window.localStorage).getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(area: 'session' | 'local', key: string, value: unknown): void {
    try {
      (area === 'session' ? window.sessionStorage : window.localStorage).setItem(key, JSON.stringify(value));
    } catch {
      /* the page still works, it just will not survive a refresh */
    }
  },
  remove(area: 'session' | 'local', key: string): void {
    try {
      (area === 'session' ? window.sessionStorage : window.localStorage).removeItem(key);
    } catch {
      /* nothing to do */
    }
  },
};

export function param(name: string): string {
  return new URLSearchParams(window.location.search).get(name) || '';
}

export function cleanText(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function cohortFromLink(): string {
  return cleanText(param('cohort')).slice(0, 40);
}

export function isFullName(name: string): boolean {
  return name.length >= 3 && name.length <= 80 && name.split(' ').filter(Boolean).length >= 2;
}

export function isEmail(email: string): boolean {
  return email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

export function numberWord(n: number): string {
  return WORDS[n] || String(n);
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function show(ids: string[], visible: string): void {
  ids.forEach((id) => $(id).classList.toggle('hidden', id !== visible));
  window.scrollTo(0, 0);
}

// a stable random id for this browser, used only to slow down guessing of the scorer code
export function deviceId(): string {
  let id = store.get<string>('local', 'wwai:device');
  if (!id) {
    id = uuid();
    store.set('local', 'wwai:device', id);
  }
  return id;
}
