/* AI opponents for Tell Hold'em.
 * Each bot runs a Monte Carlo equity estimate that USES opponents' revealed Tell cards,
 * then mixes in personality (tightness, aggression, bluff rate). */
(function (root) {
  'use strict';
  const TH = root.TH || (typeof require !== 'undefined' ? require('./engine.js') : null);

  const PERSONAS = {
    Vex: { tight: 0.45, aggro: 0.75, bluff: 0.18, desc: 'Aggressive. Loves to push.' },
    Marlowe: { tight: 0.6, aggro: 0.35, bluff: 0.06, desc: 'Tight and patient.' },
    Juno: { tight: 0.5, aggro: 0.55, bluff: 0.12, desc: 'Balanced and tricky with Tells.' },
  };
  function persona(p) { return PERSONAS[p.name] || PERSONAS.Juno; }

  function equity(g, i, sims = 250, rnd = Math.random) {
    const me = g.players[i];
    const opps = TH.live(g).filter(p => p !== me);
    if (!opps.length) return 1;
    const known = new Set(me.hole.concat(g.board).map(TH.cardStr));
    opps.forEach(o => { if (o.tell >= 0) known.add(TH.cardStr(o.hole[o.tell])); });
    const rest = TH.makeDeck().filter(c => !known.has(TH.cardStr(c)));
    let score = 0;
    for (let s = 0; s < sims; s++) {
      const d = rest.slice(); let n = d.length;
      const draw = () => { const j = Math.floor(rnd() * n); const c = d[j]; d[j] = d[--n]; return c; };
      const board = g.board.slice(); while (board.length < 5) board.push(draw());
      const mine = TH.bestHand(me.hole.concat(board)).score;
      let best = 0, ties = 0, beaten = false;
      for (const o of opps) {
        const h = o.tell >= 0 ? [o.hole[o.tell], draw(), draw()] : [draw(), draw(), draw()];
        const sc = TH.bestHand(h.concat(board)).score;
        if (sc > mine) { beaten = true; break; } if (sc === mine) ties++;
      }
      if (!beaten) score += 1 / (ties + 1);
      void best;
    }
    return score / sims;
  }

  function decide(g, rnd = Math.random) {
    const i = g.toAct, p = g.players[i], per = persona(p);
    const la = TH.legalActions(g);
    const pot = TH.pot(g);
    const nOpp = TH.live(g).length - 1;
    const eq = equity(g, i, g.aiSims || (g.street === 0 ? 150 : 250), rnd);
    // normalise: equity relative to a fair share
    const fair = 1 / (nOpp + 1);
    const strength = eq / fair; // 1 = average
    const callAmt = la.call;
    const potOdds = callAmt / (pot + callAmt);
    const r = rnd();
    const raiseTo = frac => Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, g.currentBet + Math.round((pot + callAmt) * frac)));

    // Strong: value raise
    if (strength > 1.9 - per.aggro * 0.4 && la.canRaise && r < 0.55 + per.aggro * 0.4) {
      const frac = strength > 2.6 ? 0.9 + rnd() * 0.5 : 0.5 + rnd() * 0.3;
      return { type: 'raise', to: raiseTo(frac) };
    }
    // Bluff / semi-bluff when checked to or small bet
    if (la.canRaise && r < per.bluff && callAmt <= pot * 0.35 && g.street >= 1) return { type: 'raise', to: raiseTo(0.6) };
    if (callAmt === 0) {
      if (strength > 1.3 && la.canRaise && r < per.aggro * 0.6) return { type: 'raise', to: raiseTo(0.5) };
      return { type: 'check' };
    }
    // Calling decision: equity vs pot odds, tighter players want a margin
    const margin = per.tight * 0.12 + (callAmt > p.stack * 0.5 ? 0.08 : 0);
    if (eq > potOdds + margin) return { type: 'call' };
    if (g.street === 0 && callAmt <= g.bb && strength > 0.85 - (1 - per.tight) * 0.3) return { type: 'call' };
    return { type: 'fold' };
  }

  // Which hole card to reveal at the Tell.
  // Bots score each choice: hiding the most valuable card, chasing the Echo bonus,
  // and (for bluffy personas) showing a scary high card to represent strength.
  function chooseTell(g, i, rnd = Math.random) {
    const p = g.players[i], per = persona(p);
    let best = 0, bestV = -Infinity;
    p.hole.forEach((c, k) => {
      const others = p.hole.filter((_, j) => j !== k);
      // value of keeping others hidden: how much they contribute to our hand
      let v = 0;
      const pairsBoard = g.board.some(b => b.r === c.r);
      if (pairsBoard) v += 1.5; // echo bonus (discounted: echoes can collide)
      // penalise revealing cards that pair with our other hole cards (hides our trips/pairs)
      if (others.some(o => o.r === c.r)) v -= 1.5;
      // suited with board flush draw: revealing it advertises the draw
      if (g.board.filter(b => b.s === c.s).length >= 2) v -= 1;
      // low cards are cheap info; bluffers like showing aces
      v += (14 - c.r) * 0.08;
      if (c.r >= 12 && rnd() < per.bluff * 3) v += 2;
      v += rnd() * 0.5;
      if (v > bestV) { bestV = v; best = k; }
    });
    return best;
  }

  const API = { decide, chooseTell, equity, PERSONAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.THAI = API;
})(typeof window !== 'undefined' ? window : globalThis);
