/**
 * Die With Zero Simulator: access codes with host approval.
 *
 * Flow: a device asks for access with an email -> the host approves it on the admin page ->
 * a 6-digit code is emailed from the host's Gmail -> the device enters the code and can play for 3 hours.
 * Each code works once, on one device. Every request is a row in the "Requests" sheet.
 *
 * Setup: see SETUP ACCESS CODES.md. After pasting, run setup() once, then deploy as a web app.
 */
const VALID_HOURS = 3;
const MAX_TRIES = 5;          // wrong codes before a request is blocked
const MAX_PENDING = 100;      // stops anyone flooding the sheet
const SHEET = 'Requests';
const GAME = 'Die With Zero Simulator';
const COLS = ['Requested', 'ID', 'Email', 'Group', 'Device', 'Contact OK', 'Status', 'Code hash', 'Expires', 'Approved', 'Unlocked', 'Tries'];
const C = Object.fromEntries(COLS.map((c, i) => [c, i + 1]));

// Run once from the editor. The admin link is printed in the log.
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());
  sheet_();
  Logger.log('Setup done. After you deploy, your approval page is: <web app URL>?admin=' + props.getProperty('ADMIN_KEY'));
}

function doGet(e) {
  const key = (e && e.parameter && e.parameter.admin) || '';
  if (key && key === adminKey_()) {
    const t = HtmlService.createTemplateFromFile('Admin');
    t.key = key;
    return t.evaluate().setTitle('Approve players · ' + GAME).addMetaTag('viewport', 'width=device-width,initial-scale=1');
  }
  return ContentService.createTextOutput(GAME + ' access server is running.');
}

// The game sends plain-text JSON posts (no CORS preflight).
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    if (body.action === 'request') return json_(request_(body));
    if (body.action === 'status') return json_(status_(body));
    if (body.action === 'verify') return json_(verify_(body));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: 'Server error, please try again' });
  }
}

/* ---------- player side ---------- */
function request_(b) {
  const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Please enter a valid email' };
  const group = clean_(b.group, 30), device = clean_(b.device, 80);
  return withLock_(() => {
    const sh = sheet_(), rows = rows_(sh);
    // Same email still waiting: reuse that request instead of adding another.
    const same = rows.find(r => r.Email === email && r.Status === 'pending');
    if (same) return { ok: true, id: same.ID };
    if (rows.filter(r => r.Status === 'pending').length >= MAX_PENDING) return { ok: false, error: 'Too many requests waiting. Ask the host.' };
    const id = Utilities.getUuid();
    sh.appendRow([new Date(), id, email, group, device, b.contact ? 'Yes' : 'No', 'pending', '', '', '', '', 0]);
    return { ok: true, id };
  });
}

function status_(b) {
  const r = find_(b.id);
  if (!r) return { ok: false, error: 'Request not found' };
  const expired = r.Status === 'approved' && r.Expires && new Date(r.Expires) < new Date();
  return { ok: true, status: expired ? 'expired' : r.Status, email: r.Email };
}

function verify_(b) {
  const code = String(b.code || '').replace(/\D/g, '');
  return withLock_(() => {
    const r = find_(b.id);
    if (!r) return { ok: false, error: 'Request not found. Please request a new code.' };
    if (r.Status === 'pending') return { ok: false, error: 'The host has not approved this request yet.' };
    if (r.Status === 'unlocked') return { ok: false, error: 'This code has already been used. Please request a new one.' };
    if (r.Status !== 'approved') return { ok: false, error: 'This request was ' + r.Status + '. Please request a new code.' };
    const exp = new Date(r.Expires);
    if (exp < new Date()) return { ok: false, error: 'This code has expired. Please request a new one.' };
    if (hash_(code) !== r['Code hash']) {
      const tries = Number(r.Tries || 0) + 1;
      r.sheet.getRange(r.row, C.Tries).setValue(tries);
      if (tries >= MAX_TRIES) { r.sheet.getRange(r.row, C.Status).setValue('blocked'); return { ok: false, error: 'Too many wrong codes. Please request a new one.' }; }
      return { ok: false, error: 'Wrong code. ' + (MAX_TRIES - tries) + ' tries left.' };
    }
    r.sheet.getRange(r.row, C.Status).setValue('unlocked');
    r.sheet.getRange(r.row, C.Unlocked).setValue(new Date());
    return { ok: true, expires: exp.getTime() };
  });
}

