/* Tell Hold'em engine: cards, hand evaluation, game state machine.
 * UMD so it runs in the browser (window.TH) and in node tests. */
(function (root) {
  'use strict';
  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const CATS = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

  function makeDeck() { const d = []; for (const s of SUITS) for (let r = 0; r < 13; r++) d.push({ r: r + 2, s }); return d; }
  function shuffle(a, rnd = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function card(str) { return { r: RANKS.indexOf(str[0].toUpperCase()) + 2, s: str[1].toLowerCase() }; }
  function cardStr(c) { return RANKS[c.r - 2] + c.s; }

  // Evaluate exactly 5 cards -> numeric score (higher is better)
  function eval5(cs) {
    const rs = cs.map(c => c.r).sort((a, b) => b - a);
    const flush = cs.every(c => c.s === cs[0].s);
    const cnt = {}; rs.forEach(r => cnt[r] = (cnt[r] || 0) + 1);
    const groups = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
    const uniq = groups.length === 5;
    let straightHi = 0;
    if (uniq) {
      if (rs[0] - rs[4] === 4) straightHi = rs[0];
      else if (rs[0] === 14 && rs[1] === 5) straightHi = 5; // wheel
    }
    let cat, kick;
    if (straightHi && flush) { cat = 8; kick = [straightHi]; }
    else if (cnt[groups[0]] === 4) { cat = 7; kick = groups; }
    else if (cnt[groups[0]] === 3 && cnt[groups[1]] === 2) { cat = 6; kick = groups; }
    else if (flush) { cat = 5; kick = rs; }
    else if (straightHi) { cat = 4; kick = [straightHi]; }
    else if (cnt[groups[0]] === 3) { cat = 3; kick = groups; }
    else if (cnt[groups[0]] === 2 && cnt[groups[1]] === 2) { cat = 2; kick = groups; }
    else if (cnt[groups[0]] === 2) { cat = 1; kick = groups; }
    else { cat = 0; kick = rs; }
    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 15 + (kick[i] || 0);
    return score;
  }
  // Best 5 of n cards
  function bestHand(cs) {
    let best = -1, bestCards = null; const n = cs.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const h = [cs[a], cs[b], cs[c], cs[d], cs[e]]; const s = eval5(h);
      if (s > best) { best = s; bestCards = h; }
    }
    return { score: best, cards: bestCards, name: CATS[Math.floor(best / 759375)] };
  }
  function catName(score) { return CATS[Math.floor(score / 759375)]; }

  /* ---------- Game ---------- */
  const STREETS = ['Pre-flop', 'Flop', 'Turn', 'River'];
  function newGame(opts = {}) {
    const names = opts.names || ['You', 'Vex', 'Marlowe', 'Juno'];
    return {
      players: names.map((n, i) => ({ id: i, name: n, stack: opts.stack || 1000, isHuman: i === 0, hole: [], tell: -1, folded: false, allIn: false, bet: 0, total: 0, acted: false, out: false })),
      dealer: -1, sb: opts.sb || 10, bb: opts.bb || 20, handNo: 0, log: [], rnd: opts.rnd || Math.random,
      tellBonus: opts.tellBonus !== false,
    };
  }
  function live(g) { return g.players.filter(p => !p.folded && !p.out); }
  function nextSeat(g, i, pred) { for (let k = 1; k <= g.players.length; k++) { const j = (i + k) % g.players.length; if (pred(g.players[j])) return j; } return -1; }
  function log(g, m) {
    m = m.replace(/^You (folds|checks|calls|bets|raises|shows|wins|is)/, (_, v) => 'You ' + ({ folds: 'fold', checks: 'check', calls: 'call', bets: 'bet', raises: 'raise', shows: 'show', wins: 'win', is: 'are' })[v]);
    g.log.push(m);
  }

  function startHand(g) {
    const seated = g.players.filter(p => !p.out);
    if (seated.length < 2) { g.phase = 'gameover'; return g; }
    g.handNo++;
    // blinds rise every 8 hands
    if (g.handNo > 1 && (g.handNo - 1) % 8 === 0) { g.sb *= 2; g.bb *= 2; log(g, `Blinds rise to ${g.sb}/${g.bb}.`); }
    g.deck = shuffle(makeDeck(), g.rnd); g.board = []; g.street = 0; g.pots = null; g.result = null;
    g.players.forEach(p => { p.hole = []; p.tell = -1; p.folded = p.out; p.allIn = false; p.bet = 0; p.total = 0; p.acted = false; });
    g.dealer = nextSeat(g, g.dealer, p => !p.out);
    for (let k = 0; k < 3; k++) g.players.forEach(p => { if (!p.out) p.hole.push(g.deck.pop()); });
    const heads = seated.length === 2;
    const sbI = heads ? g.dealer : nextSeat(g, g.dealer, p => !p.out);
    const bbI = nextSeat(g, sbI, p => !p.out);
    post(g, sbI, g.sb); post(g, bbI, g.bb);
    g.currentBet = g.bb; g.minRaise = g.bb;
    g.toAct = nextSeat(g, bbI, canAct);
    g.phase = 'betting';
    log(g, `— Hand ${g.handNo} — ${g.players[g.dealer].name} deals.`);
    checkRoundEnd(g);
    return g;
  }
  function post(g, i, amt) { const p = g.players[i]; const a = Math.min(amt, p.stack); p.stack -= a; p.bet += a; p.total += a; if (p.stack === 0) p.allIn = true; }
  function canAct(p) { return !p.folded && !p.out && !p.allIn; }
  function pot(g) { return g.players.reduce((s, p) => s + p.total, 0); }
  function toCall(g, i) { const p = g.players[i]; return Math.min(g.currentBet - p.bet, p.stack); }

  function legalActions(g) {
    const p = g.players[g.toAct]; const tc = toCall(g, g.toAct);
    const minTo = Math.min(g.currentBet + g.minRaise, p.bet + p.stack);
    return { fold: tc > 0, check: tc === 0, call: tc > 0 ? tc : 0, canRaise: p.stack > tc, minRaiseTo: minTo, maxRaiseTo: p.bet + p.stack };
  }

  // action: {type:'fold'|'check'|'call'|'raise', to}
  function act(g, action) {
    if (g.phase !== 'betting') throw new Error('not betting phase');
    const i = g.toAct, p = g.players[i];
    const la = legalActions(g);
    let t = action.type;
    if (t === 'check' && !la.check) t = 'call';
    if (t === 'fold' && !la.fold) t = 'check';
    if (t === 'raise' && !la.canRaise) t = la.check ? 'check' : 'call';
    if (t === 'fold') { p.folded = true; log(g, `${p.name} folds.`); }
    else if (t === 'check') { log(g, `${p.name} checks.`); }
    else if (t === 'call') { post(g, i, la.call); log(g, `${p.name} calls ${la.call}${p.allIn ? ' (all-in)' : ''}.`); }
    else {
      let to = Math.max(la.minRaiseTo, Math.min(Math.round(action.to), la.maxRaiseTo));
      const inc = to - g.currentBet;
      post(g, i, to - p.bet);
      if (inc >= g.minRaise) { g.minRaise = inc; g.players.forEach(q => { if (q !== p) q.acted = false; }); }
      else g.players.forEach(q => { if (q !== p && q.bet < p.bet) q.acted = false; }); // short all-in
      const verb = g.currentBet === 0 ? 'bets' : 'raises to';
      g.currentBet = Math.max(g.currentBet, p.bet);
      log(g, `${p.name} ${verb} ${p.bet}${p.allIn ? ' (all-in)' : ''}.`);
    }
    p.acted = true;
    if (live(g).length === 1) return finishUncontested(g);
    g.toAct = nextSeat(g, i, canAct);
    checkRoundEnd(g);
    return g;
  }

  function roundDone(g) {
    return g.players.filter(canAct).every(p => p.acted && p.bet === g.currentBet) || g.toAct === -1;
  }
  function checkRoundEnd(g) {
    const actors = g.players.filter(canAct);
    // only one (or zero) players can act and they have matched: skip
    if (actors.length === 1 && actors[0].bet >= maxOtherBet(g, actors[0])) return endStreet(g);
    if (actors.length === 0 || roundDone(g)) return endStreet(g);
  }
  function maxOtherBet(g, p) { return Math.max(0, ...g.players.filter(q => q !== p && !q.folded).map(q => q.bet)); }

  function endStreet(g) {
    g.players.forEach(p => { p.bet = 0; p.acted = false; }); g.currentBet = 0; g.minRaise = g.bb;
    if (g.street === 1 && !g.tellDone) { g.phase = 'tell'; return g; }
    advanceStreet(g); return g;
  }
  // The Tell: after flop betting every live player flips one hole card face up.
  function setTell(g, i, idx) {
    const p = g.players[i]; if (p.folded || p.tell >= 0) return g; p.tell = idx;
    log(g, `${p.name} shows ${cardStr(p.hole[idx])}.`);
    if (live(g).every(q => q.tell >= 0)) { g.tellDone = true; applyTellBonus(g); advanceStreet(g); }
    return g;
  }
  // Echo bonus: if your Tell card matches the rank of a flop card, every other live player
  // pays you half a big blind. But echoes collide: if two or more players echo, nobody is paid.
  // (Balance pass: the original "everyone can echo" version fired on ~40% of Tells and was a flat tax.)
  function applyTellBonus(g) {
    if (!g.tellBonus) return;
    const echoers = live(g).filter(p => g.board.some(b => b.r === p.hole[p.tell].r));
    if (echoers.length > 1) { log(g, `Echoes collide (${echoers.map(p => p.name).join(' & ')}) — no bonus.`); return; }
    echoers.forEach(p => {
      let got = 0;
      live(g).forEach(q => { if (q !== p) { const a = Math.min(Math.floor(g.bb / 2), q.stack); q.stack -= a; got += a; if (q.stack === 0) q.allIn = true; } });
      p.stack += got; if (got > 0) { p.allIn = false; log(g, `Echo! ${p.name}'s Tell pairs the flop: collects ${got}.`); }
    });
  }
  function pendingTells(g) { return live(g).filter(p => p.tell < 0).map(p => p.id); }

  function advanceStreet(g) {
    g.street++;
    if (g.street === 1) { g.tellDone = false; g.board.push(g.deck.pop(), g.deck.pop(), g.deck.pop()); }
    else if (g.street <= 3) g.board.push(g.deck.pop());
    else return showdown(g);
    log(g, `${STREETS[g.street]}: ${g.board.map(cardStr).join(' ')}`);
    g.phase = 'betting';
    const actors = g.players.filter(canAct);
    if (actors.length <= 1) {
      if (g.street === 1) { g.phase = 'betting'; return endStreet(g); }
      return advanceStreet(g);
    }
    g.toAct = nextSeat(g, g.dealer, canAct);
    return g;
  }

  function computePots(g) {
    const contrib = g.players.map(p => p.total);
    const levels = [...new Set(contrib.filter(c => c > 0))].sort((a, b) => a - b);
    const pots = []; let prev = 0;
    for (const L of levels) {
      let amt = 0; const elig = [];
      g.players.forEach((p, i) => { amt += Math.max(0, Math.min(contrib[i], L) - prev); if (!p.folded && contrib[i] >= L) elig.push(i); });
      if (amt > 0) { if (elig.length === 0 && pots.length) pots[pots.length - 1].amount += amt; else if (pots.length && sameSet(pots[pots.length - 1].elig, elig)) pots[pots.length - 1].amount += amt; else pots.push({ amount: amt, elig }); }
      prev = L;
    }
    return pots;
  }
  function sameSet(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }

  function showdown(g) {
    g.phase = 'showdown';
    const hands = {};
    live(g).forEach(p => { hands[p.id] = bestHand(p.hole.concat(g.board)); });
    const pots = computePots(g); const wins = g.players.map(() => 0);
    pots.forEach(pt => {
      const elig = pt.elig.filter(i => hands[i]);
      const best = Math.max(...elig.map(i => hands[i].score));
      const w = elig.filter(i => hands[i].score === best);
      const share = Math.floor(pt.amount / w.length); let rem = pt.amount - share * w.length;
      w.forEach(i => { wins[i] += share + (rem-- > 0 ? 1 : 0); });
    });
    wins.forEach((w, i) => { g.players[i].stack += w; if (w) log(g, `${g.players[i].name} wins ${w} with ${hands[i].name}.`); });
    g.result = { hands, wins, showdown: true };
    finishHand(g); return g;
  }
  function finishUncontested(g) {
    const w = live(g)[0]; const amt = pot(g); w.stack += amt;
    log(g, `${w.name} wins ${amt} uncontested.`);
    g.result = { wins: g.players.map(p => p === w ? amt : 0), showdown: false };
    g.phase = 'showdown'; finishHand(g); return g;
  }
  function finishHand(g) {
    g.players.forEach(p => { if (p.stack <= 0 && !p.out) { p.out = true; log(g, `${p.name} is eliminated.`); } });
    if (g.players.filter(p => !p.out).length < 2 || g.players[0].out) g.phase = 'gameover';
  }

  const API = { RANKS, SUITS, CATS, STREETS, makeDeck, shuffle, card, cardStr, eval5, bestHand, catName, newGame, startHand, act, legalActions, setTell, pendingTells, pot, toCall, computePots, live, canAct };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.TH = API;
})(typeof window !== 'undefined' ? window : globalThis);
