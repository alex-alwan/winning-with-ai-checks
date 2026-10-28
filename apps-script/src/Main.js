/**
 * Main: everything that talks to Google (the Sheet, Script Properties, the cache, locks, the menu).
 * The logic it calls lives in Core.js. CONTENT comes from the content files at build time.
 */

// ---------- the web app (a JSON API) ----------

function doPost(e) {
  var out;
  try {
    var body = (e && e.postData && e.postData.contents) || '';
    if (body.length > MAX_BODY) {
      out = { ok: false, code: 'validation', error: 'That was too much text. Please shorten it and try again.' };
    } else {
      var payload = null;
      try { payload = JSON.parse(body); } catch (err) { payload = null; }
      out = handle_(payload, deps_());
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    out = { ok: false, code: 'server', error: MSG.generic };
  }
  return json_(out);
}

function doGet() {
  return json_({ ok: true, service: 'Winning with AI checks', note: 'Answers are sent with POST.' });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function deps_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('The script must be bound to the results Sheet.');
  var tz = TIME_ZONE;
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  return {
    content: CONTENT,
    store: sheetStore_(ss),
    props: {
      get: function (k) { return props.getProperty(k); },
      set: function (k, v) { props.setProperty(k, String(v)); }
    },
    cache: {
      get: function (k) { return cache.get(k); },
      put: function (k, v, seconds) { cache.put(k, v, seconds); },
      remove: function (k) { cache.remove(k); }
    },
    hash: function (s) {
      return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
        .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    },
    now: function () { return new Date(); },
    today: function () { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'); },
    stamp: function (d) { return Utilities.formatDate(d, tz, 'd MMM yyyy, HH:mm') + ' (' + tz + ' time)'; },
    // never log a request body: it holds names and emails
    log: function (err) { console.error(err && err.stack ? err.stack : String(err)); }
  };
}

// ---------- the Sheet ----------

var NAVY = '#0a2240';
var TIME_ZONE = 'Asia/Amman'; // the course runs in Jordan; dates in Config and the summaries use Amman time
var CRIMSON = '#d01319';
var MUTED = '#55657a';

function trimHeader_(values) {
  var h = values.map(function (v) { return String(v); });
  while (h.length && h[h.length - 1] === '') h.pop();
  return h;
}

function tabIndex_(ss, name) {
  var want = TAB_ORDER.indexOf(name);
  var sheets = ss.getSheets();
  var i = 0;
  sheets.forEach(function (sh) {
    var at = TAB_ORDER.indexOf(sh.getName());
    if (at >= 0 && at < want) i = Math.max(i, sh.getIndex());
  });
  return i;
}

var TEXT_COLUMNS = ['Stage', 'Cohort', 'Name', 'Organisation', 'Email', 'Submission ID', 'Scorer', 'Role',
  'Trainee name', 'Trainee email', 'Course part', 'Comment'];

// The number format for each column, so Sheets never turns a cohort like "Jan-26" into a date.
function columnFormat_(h) {
  if (h === 'Submitted at') return 'yyyy-mm-dd hh:mm';
  if (h === 'Percent') return '0%';
  if (h === 'Minutes') return '0.0';
  if (h === 'Opens' || h === 'Closes') return 'yyyy-mm-dd';
  if (TEXT_COLUMNS.indexOf(h) >= 0 || /answer$/.test(h)) return '@';
  return 'General';
}

function fitColumns_(sh, n) {
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
}

function formatHeader_(sh, header) {
  fitColumns_(sh, header.length);
  sh.getRange(1, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setBackground(NAVY).setFontColor('#ffffff').setVerticalAlignment('middle');
  sh.setFrozenRows(1);
}

function ensureTab_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, tabIndex_(ss, name));
    if (header) formatHeader_(sh, header);
  }
  return sh;
}