/* ---------- host side (called from Admin.html) ---------- */
function adminList(key) {
  checkKey_(key);
  const since = Date.now() - 24 * 3600e3, now = new Date();
  const rows = rows_(sheet_()).filter(r => new Date(r.Requested).getTime() > since || r.Status === 'pending');
  return {
    quota: MailApp.getRemainingDailyQuota(),
    rows: rows.reverse().map(r => ({
      id: r.ID, email: r.Email, group: r.Group, device: r.Device, contact: r['Contact OK'],
      status: r.Status === 'approved' && r.Expires && new Date(r.Expires) < now ? 'expired' : r.Status,
      requested: new Date(r.Requested).getTime(), expires: r.Expires ? new Date(r.Expires).getTime() : null
    }))
  };
}

function adminApprove(key, id) {
  checkKey_(key);
  return withLock_(() => {
    const r = find_(id);
    if (!r || r.Status !== 'pending') return { ok: false, error: 'Already handled' };
    const code = String(100000 + Math.floor(Math.random() * 900000));
    const exp = new Date(Date.now() + VALID_HOURS * 3600e3);
    const until = Utilities.formatDate(exp, 'Asia/Kuala_Lumpur', 'h:mm a');
    MailApp.sendEmail({
      to: r.Email, name: GAME,
      subject: 'Your ' + GAME + ' code: ' + code,
      body: 'Your game code is ' + code + '\n\nEnter it on the game screen to start playing. It works once, on one device, until ' + until + ' (Malaysia time).\n\nIf you did not ask for this code, you can ignore this email.',
      htmlBody: '<div style="font-family:Arial,sans-serif;font-size:16px;color:#111">' +
        '<p>Your game code is</p><p style="font-size:34px;font-weight:bold;letter-spacing:6px;background:#FFE135;display:inline-block;padding:8px 18px;border:3px solid #1C56C4;border-radius:12px">' + code + '</p>' +
        '<p>Enter it on the game screen to start playing. It works <b>once, on one device</b>, until <b>' + until + '</b> (Malaysia time).</p>' +
        '<p style="color:#555;font-size:13px">If you did not ask for this code, you can ignore this email.</p></div>'
    });
    r.sheet.getRange(r.row, C.Status).setValue('approved');
    r.sheet.getRange(r.row, C['Code hash']).setValue(hash_(code));
    r.sheet.getRange(r.row, C.Expires).setValue(exp);
    r.sheet.getRange(r.row, C.Approved).setValue(new Date());
    return { ok: true };
  });
}

function adminReject(key, id) {
  checkKey_(key);
  return withLock_(() => {
    const r = find_(id);
    if (!r || r.Status !== 'pending') return { ok: false, error: 'Already handled' };
    r.sheet.getRange(r.row, C.Status).setValue('rejected');
    return { ok: true };
  });
}

/* ---------- helpers ---------- */
function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(COLS); sh.setFrozenRows(1); sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold'); }
  return sh;
}
function rows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, COLS.length).getValues().map((v, i) => {
    const o = { row: i + 2, sheet: sh };
    COLS.forEach((c, j) => o[c] = v[j]);
    return o;
  });
}
function find_(id) {
  if (!id) return null;
  const sh = sheet_();
  const hit = sh.getRange('B:B').createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!hit) return null;
  return rows_(sh).find(r => r.row === hit.getRow()) || null;
}
function hash_(code) {
  const salt = PropertiesService.getScriptProperties().getProperty('SALT') || '';
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + code)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function adminKey_() { return PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || ''; }
function checkKey_(key) { if (!key || key !== adminKey_()) throw new Error('Not allowed'); }
function clean_(v, n) { return String(v || '').replace(/[\r\n\t]+/g, ' ').replace(/^[=+\-@]+/, '').trim().slice(0, n); }
function withLock_(fn) { const l = LockService.getScriptLock(); l.waitLock(10000); try { return fn(); } finally { l.releaseLock(); } }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
