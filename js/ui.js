/* Browser UI for Tell Hold'em. Drives the engine; bots act on timers. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RK = r => '23456789TJQKA'[r - 2].replace('T', '10');
  let g, timer = null, logShown = 0, seen = new Set();
  const BOT_DELAY = 750;

  function cardEl(c, opts = {}) {
    const d = document.createElement('div');
    if (!c || opts.back) { d.className = 'card back'; const key = 'b' + (c ? c.r + c.s : Math.random()); if (c && !seen.has(key)) { seen.add(key); d.classList.add('fresh'); } return d; }
    d.className = 'card' + (c.s === 'h' || c.s === 'd' ? ' red' : '') + (opts.cls ? ' ' + opts.cls : '');
    d.innerHTML = `<span class="r">${RK(c.r)}</span>${SUIT[c.s]}`;
    d.title = RK(c.r) + SUIT[c.s];
    const key = (opts.back ? 'b' : '') + c.r + c.s;
    if (!seen.has(key)) { seen.add(key); d.classList.add('fresh'); }
    return d;
  }
  const isWin = (c, cards) => cards && cards.some(x => x.r === c.r && x.s === c.s);

  function render() {
    $('blinds').textContent = `Hand ${g.handNo} · Blinds ${g.sb}/${g.bb}`;
    const sd = g.phase === 'showdown' || g.phase === 'gameover';
    const res = g.result;
    g.players.forEach((p, i) => {
      const el = $('seat' + i);
      const active = g.phase === 'betting' && g.toAct === i;
      el.className = el.className.replace(/ (active|folded|out|winner)/g, '') + (active ? ' active' : '') + (p.folded && !p.out ? ' folded' : '') + (p.out ? ' out' : '') + (sd && res && res.wins[i] > 0 ? ' winner' : '');
      const persona = !p.isHuman && THAI.PERSONAS[p.name] ? ` <small>${THAI.PERSONAS[p.name].desc}</small>` : '';
      el.innerHTML = `<div class="name">${p.name}${g.dealer === i ? '<span class="dealer">D</span>' : ''}${persona}</div><div class="stack">${p.out ? 'Eliminated' : p.stack + ' chips'}${p.allIn && !p.folded ? ' · ALL-IN' : ''}</div>`;
      const cs = document.createElement('div'); cs.className = 'cards';
      const reveal = p.isHuman || (sd && res && res.showdown && !p.folded);
      const hb = res && res.hands && res.hands[i];
      p.hole.forEach((c, k) => {
        const tell = p.tell === k;
        let cls = tell ? 'tell' : '';
        if (sd && hb) cls += isWin(c, hb.cards) ? ' win' : ' dim';
        const picking = p.isHuman && g.phase === 'tell' && p.tell < 0 && !p.folded;
        const e = cardEl(c, { back: !(reveal || tell) || (p.folded && !p.isHuman && !tell), cls: cls + (picking ? ' pick' : '') });
        if (picking) e.onclick = () => { TH.setTell(g, 0, k); afterHuman(); };
        cs.appendChild(e);
      });
      el.appendChild(cs);
      const hn = document.createElement('div'); hn.className = 'handname';
      if (hb) hn.textContent = hb.name; else if (p.isHuman && p.hole.length && !p.folded && g.board.length) hn.textContent = TH.bestHand(p.hole.concat(g.board)).name;
      el.appendChild(hn);
      const bc = document.createElement('div'); bc.className = 'betchip'; bc.textContent = p.bet ? p.bet : ''; el.appendChild(bc);
    });
    const b = $('board'); b.innerHTML = '';
    const winCards = res && res.hands ? Object.entries(res.hands).filter(([i]) => res.wins[i] > 0).flatMap(([, h]) => h.cards) : null;
    for (let k = 0; k < 5; k++) b.appendChild(g.board[k] ? cardEl(g.board[k], { cls: sd && winCards ? (isWin(g.board[k], winCards) ? 'win' : 'dim') : '' }) : Object.assign(document.createElement('div'), { className: 'card back', style: 'opacity:.12' }));
    $('street').textContent = g.phase === 'tell' ? 'The Tell' : sd ? 'Showdown' : TH.STREETS[g.street];
    $('pot').textContent = `Pot ${TH.pot(g)}`;
    renderLog(); renderControls();
  }
  function renderLog() {
    const L = $('log');
    for (; logShown < g.log.length; logShown++) { const d = document.createElement('div'); const m = g.log[logShown]; d.textContent = m; if (m.startsWith('—')) d.className = 'h'; L.appendChild(d); }
    L.scrollTop = L.scrollHeight;
  }
  function btn(t, f, cls) { const b = document.createElement('button'); b.textContent = t; b.onclick = f; if (cls) b.className = cls; return b; }

  function renderControls() {
    const C = $('controls'); C.innerHTML = ''; const banner = $('banner'); banner.textContent = '';
    const me = g.players[0];
    if (g.phase === 'gameover') {
      const alive = g.players.filter(p => !p.out);
      banner.textContent = me.out ? 'You busted! ' + (alive.length === 1 ? alive[0].name + ' wins the table.' : '') : 'You win the table! 🏆';
      C.appendChild(btn('Play again', newGame, 'primary')); return;
    }
    if (g.phase === 'showdown') {
      const w = g.result.wins.map((x, i) => x ? `${g.players[i].name} +${x}` : null).filter(Boolean).join(', ');
      banner.textContent = w;
      C.appendChild(btn('Next hand ▶', nextHand, 'primary')); return;
    }
    if (g.phase === 'tell') {
      if (me.tell < 0 && !me.folded) { banner.textContent = 'The Tell: click one of your cards to show it to the table.'; const t = document.createElement('span'); t.className = 'tip'; t.textContent = 'Tip: a card matching a flop rank earns the Echo bonus — but reveals your pair.'; C.appendChild(t); }
      return;
    }
    if (g.toAct !== 0) { const s = document.createElement('span'); s.className = 'tip'; s.textContent = me.folded ? 'You folded — watching the hand…' : `${g.players[g.toAct].name} is thinking…`; C.appendChild(s); if (me.folded) C.appendChild(btn('Skip to next hand', fastForward)); return; }
    const la = TH.legalActions(g); const pot = TH.pot(g);
    if (la.fold) C.appendChild(btn('Fold', () => human({ type: 'fold' }), 'danger'));
    if (la.check) C.appendChild(btn('Check', () => human({ type: 'check' })));
    else C.appendChild(btn(`Call ${la.call}`, () => human({ type: 'call' })));
    if (la.canRaise) {
      const r = document.createElement('input'); r.type = 'range'; r.min = la.minRaiseTo; r.max = la.maxRaiseTo; r.step = 1; r.value = la.minRaiseTo;
      const amt = document.createElement('span'); amt.className = 'amt';
      const label = g.currentBet === 0 ? 'Bet' : 'Raise to';
      const rb = btn('', () => human({ type: 'raise', to: +r.value }), 'primary');
      const upd = () => { amt.textContent = r.value; rb.textContent = `${+r.value >= la.maxRaiseTo ? 'All-in' : label} ${r.value}`; };
      r.oninput = upd; upd();
      const preset = (t, v) => btn(t, () => { r.value = Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, v)); upd(); });
      C.append(preset('½ pot', g.currentBet + Math.round((pot + la.call) / 2)), preset('Pot', g.currentBet + pot + la.call), preset('Max', la.maxRaiseTo), r, rb);
    }
  }
  function human(a) { TH.act(g, a); afterHuman(); }
  function afterHuman() { render(); schedule(); }
  let fast = false;
  function fastForward() { fast = true; schedule(); }
  function schedule() {
    clearTimeout(timer);
    if (g.phase === 'tell') {
      const pend = TH.pendingTells(g).filter(i => i !== 0);
      if (pend.length && (g.players[0].tell >= 0 || g.players[0].folded)) { pend.forEach(i => TH.setTell(g, i, THAI.chooseTell(g, i))); render(); return schedule(); }
      // bots wait for the human to choose so they can't react... they choose blind (simultaneous)
      if (pend.length) { pend.forEach(i => { g._pendingBotTell = g._pendingBotTell || {}; g._pendingBotTell[i] = THAI.chooseTell(g, i); }); }
      return;
    }
    if (g.phase === 'betting' && g.toAct !== 0) {
      timer = setTimeout(() => { TH.act(g, THAI.decide(g)); render(); schedule(); }, fast ? 30 : BOT_DELAY);
    }
    if (g.phase !== 'betting') fast = false;
  }
  function nextHand() { seen = new Set(); TH.startHand(g); fast = false; render(); schedule(); }
  function newGame() { clearTimeout(timer); g = TH.newGame(); logShown = 0; $('log').innerHTML = ''; nextHand(); }
  $('newBtn').onclick = () => { if (confirm('Start a new game?')) newGame(); };
  $('rulesBtn').onclick = () => $('rules').classList.remove('hidden');
  $('closeRules').onclick = () => { $('rules').classList.add('hidden'); try { localStorage.setItem('th_seen', 1); } catch (e) {} };
  try { if (localStorage.getItem('th_seen')) $('rules').classList.add('hidden'); } catch (e) {}
  newGame();
  window.__TH_GAME = () => g;
})();