function sheetStore_(ss) {
  return {
    read: function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 1 || sh.getLastColumn() < 1) return { header: [], rows: [] };
      var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
      return { header: trimHeader_(values[0]), rows: values.slice(1) };
    },
    append: function (name, wanted, record) {
      var sh = ensureTab_(ss, name, wanted);
      var existing = sh.getLastColumn() > 0 ? trimHeader_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]) : [];
      var header = mergeHeader_(existing, wanted);
      if (header.length !== existing.length) formatHeader_(sh, header);
      // set the formats first, then the values, so text stays text in every row ever written
      var at = sh.getLastRow() + 1;
      if (sh.getMaxRows() < at) sh.insertRowsAfter(sh.getMaxRows(), at - sh.getMaxRows() + 50);
      var rg = sh.getRange(at, 1, 1, header.length);
      rg.setNumberFormats([header.map(columnFormat_)]);
      rg.setValues([rowFor_(header, record)]);
    },
    deleteRows: function (name, matches) {
      var sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 2) return 0;
      var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
      var idx = indexOf_(trimHeader_(values[0]));
      var n = 0;
      for (var r = values.length - 1; r >= 1; r--) {
        if (matches(values[r], idx)) { sh.deleteRow(r + 1); n++; }
      }
      return n;
    },
    readConfig: function () {
      var sh = ensureConfig_(ss);
      if (sh.getLastRow() < 2) return [];
      var tz = TIME_ZONE;
      var day = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v || ''); };
      var values = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), CONFIG_HEADER.length)).getValues();
      var idx = indexOf_(trimHeader_(values[0]));
      return values.slice(1).map(function (v) {
        return {
          cohort: v[idx['Cohort']], audience: v[idx['Audience']],
          opens: day(v[idx['Opens']]), closes: day(v[idx['Closes']]), status: v[idx['Status']]
        };
      });
    },
    writeLayout: function (name, L) {
      writeLayout_(ss, name, L);
    },
    withLock: function (fn) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(15000)) throw userError_('busy', MSG.busy);
      try {
        var r = fn();
        SpreadsheetApp.flush();
        return r;
      } finally {
        lock.releaseLock();
      }
    },
    trySummaryLock: function (fn) {
      // a separate lock from the one around writes, so saving answers never waits for a rebuild
      var lock = LockService.getDocumentLock();
      if (!lock || !lock.tryLock(3000)) return false;
      try {
        fn();
        SpreadsheetApp.flush();
      } finally {
        lock.releaseLock();
      }
      return true;
    }
  };
}

function writeLayout_(ss, name, L) {
  var sh = ensureTab_(ss, name, null);
  var rows = Math.max(L.values.length, 1), cols = L.width;
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.setFrozenRows(0);
  if (L.values.length) sh.getRange(1, 1, L.values.length, cols).setValues(L.values).setVerticalAlignment('top').setFontColor(NAVY);
  L.formats.forEach(function (f) {
    var rg = sh.getRange(f.r, f.c, f.nr, f.nc);
    switch (f.kind) {
      case 'title': rg.setFontWeight('bold').setFontSize(16).setFontColor(NAVY); break;
      case 'blockTitle': rg.setFontWeight('bold').setFontSize(13).setFontColor(NAVY); break;
      case 'muted': rg.setFontColor(MUTED).setFontSize(10); break;
      case 'headline': rg.merge().setFontWeight('bold').setFontColor(CRIMSON).setFontSize(12).setWrap(true); break;
      case 'header': rg.setFontWeight('bold').setBackground(NAVY).setFontColor('#ffffff').setWrap(true); break;
      case 'dec1': rg.setNumberFormat('0.0'); break;
      case 'dec1Change': rg.setNumberFormat('+0.0;-0.0;0.0'); break;
      case 'pct': rg.setNumberFormat('0%'); break;
      case 'pctChange': rg.setNumberFormat('+0%;-0%;0%'); break;
      case 'intChange': rg.setNumberFormat('+0;-0;0'); break;
      case 'wrap': rg.setWrap(true); break;
      case 'ready': rg.setFontWeight('bold'); break;
    }
  });
  L.colWidths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
}

function ensureConfig_(ss) {
  var sh = ss.getSheetByName(TABS.config);
  if (sh) return sh;
  sh = ensureTab_(ss, TABS.config, CONFIG_HEADER);
  var today = new Date();
  var later = new Date(today.getTime() + 30 * 86400000);
  var rows0 = sh.getMaxRows() - 1;
  sh.getRange(2, 1, rows0, 5).setNumberFormats(Array.apply(null, Array(rows0)).map(function () { return CONFIG_HEADER.map(columnFormat_); }));
  sh.getRange(2, 1, 1, 5).setValues([['Example cohort', 'participants', today, later, 'open']]);
  sh.getRange(1, 1).setNote('One row per cohort. Use the same cohort name as in the links (for example HTU-Dec).\n' +
    'Audience: participants or trainers. Status: open or closed.\n' +
    'A cohort that is not listed here is always open.');
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, 2, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['participants', 'trainers'], true).setAllowInvalid(false).build());
  sh.getRange(2, 3, rows, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  sh.getRange(2, 5, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['open', 'closed'], true).setAllowInvalid(false).build());
  sh.setColumnWidth(1, 180);
  return sh;
}

// Creates every tab in order, removes an empty "Sheet1", and fills in default settings.
function setup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var spec = audienceSpec_(CONTENT, 'participants');
  var tspec = audienceSpec_(CONTENT, 'trainers');
  ensureTab_(ss, TABS.pResponses, responseHeader_(spec));
  ensureTab_(ss, TABS.pSummary, null);
  ensureTab_(ss, TABS.tResponses, responseHeader_(tspec));
  ensureTab_(ss, TABS.tScores, scoreHeader_(CONTENT.rubric));
  ensureTab_(ss, TABS.tReadiness, null);
  ensureConfig_(ss);
  if (ss.getSpreadsheetTimeZone() !== TIME_ZONE) ss.setSpreadsheetTimeZone(TIME_ZONE);
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  var props = PropertiesService.getScriptProperties();
  var bar = CONTENT.rubric.readiness_bar;
  if (props.getProperty('READY_KNOWLEDGE_MIN') === null) props.setProperty('READY_KNOWLEDGE_MIN', String(bar.knowledge_after_min));
  if (props.getProperty('READY_RUBRIC_MIN') === null) props.setProperty('READY_RUBRIC_MIN', String(bar.every_rubric_line_min));
  if (props.getProperty('SITE_URL') === null && CONTENT.siteUrl) props.setProperty('SITE_URL', CONTENT.siteUrl);
}

