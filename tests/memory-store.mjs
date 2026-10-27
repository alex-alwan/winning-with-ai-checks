// An in-memory stand-in for the Google Sheet, Script Properties and the cache.
// It lets the real Core.js run in Node: in the unit tests and behind the local mock API.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadContent, contentVersion } from '../scripts/content.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const Core = require(join(ROOT, 'apps-script/src/Core.js'));

export function buildContent() {
  const { participants, trainers, rubric } = loadContent();
  return {
    participants,
    trainers,
    rubric,
    versions: { participants: contentVersion(participants), trainers: contentVersion(trainers) },
    siteUrl: '',
  };
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

export function memoryDeps(options = {}) {
  const tabs = new Map(); // name -> { header: [], rows: [[]] }
  const props = new Map(Object.entries(options.props || {}));
  const cache = new Map(); // key -> { v, until }
  const layouts = new Map();
  let clock = options.now ? new Date(options.now).getTime() : Date.parse('2026-12-01T08:00:00Z');
  const errors = [];
  let config = options.config || [];

  const store = {
    read(name) {
      const t = tabs.get(name);
      return t ? { header: t.header.slice(), rows: t.rows.map((r) => r.slice()) } : { header: [], rows: [] };
    },
    append(name, wanted, record) {
      let t = tabs.get(name);
      if (!t) {
        t = { header: wanted.slice(), rows: [] };
        tabs.set(name, t);
      }
      t.header = Core.mergeHeader_(t.header, wanted);
      t.rows.push(Core.rowFor_(t.header, record));
    },
    deleteRows(name, matches) {
      const t = tabs.get(name);
      if (!t) return 0;
      const idx = Core.indexOf_(t.header);
      const before = t.rows.length;
      t.rows = t.rows.filter((r) => !matches(r, idx));
      return before - t.rows.length;
    },
    readConfig() {
      return config.map((c) => ({ ...c }));
    },
    writeLayout(name, layout) {
      layouts.set(name, layout);
    },
    withLock(fn) {
      return fn();
    },
    trySummaryLock(fn) {
      fn();
      return true;
    },
  };

  const deps = {
    content: options.content || buildContent(),
    store,
    props: {
      get: (k) => (props.has(k) ? props.get(k) : null),
      set: (k, v) => props.set(k, String(v)),
    },
    cache: {
      get: (k) => {
        const e = cache.get(k);
        if (!e) return null;
        if (e.until <= clock) {
          cache.delete(k);
          return null;
        }
        return e.v;
      },
      put: (k, v, seconds) => cache.set(k, { v: String(v), until: clock + seconds * 1000 }),
      remove: (k) => cache.delete(k),
    },
    hash: (s) => createHash('sha256').update(s, 'utf8').digest('hex'),
    now: () => new Date(clock),
    today: () => ymd(new Date(clock)),
    stamp: (d) => d.toISOString().slice(0, 16).replace('T', ' ') + ' (UTC)',
    log: (err) => errors.push(err),
  };

  return {
    deps,
    tabs,
    layouts,
    errors,
    props,
    handle: (payload) => Core.handle_(JSON.parse(JSON.stringify(payload)), deps),
    tick: (ms) => {
      clock += ms;
    },
    setConfig: (c) => {
      config = c;
    },
    table: (name) => store.read(name),
  };
}
