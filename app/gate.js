// Access lock for the phone app: email -> host approves -> 6-digit code by email -> play for 3 hours.
// build.js adds this only when app/gate-config.json has the Google web app URL.
(() => {
  const URL_ = '__GATE_URL__';
  const STORE = 'dwz-access';
  const read = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; } };
  const write = o => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const device = () => { const u = navigator.userAgent; return /iPad|Macintosh.*Mobile/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(u) ? 'iPhone' : /Android/.test(u) ? (/Mobile/.test(u) ? 'Android phone' : 'Android tablet') : 'Computer'; };
  const api = o => fetch(URL_, { method: 'POST', body: JSON.stringify(o) }).then(r => r.json());

  const css = document.createElement('style');
  css.textContent = `
#gate{position:fixed;inset:0;z-index:9999;background:var(--bg);overflow:auto;display:flex;align-items:flex-start;justify-content:center;
  padding:max(24px,env(safe-area-inset-top,0px)) 16px 24px}
#gate[hidden]{display:none}
#gate .g-card{width:100%;max-width:420px;margin-top:4vh;background:var(--surface);border:3px solid var(--ink);border-radius:18px;padding:22px 18px;display:flex;flex-direction:column;gap:14px;box-shadow:0 8px 0 var(--t)}
#gate h1{font-family:var(--f-display);font-size:1.35rem;margin:0;line-height:1.15}
#gate h1 span{background:var(--banana);padding:0 6px;border-radius:6px}
#gate p{margin:0}
#gate label{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:.92rem}
#gate input[type=email],#gate input[type=text]{font:inherit;font-size:1.05rem;padding:12px;border:2px solid var(--ink);border-radius:12px;background:#fff;color:var(--ink);width:100%}
#gate input.code{font-family:var(--f-display);font-size:1.7rem;letter-spacing:.35em;text-align:center}
#gate .chk{flex-direction:row;align-items:flex-start;gap:10px;font-weight:400;font-size:.86rem;color:var(--muted)}
#gate .chk input{width:22px;height:22px;flex:none;margin:0;accent-color:var(--t)}
#gate .g-btn{font:inherit;font-weight:700;font-size:1.02rem;min-height:52px;border-radius:14px;border:3px solid var(--ink);background:var(--banana);color:var(--ink);cursor:pointer}
#gate .g-btn:disabled{opacity:.5}
#gate .g-link{background:none;border:0;color:var(--t);font:inherit;font-weight:600;text-decoration:underline;cursor:pointer;padding:6px;align-self:center}
#gate .g-msg{font-size:.9rem;padding:10px 12px;border-radius:12px;background:var(--sunk)}
#gate .g-msg.err{background:#FDE3E8;color:var(--bad)}
#gate .g-msg.ok{background:#DDF3E4;color:var(--good)}
#gate .wait{display:flex;align-items:center;gap:10px}
#gate .dot{width:12px;height:12px;border-radius:50%;background:var(--t);animation:gpulse 1.2s ease-in-out infinite}
@keyframes gpulse{50%{transform:scale(.5);opacity:.4}}
#gate .small{font-size:.8rem;color:var(--muted)}`;
  document.head.appendChild(css);
  const gate = document.createElement('div');
  gate.id = 'gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  document.body.appendChild(gate);

  let poll = null, lockTimer = null;
  const head = `<h1>Die With <span>Zero</span> Simulator</h1>`;

  function lock() {
    gate.hidden = false;
    if (window.dwzLock) window.dwzLock(true);
    const s = read();
    s.req ? showWait(s) : showRequest(s.expired ? 'Your 3 hours are up. Your game is saved. Ask for a new code to keep playing.' : '');
  }
  function unlock(exp) {
    gate.hidden = true; clearInterval(poll);
    if (window.dwzLock) window.dwzLock(false);
    clearTimeout(lockTimer);
    // setTimeout can't wait longer than ~24 days; 3 hours is fine.
    lockTimer = setTimeout(expire, Math.max(0, exp - Date.now()));
  }
  function expire() { write({ expired: true, email: read().email }); lock(); }
  function msg(text, kind) { return text ? `<p class="g-msg ${kind || ''}">${esc(text)}</p>` : ''; }

  function showRequest(note, kind) {
    clearInterval(poll);
    const s = read();
    gate.innerHTML = `<form class="g-card" novalidate>${head}
      <p>Enter your email to ask the host for a game code. The code is valid for 3 hours on this device.</p>
      ${msg(note, kind)}
      <label>Email<input type="email" name="email" autocomplete="email" inputmode="email" required value="${esc(s.email || '')}"></label>
      <label>Group or table name (optional)<input type="text" name="group" maxlength="30" value="${esc(s.group || '')}"></label>
      <label class="chk"><input type="checkbox" name="agree" required><span>I agree that my email is used to send my game code and to record who played.</span></label>
      <label class="chk"><input type="checkbox" name="contact"><span>Optional: you may contact me about future events.</span></label>
      <button class="g-btn" type="submit">Request code</button>
    </form>`;
    const f = gate.querySelector('form');
    f.onsubmit = e => {
      e.preventDefault();
      const email = f.email.value.trim(), group = f.group.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showRequestErr(f, 'Please enter a valid email.');
      if (!f.agree.checked) return showRequestErr(f, 'Please tick the box to agree before continuing.');
      const b = f.querySelector('.g-btn'); b.disabled = true; b.textContent = 'Sending…';
      api({ action: 'request', email, group, device: device(), contact: f.contact.checked })
        .then(r => { if (!r.ok) throw new Error(r.error); const s2 = { req: r.id, email, group }; write(s2); showWait(s2); })
        .catch(err => { b.disabled = false; b.textContent = 'Request code'; showRequestErr(f, err.message.includes('fetch') ? 'No internet connection. Please check and try again.' : err.message); });
    };
  }
  function showRequestErr(f, text) {
    const old = f.querySelector('.g-msg'); if (old) old.remove();
    f.querySelector('p').insertAdjacentHTML('afterend', msg(text, 'err'));
  }

  function showWait(s, note, kind) {
    gate.innerHTML = `<form class="g-card" novalidate>${head}
      <div class="wait" id="gStatus"><i class="dot"></i><b>Waiting for the host to approve…</b></div>
      <p class="small">Request sent for <b>${esc(s.email)}</b>. When the host approves, a 6-digit code arrives by email. Check your spam folder too.</p>
      ${msg(note, kind)}
      <label>Game code<input class="code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></label>
      <button class="g-btn" type="submit">Start playing</button>
      <button class="g-link" type="button" data-g="restart">Use a different email</button>
    </form>`;
    const f = gate.querySelector('form');
    f.querySelector('[data-g=restart]').onclick = () => { write({ email: s.email, group: s.group }); showRequest(); };
    f.onsubmit = e => {
      e.preventDefault();
      const code = f.code.value.replace(/\D/g, '');
      if (code.length !== 6) return showWait(s, 'The code has 6 digits.', 'err');
      const b = f.querySelector('.g-btn'); b.disabled = true; b.textContent = 'Checking…';
      api({ action: 'verify', id: s.req, code })
        .then(r => { if (!r.ok) throw new Error(r.error); write({ exp: r.expires, email: s.email, group: s.group }); unlock(r.expires); })
        .catch(err => { const m = err.message.includes('fetch') ? 'No internet connection. Please check and try again.' : err.message;
          /request a new/i.test(m) ? (write({ email: s.email, group: s.group }), showRequest(m, 'err')) : showWait(s, m, 'err'); });
    };
    clearInterval(poll);
    const check = () => api({ action: 'status', id: s.req }).then(r => {
      const el = document.getElementById('gStatus'); if (!el) return;
      if (!r.ok) { clearInterval(poll); write({ email: s.email, group: s.group }); return showRequest('Your request was not found. Please request again.', 'err'); }
      if (r.status === 'approved') { clearInterval(poll); el.outerHTML = msg('Approved! Your code has been emailed. Enter it below.', 'ok'); }
      else if (r.status === 'rejected' || r.status === 'blocked' || r.status === 'expired') {
        clearInterval(poll); write({ email: s.email, group: s.group });
        showRequest(r.status === 'rejected' ? 'The host did not approve this request.' : r.status === 'blocked' ? 'Too many wrong codes. Please request a new one.' : 'That code has expired. Please request a new one.', 'err');
      }
    }).catch(() => {});
    check(); poll = setInterval(check, 4000);
  }

  // Start: unlocked if this device still has time left.
  const s = read();
  if (s.exp && s.exp > Date.now()) unlock(s.exp);
  else { if (s.exp) write({ expired: true, email: s.email, group: s.group }); lock(); }
  // Phones pause timers in the background, so re-check when the app comes back.
  document.addEventListener('visibilitychange', () => { const t = read(); if (!document.hidden && gate.hidden && !(t.exp > Date.now())) expire(); });
})();