// ---------- the menu in the Sheet ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Course check')
    .addItem('Refresh summaries', 'menuRefreshSummaries')
    .addItem('Show the links', 'menuShowLinks')
    .addItem('Set scorer code', 'menuSetScorerCode')
    .addSeparator()
    .addItem('Delete TEST rows', 'menuDeleteTestRows')
    .addToUi();
}

function menuRefreshSummaries() {
  setup_();
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var d = deps_();
    d.props.set(DIRTY.participants, '0');
    d.props.set(DIRTY.trainers, '0');
    rebuildAll_(d);
  } finally {
    lock.releaseLock();
  }
  SpreadsheetApp.getActiveSpreadsheet().toast('Both summary tabs are up to date.', 'Course check', 5);
}

function menuDeleteTestRows() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Delete TEST rows', 'This deletes every row whose cohort is TEST, in all three response tabs. Other rows stay.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  var c = deleteTestRows_(deps_());
  ui.alert('Deleted ' + c.participants + ' participant, ' + c.trainers + ' trainer and ' + c.teachBacks + ' teach-back rows.');
}

function menuSetScorerCode() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Set scorer code',
    'Type a new code: 8 to 40 letters, numbers or dashes. Share it only with the people who score teach-backs. ' +
    'The old code stops working straight away.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var code = clean_(r.getResponseText());
  if (!/^[A-Za-z0-9-]{8,40}$/.test(code)) {
    ui.alert('The code was not saved. Use 8 to 40 letters, numbers or dashes, with no spaces.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('SCORER_CODE', code);
  ui.alert('Saved. The new scorer code works now.');
}

function menuShowLinks() {
  setup_();
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var site = String(props.getProperty('SITE_URL') || '').replace(/\/+$/, '');
  if (!/^https:\/\/[^\s]+$/.test(site)) {
    var r = ui.prompt('Site address', 'Paste the address of the website, for example https://winning-with-ai-checks.vercel.app', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    site = clean_(r.getResponseText()).replace(/\/+$/, '');
    if (!/^https:\/\/[^\s]+$/.test(site)) { ui.alert('That address must start with https://'); return; }
    props.setProperty('SITE_URL', site);
  }
  var html = linksHtml_(site, parseConfig_(sheetStore_(SpreadsheetApp.getActiveSpreadsheet()).readConfig()));
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(760).setHeight(560), 'Course check links');
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function linksHtml_(site, config) {
  var link = function (path, q) {
    var parts = Object.keys(q).filter(function (k) { return q[k]; }).map(function (k) { return k + '=' + encodeURIComponent(q[k]); });
    var url = site + path + (parts.length ? '?' + parts.join('&') : '');
    return '<a target="_blank" href="' + esc_(url) + '">' + esc_(url) + '</a>';
  };
  var item = function (label, html) { return '<p><b>' + esc_(label) + '</b><br>' + html + '</p>'; };
  var block = function (title, cohort, audience) {
    var h = '<h3>' + esc_(title) + '</h3>';
    if (audience !== 'trainers') {
      h += item('Participants, start of the course', link('/check', { stage: 'before', cohort: cohort }));
      h += item('Participants, end of the course', link('/check', { stage: 'after', cohort: cohort }));
      h += item('Projector, start of the course', link('/show', { audience: 'participants', stage: 'before', cohort: cohort }));
      h += item('Projector, end of the course', link('/show', { audience: 'participants', stage: 'after', cohort: cohort }));
    }
    if (audience !== 'participants') {
      h += item('Trainers, start of the training', link('/trainer', { stage: 'before', cohort: cohort }));
      h += item('Trainers, end of the training', link('/trainer', { stage: 'after', cohort: cohort }));
      h += item('Teach-back scoring (share only with scorers)', link('/trainer/score', { cohort: cohort }));
      h += item('Projector, trainer check start', link('/show', { audience: 'trainers', stage: 'before', cohort: cohort }));
      h += item('Projector, trainer check end', link('/show', { audience: 'trainers', stage: 'after', cohort: cohort }));
    }
    return h;
  };
  var out = '<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#0a2240">';
  out += '<p style="color:#55657a">Each cohort in the Config tab has its own links. A cohort name in a link keeps that group\'s results together in the summaries.</p>';
  config.forEach(function (c) {
    out += block(c.cohort + (c.audience ? ' (' + c.audience + ')' : '') + (c.status === 'closed' ? ', closed' : ''), c.cohort, c.audience);
  });
  out += block('Without a cohort name', '', '');
  return out + '</div>';
}
