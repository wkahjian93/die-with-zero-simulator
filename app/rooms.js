// Workshop rooms add-on. build.js adds it when a server address is set; the game file itself is not edited.
// It covers the game with the room screens, and swaps only the game's save/load so state lives on the server.
// Every phone in a room draws the real game. Only the phone whose turn it is can change it.
// The token here only identifies this device. Every permission is decided by the server.
(() => {
  const API = '__ROOMS_API__';
  const STORE = 'dwz-room-session';
  const SETTINGS = { timer: true, minutes: 4, keepLEP: true };   // same as the setup screen's defaults
  const STATUS = { lobby: 'Forming', awaiting_owner: 'Waiting for Owner Approval', approved: 'Approved', playing: 'Playing', completed: 'Finished', rejected: 'Not approved', revoked: 'Closed', abandoned: 'Closed' };

  let token = null; try { token = localStorage.getItem(STORE); } catch (e) {}
  let me = null, screen = '', msg = '', closed = false, endedNote = false;
  const OPEN_ACTS = new Set(['menu', 'close', 'table', 'soundAll', 'sfx', 'music', 'newgame']);   // work on every phone
  let role = null, version = 0, dirty = null, sending = false, entering = false, offline = false, clockGap = 0, lastVote = '';
  let ws = null, wsOpen = false, wsTries = 0, pingT = null, pollT = null, retryT = null;

  const css = document.createElement('style');
  css.textContent = `
#rm{position:fixed;inset:0;z-index:40;background:var(--bg);overflow:auto;-webkit-overflow-scrolling:touch}
#rm[hidden]{display:none}
#rm .wrap{padding-bottom:40px}
#rm input[type=text]{font:inherit;font-size:1.05rem;padding:12px;border:2px solid var(--ink);border-radius:12px;background:#fff;color:var(--ink);width:100%}
#rm .list{display:flex;flex-direction:column;gap:8px}
#rm .line{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line)}
#rm .line:first-child{border-top:0}
#rm .line b{overflow-wrap:anywhere}
#rm .line .row{flex:none;gap:6px}
#rm .line .btn{min-height:44px;padding:8px 12px}
#rm .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--good);margin-right:6px}
#rm .dot.off{background:var(--line)}
#rm .wait{display:flex;align-items:center;gap:10px;font-weight:700}
#rm .pulse{width:12px;height:12px;border-radius:50%;background:var(--t);animation:rmpulse 1.2s ease-in-out infinite;flex:none}
@keyframes rmpulse{50%{transform:scale(.5);opacity:.4}}
@media (prefers-reduced-motion: reduce){#rm .pulse{animation:none}}
#rmOff{position:fixed;inset:0;z-index:60;background:color-mix(in srgb,var(--ink) 60%,transparent);display:flex;align-items:center;justify-content:center;padding:16px}
#rmOff[hidden]{display:none}
body.rm-watch .anim-scrim .skip{display:none}
#rmTurn{margin-bottom:12px;font-weight:700}
#rmOff div{background:var(--surface);border-radius:14px;padding:18px;max-width:340px;text-align:center;display:flex;flex-direction:column;gap:6px}`;
  document.head.appendChild(css);
  const box = document.createElement('div');
  box.id = 'rm';
  box.innerHTML = `<div class="wrap"><p class="muted">Loading…</p></div>`;
  document.body.appendChild(box);
  const off = document.createElement('div');
  off.id = 'rmOff'; off.hidden = true;
  off.innerHTML = `<div role="alert"><b>Reconnecting…</b><span class="small muted">Your game is safe. It continues when the connection is back.</span></div>`;
  document.body.appendChild(off);

  /* ---------- game hooks ---------- */
  window.loadSaved = () => null;
  window.save = () => { if (role === 'control' && state) { dirty = JSON.stringify(state); flush(); } };
  const baseUndo = ACTIONS.undo;
  ACTIONS.undo = (...a) => { if (state && state.phase === 'final') return toast('The game has finished'); baseUndo(...a); };
  ACTIONS.discard = () => {};
  const baseFinish = ACTIONS.finish;
  ACTIONS.finish = (...a) => { if (!me || !me.room || !me.room.isLeader) { closeLayer(); return toast('Only the Room Leader can end the game'); } baseFinish(...a); };
  ACTIONS.newgame = () => {
    if (me && me.room && me.room.status === 'completed') { closeLayer(); return act(`/api/rooms/${me.room.id}/leave`); }
    closeLayer(); toast('Only the Game Owner can close a room');
  };
  // Option B dare: the other players vote on their own phones. The server counts, and the player's phone applies the result.
  const baseVote = ACTIONS.careerVote;
  const inDare = () => !!state && !!state.pending && state.pending.k === 'career';
  const onDare = () => !!me && !!me.room && me.room.seat === state.cur;
  ACTIONS.careerVote = async res => {
    const v = me.room.vote;
    if (!inDare()) return;
    if (onDare()) { if (v && !v.total) baseVote(res); else toast('The other players vote on your dare'); return; }
    document.querySelectorAll('[data-act=careerVote]').forEach(el => { el.disabled = true; });
    try { await api('POST', `/api/rooms/${me.room.id}/vote`, { pass: res === 'pass' }); await refresh(); }
    catch (e) { if (e.code !== 'session_invalid') { toast(e.message); await refresh(); } }
  };
  function applyVote(r) {
    const text = JSON.stringify(r.vote || null);
    if (text !== lastVote) { lastVote = text; if (role && state) render(); }
    if (r.vote && r.vote.result && role === 'control' && inDare() && !busy) { baseVote(r.vote.result); history = []; }
  }
  function paintVote() {
    const v = me.room.vote, mine = onDare(), alone = v && !v.total, voted = v && v.mine != null;
    document.querySelectorAll('[data-act=careerVote]').forEach(el => { el.disabled = mine ? !alone : !!voted; });
    const cancel = document.querySelector('[data-act=careerCancel]');
    if (cancel && v && v.pass + v.fail) cancel.disabled = true;
    const line = document.querySelector('[data-act=careerVote]'), box = line && line.closest('.row');
    if (!box || !v || alone) return;
    const p = document.createElement('p');
    p.className = 'small'; p.id = 'rmVote';
    p.textContent = `${mine ? 'The other players vote on your dare. ' : voted ? 'Your vote is in. ' : ''}PASS ${v.pass} · FAIL ${v.fail} · ${v.need} of ${v.total} PASS votes needed`;
    box.before(p);
  }
  const baseRender = render;
  window.render = () => {
    baseRender();
    if (!role || !state) return;
    paintTurn();
    if (role !== 'control') document.querySelectorAll('#app [data-act],#bottomBar [data-act],#app input,#app select').forEach(el => { if (!OPEN_ACTS.has(el.dataset.act)) el.disabled = true; });
    if (inDare()) paintVote();
  };
  function paintTurn() {
    const app = document.getElementById('app');
    let el = document.getElementById('rmTurn');
    const cur = state.phase === 'turn' || state.phase === 'risk' ? state.players[state.cur] : null, r = me.room;
    let text = '';
    if (state.phase !== 'final') {
      if (role === 'control') text = !cur ? 'You are the Room Leader. Tap to continue for everyone.' : r.seat === state.cur ? 'Your turn' : `${cur.name} is away. You are playing for them.`;
      else text = cur ? `${cur.name}'s turn. Your buttons turn on when it's your turn.` : `Waiting for ${r.leader} to continue.`;
    }
    if (!SFX.running() && (SFX.prefs.sfx || SFX.prefs.music)) text += ' Tap anywhere for sound.';
    if (!text) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'rmTurn'; el.className = 'banner info'; app.prepend(el); }
    el.textContent = text;
  }
  // Only the phone in control keeps the turn clock; the others get it with each update.
  const baseHold = holdTimer;
  window.holdTimer = ms => { if (role === 'control') baseHold(ms); };

  /* ---------- the same sounds and animations on every phone in the room ---------- */
  const basePlay = SFX.play, baseBurst = burst, baseRoll = rollAnimation, baseDraw = drawAnimation;
  const sendFx = o => { if (role === 'control' && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'fx', fx: o })); };
  const linkSkip = () => { const b = document.querySelector('.anim-scrim .skip'); if (b) b.addEventListener('click', () => sendFx({ k: 'x' })); };
  // The tap click stays on the phone that tapped, and each phone runs its own time's-up alarm.
  SFX.play = (n, d) => { basePlay(n, d); if (n !== 'click' && n !== 'alarm') sendFx({ k: 's', n, d }); };
  window.burst = (kind, label, delay) => { baseBurst(kind, label, delay); sendFx({ k: 'b', a: kind, t: label, d: delay }); };
  window.rollAnimation = (a, b, done) => { sendFx({ k: 'r', a, b }); baseRoll(a, b, done); linkSkip(); };
  window.drawAnimation = (kind, done) => { sendFx({ k: 'd', a: kind }); baseDraw(kind, done); linkSkip(); };
  function playFx(f) {
    const die = v => Math.min(6, Math.max(1, Math.floor(+v) || 1));
    if (f.k === 's') basePlay(String(f.n), +f.d || 0);
    else if (f.k === 'b' && BURST[f.a]) baseBurst(f.a, String(f.t || '').replace(/</g, '').slice(0, 60), +f.d || 0);
    else if (f.k === 'r' && !busy) baseRoll(die(f.a), die(f.b), () => {});
    else if (f.k === 'd' && !busy) baseDraw(f.a === 'risk' ? 'risk' : 'dare', () => {});
    else if (f.k === 'x') { const b = document.querySelector('.anim-scrim .skip'); if (b) b.click(); }
  }
  // Music position comes from the room's start time on the server clock, so every phone plays the same bar.
  async function syncClock() {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      try {
        const r = await api('GET', '/api/status'), t1 = Date.now();
        if (t1 - t0 < best && r.now) { best = t1 - t0; clockGap = r.now - (t0 + t1) / 2; }
      } catch (e) { return; }
    }
    alignMusic();
  }
  function alignMusic() { if (role && me && me.room && me.room.startedAt) SFX.align(Date.now() + clockGap - me.room.startedAt); }
  setInterval(alignMusic, 8000);
  // Phones only allow sound after a tap, so any tap turns it on. Music plays only during a game.
  const wake = () => { SFX.unlock(); if (!role) SFX.quiet(true); else { alignMusic(); if (state) paintTurn(); } };
  document.addEventListener('click', wake, true);
  document.addEventListener('touchend', wake, true);
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !role || role === 'control' || OPEN_ACTS.has(b.dataset.act) || b.dataset.act === 'careerVote') return;
    e.stopPropagation();
    toast("It's not your turn yet");
  }, true);

  async function flush() {
    if (sending || !dirty || role !== 'control') return;
    sending = true;
    const text = dirty; dirty = null;
    try {
      const r = await api('POST', `/api/rooms/${me.room.id}/state`, { version: version + 1, state: JSON.parse(text) });
      version = r.version;
      setOffline(false);
      if (r.status === 'completed') await refresh();
      else { setRole(r.controller === me.session.id ? 'control' : 'watch'); applyVote(me.room); }
    } catch (e) {
      if (e.network) { dirty = dirty || text; setOffline(true); clearTimeout(retryT); retryT = setTimeout(flush, 2500); }
      else { role = null; dirty = null; await refresh(); }   // revoked, ended or control moved on: the server's answer decides
    }
    sending = false;
    if (dirty && !offline) flush();
  }
  function setOffline(on) {
    if (on === offline) return;
    offline = on; off.hidden = !on;
    if (role === 'control' && window.dwzLock) window.dwzLock(on); else SFX.quiet(on);
  }
  function setRole(want) {
    if (want === role) return;
    const was = role;
    role = want;
    document.body.classList.toggle('rm-watch', want === 'watch');
    if (want === 'watch') history = [];
    else if (was === 'watch') { try { navigator.vibrate && navigator.vibrate(200); } catch (e) {} toast('Your turn'); }
    render();
  }
  function takeState(m) {
    if (m.version <= version && role) return;
    version = m.version; state = m.state; history = []; dirty = null;
    if (!me || !me.room) return;
    const want = m.controller === me.session.id ? 'control' : 'watch';
    if (want === role) render(); else setRole(want);
    draw();
  }

  /* ---------- server ---------- */
  async function api(method, path, body) {
    let res;
    try {
      const stop = new AbortController(), t = setTimeout(() => stop.abort(), 10000);   // a stalled connection counts as offline
      res = await fetch(API + path, { method, cache: 'no-store', signal: stop.signal, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
      clearTimeout(t);
    } catch (e) { throw Object.assign(new Error('No connection. Please check your internet and try again.'), { network: true }); }
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { signOut(j.error); throw Object.assign(new Error(j.error || 'Session ended'), { code: 'session_invalid' }); }
    if (!res.ok) throw Object.assign(new Error(j.error || 'That did not work. Please try again.'), { code: j.code, status: res.status });
    return j;
  }
  function setToken(t) { token = t; try { t ? localStorage.setItem(STORE, t) : localStorage.removeItem(STORE); } catch (e) {} }
  function signOut(note) {
    setToken(null); me = null; msg = note || '';
    leaveGame(); if (ws) { try { ws.close(); } catch (e) {} }
    start();
  }
  function leaveGame() {
    role = null; dirty = null; version = 0;
    setOffline(false);
    SFX.quiet(true);
    document.body.classList.remove('rm-watch');
    if (state) { state = null; history = []; ui.view = null; render(); }
    box.hidden = false;
  }
  async function refresh() { try { apply(await api('GET', '/api/me')); } catch (e) { if (e.network) draw(); } }
  async function act(path, body) {
    msg = '';
    try { const r = await api('POST', path, body || {}); await refresh(); return r; }
    catch (e) { if (e.code !== 'session_invalid') { msg = e.message; await refresh(); draw(); } return null; }
  }

  /* ---------- live link, with slow polling if the venue Wi-Fi blocks it ---------- */
  function connect() {
    if (!token || (ws && ws.readyState <= 1)) return;
    ws = new WebSocket(API.replace(/^http/, 'ws') + '/api/live');
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'auth', token })); };
    ws.onmessage = e => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data);
      if (m.type === 'me') { wsOpen = true; wsTries = 0; apply(m); }
      else if (m.type === 'rooms' && me && !me.room) { me.rooms = m.rooms; draw(); }
      else if (m.type === 'state') takeState(m);
      else if (m.type === 'fx') { if (role === 'watch') playFx(m.fx); }
      else if (m.type === 'ended') { endedNote = true; signOut(''); }
    };
    ws.onclose = e => {
      wsOpen = false; ws = null;
      if (e.code === 4001 || e.code === 4003 || !token) return;
      setTimeout(connect, Math.min(8000, 1000 * ++wsTries));
    };
    clearInterval(pingT);
    pingT = setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 25000);
    clearInterval(pollT);
    pollT = setInterval(() => { if (token && !wsOpen) refresh(); }, 8000);
  }

  /* ---------- deciding what this device shows ---------- */
  function apply(m) {
    me = m;
    const r = m.room;
    if (r && (r.status === 'playing' || r.status === 'completed') && r.myStatus === 'approved') return enterGame(r);
    if (role) leaveGame();
    draw();
  }
  async function enterGame(r) {
    const want = r.controller === me.session.id ? 'control' : 'watch';
    if (role && r.stateVersion <= version) { setRole(want); applyVote(r); return draw(); }
    if (entering || dirty || sending) return;
    entering = true;
    try {
      const s = await api('GET', `/api/rooms/${r.id}/state`), first = !role;
      version = s.version;
      if (s.state) {
        state = s.state; history = []; ui.view = null;
        if (want === role) render(); else setRole(want);
      } else if (want === 'control') {
        history = []; ui.view = null;
        newGame(cleanNames(r.players.map(p => p.name)), { ...SETTINGS });
        setRole(want);
        save();
      }
      if (first && role) { SFX.quiet(false); syncClock(); }
      if (role) applyVote(r);
    } catch (e) {
      if (!e.network && e.code !== 'session_invalid') role = null;
    }
    entering = false;
    draw();
  }

  /* ---------- screens ---------- */
  const hero = `<section class="hero"><p class="eyebrow">Workshop</p><h1>Die With <span>Zero</span> Simulator</h1></section>`;
  const note = t => t ? `<div class="banner" role="alert">${esc(t)}</div>` : '';
  const waitLine = t => `<div class="card"><div class="wait"><i class="pulse"></i><span>${esc(t)}</span></div></div>`;
  const roomList = list => list.length
    ? list.map(r => `<div class="line"><div><b>${esc(r.name)}</b><p class="small muted">Leader: ${esc(r.leader)} · ${r.players}/${r.capacity} players</p></div><button class="btn ghost" data-r="join" data-id="${r.id}">Request to join</button></div>`).join('')
    : `<p class="small muted">No rooms to join yet. Create one, or wait for a room to appear here.</p>`;

  function pageName() {
    return `${hero}${note(msg)}<form class="card" data-f="name"><div class="field"><label for="rmName">Your display name</label>
      <input type="text" id="rmName" maxlength="18" autocomplete="off" required></div>
      <button class="btn lep block" type="submit">Continue</button>
      <p class="small muted">No account or email is needed. Your name is shown to others in this workshop.</p></form>`;
  }
  function pageClosed() {
    return `${hero}${endedNote ? '<div class="banner info">This workshop has ended. Thank you for playing.</div>' : waitLine('The workshop is not open yet. This page will update by itself.')}`;
  }
  function pageHome() {
    return `${hero}<p class="muted">Hi <b>${esc(me.session.name)}</b>.</p>${note(msg || me.notice)}
      <form class="card" data-f="create"><h3>Create Game Room</h3><div class="field"><label for="rmRoom">Room name</label>
      <input type="text" id="rmRoom" maxlength="30" autocomplete="off" required></div>
      <button class="btn lep block" type="submit">Create Game Room</button></form>
      <div class="card"><h3>Join Existing Game Room</h3><div class="list" id="rmList">${roomList(me.rooms || [])}</div></div>`;
  }
  function pageRoom(r) {
    const head = `<section class="hero"><p class="eyebrow">Game room · ${esc(STATUS[r.status] || r.status)}</p><h1>${esc(r.name)}</h1></section>`;
    if (r.myStatus === 'pending') return `${head}${note(msg)}${waitLine(`Waiting for ${r.leader} to accept you…`)}
      <button class="btn ghost block" data-r="leave">Cancel request</button>`;
    if (['rejected', 'revoked', 'abandoned'].includes(r.status)) return `${head}<div class="banner">${esc(r.notice || 'This room is closed.')}</div>
      <p class="small muted">Creating another room needs new Owner Approval.</p><button class="btn lep block" data-r="leave">Back to rooms</button>`;
    const mine = r.players.find(p => p.id === me.session.id) || {};
    const ready = r.players.filter(p => p.ready).length;
    const players = `<div class="card"><div class="card-h"><h3>Players ${r.players.length}/${r.capacity}</h3>${r.status === 'lobby' ? `<span class="tag">${ready} ready</span>` : ''}</div>
      <div class="list">${r.players.map(p => `<div class="line"><span><i class="dot${p.online ? '' : ' off'}"></i><b>${esc(p.name)}</b>${p.leader ? ' <span class="tag">Leader</span>' : ''}</span>${r.status === 'lobby' || r.status === 'awaiting_owner' ? `<span class="tag ${p.ready ? 'ok' : ''}">${p.ready ? 'Ready' : 'Not ready'}</span>` : ''}</div>`).join('')}</div></div>`;
    const requests = r.requests.length && r.status === 'lobby' ? `<div class="card"><h3>Requests to join</h3><div class="list">${r.requests.map(q => `<div class="line"><b>${esc(q.name)}</b><span class="row"><button class="btn good" data-r="accept" data-id="${q.id}">Accept</button><button class="btn ghost" data-r="decline" data-id="${q.id}">Reject</button></span></div>`).join('')}</div></div>` : '';
    let main = '';
    if (r.status === 'lobby') {
      const all = r.players.length >= r.minPlayers && r.players.every(p => p.ready);
      main = `${r.isLeader ? '' : `<button class="btn lep block" data-r="ready" data-on="${mine.ready ? '' : '1'}">${mine.ready ? 'Not ready yet' : "I'm ready"}</button>`}
        ${r.isLeader ? `<button class="btn lep block" data-r="submit"${all ? '' : ' disabled'}>Send to Owner for approval</button>
        <p class="small muted">A full room of ${r.capacity} goes to the Owner by itself once everyone is ready. A smaller room needs at least ${r.minPlayers} players, all ready.</p>` : ''}`;
    } else if (r.status === 'awaiting_owner') {
      main = waitLine('Waiting for Owner Approval…');
    } else if (r.status === 'approved') {
      main = r.isLeader ? `<div class="banner info">The Owner has approved this room.</div><button class="btn lep block" data-r="start">Start game</button>` : waitLine(`Approved. Waiting for ${r.leader} to start the game…`);
    } else if (r.status === 'playing') {
      main = waitLine('Starting the game…');
    }
    return `${head}${note(msg)}${players}${requests}${main}
      ${r.status === 'lobby' || r.status === 'awaiting_owner' ? `<button class="btn ghost block" data-r="leave">Leave room</button>` : ''}`;
  }
  function draw() {
    if (role) { box.hidden = true; return; }
    box.hidden = false;
    let key, html;
    if (closed) { key = 'closed'; html = pageClosed(); }
    else if (!token || !me) { key = 'name'; html = pageName(); }
    else if (me.room) { key = 'room'; html = pageRoom(me.room); }
    else { key = 'home'; html = pageHome(); }
    // Keep typed text: an update to the room list must not redraw the form above it.
    if (key === screen && key === 'home' && !msg && !me.notice) { document.getElementById('rmList').innerHTML = roomList(me.rooms || []); return; }
    if (key === screen && key === 'name') return;
    screen = key;
    box.firstElementChild.innerHTML = html;
  }

  box.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.dataset.f;
    if (f === 'name') {
      const name = document.getElementById('rmName').value.trim();
      if (!name) return;
      try {
        const r = await api('POST', '/api/session', { name });
        setToken(r.token); msg = ''; endedNote = false; screen = '';
        await refresh(); connect();
      } catch (err) {
        if (err.code === 'workshop_closed') { closed = true; start(); return; }
        msg = err.message; screen = ''; draw();
      }
    } else if (f === 'create') {
      const name = document.getElementById('rmRoom').value.trim();
      if (name) { msg = ''; screen = ''; await act('/api/rooms', { name }); }
    }
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (!b || b.disabled) return;
    const id = b.dataset.id, room = me && me.room;
    b.disabled = true;
    const a = b.dataset.r;
    if (a === 'join') act(`/api/rooms/${id}/join`);
    else if (a === 'leave') { leaveGame(); act(`/api/rooms/${room.id}/leave`); }
    else if (a === 'accept') act(`/api/rooms/${room.id}/members/${id}/approve`);
    else if (a === 'decline') act(`/api/rooms/${room.id}/members/${id}/reject`);
    else if (a === 'ready') act(`/api/rooms/${room.id}/ready`, { ready: !!b.dataset.on });
    else if (a === 'submit') act(`/api/rooms/${room.id}/submit`);
    else if (a === 'start') act(`/api/rooms/${room.id}/start`);
  });

  /* ---------- start ---------- */
  async function start() {
    if (token) {
      closed = false;
      await refresh();
      if (token) connect();
      return;
    }
    try {
      const s = await api('GET', '/api/status');
      closed = !s.open;
    } catch (e) { closed = true; }
    screen = closed ? screen : '';
    draw();
    clearTimeout(start.t);
    if (closed) start.t = setTimeout(start, 5000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && token) { refresh(); connect(); alignMusic(); } });
  start();
})();
