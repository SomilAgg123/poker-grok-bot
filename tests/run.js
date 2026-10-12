const TH = require('../js/engine.js'); const AI = require('../js/ai.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const H = s => s.split(' ').map(TH.card);
const best = s => TH.bestHand(H(s));
// categories
const cases = [
  ['As Ks Qs Js Ts 2d 3c', 'Straight Flush'], ['Ah 2h 3h 4h 5h 9c 9d', 'Straight Flush'],
  ['9s 9h 9d 9c 2s 3d 4h', 'Four of a Kind'], ['Ks Kh Kd 2c 2s 7d 8h', 'Full House'],
  ['2s 7s 9s Js Ks Ad Ac', 'Flush'], ['As 2d 3c 4h 5s Kd Kc', 'Straight'], ['Ts Jd Qc Kh As 2d 2c', 'Straight'],
  ['7s 7d 7c Ah 2s 9d 4c', 'Three of a Kind'], ['7s 7d 9c 9h 2s Ad 4c', 'Two Pair'],
  ['7s 7d 9c Th 2s Ad 4c', 'Pair'], ['7s 3d 9c Th 2s Ad 4c Qh', 'High Card'],
  ['Ks Kh Kd Qc Qs Qd 2h 3c', 'Full House'],
];
cases.forEach(([h, n]) => ok(best(h).name === n, `${h} => ${best(h).name}, want ${n}`));
// orderings
const gt = (a, b, m) => ok(best(a).score > best(b).score, m);
gt('As Ad Kc 2h 7s', 'As Ad Qc 2h 7s', 'pair kicker');
gt('6s 2d 3c 4h 5s', 'As 2d 3c 4h 5s', '6-high straight beats wheel');
gt('Ks Kd 2c 2h 7s', 'Qs Qd Jc Jh As', 'two pair top');
gt('2s 2d 2c 3h 3s', 'As Ad Ac Kh Qs', 'full house beats trips');
ok(best('As Ad 7c 7h 2s').score === best('Ac Ah 7d 7s 2h').score, 'tie');
gt('As Ks 9s 7s 3s', 'As Ks 9s 7s 2s', 'flush last kicker');
// random fuzz: bestHand over 8 >= any 5 subset
for (let t = 0; t < 300; t++) { const d = TH.shuffle(TH.makeDeck()); const h = d.slice(0, 8); const b = TH.bestHand(h); ok(b.score === Math.max(TH.eval5(b.cards)), 'fuzz'); ok(TH.eval5(h.slice(0,5)) <= b.score, 'fuzz2'); }

// side pots
{
  const g = TH.newGame(); g.players[0].total = 100; g.players[1].total = 300; g.players[2].total = 300; g.players[3].total = 50; g.players[3].folded = true;
  const pots = TH.computePots(g); ok(pots.reduce((s, p) => s + p.amount, 0) === 750, 'pot sum');
  ok(pots[0].amount === 350 && pots[0].elig.length === 3, 'main pot ' + JSON.stringify(pots));
  ok(pots[1].amount === 400 && pots[1].elig.length === 2, 'side pot');
}
// full simulated games with AI for all seats: chip conservation & termination
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let hands = 0, tells = 0, echoes = 0, showdowns = 0;
for (let gnum = 0; gnum < 12; gnum++) {
  const g = TH.newGame({ rnd }); g.aiSims = 30;
  const total = () => g.players.reduce((s, p) => s + p.stack + p.total, 0);
  let guard = 0;
  while (g.phase !== 'gameover' && g.handNo < 60) {
    TH.startHand(g); hands++; const start = g.players.reduce((s,p)=>s+p.stack+p.total,0);
    while (g.phase === 'betting' || g.phase === 'tell') {
      if (++guard > 200000) throw new Error('loop');
      if (g.phase === 'tell') { TH.pendingTells(g).forEach(i => { TH.setTell(g, i, AI.chooseTell(g, i, rnd)); tells++; }); continue; }
      const p = g.players[g.toAct]; ok(p && TH.canAct(p), 'valid actor');
      if (!p) break;
      TH.act(g, AI.decide(g, rnd));
    }
    ok(g.phase === 'showdown' || g.phase === 'gameover', 'hand ends ' + g.phase);
    if (g.result.showdown) { showdowns++; ok(g.board.length === 5, 'board 5 at showdown'); }
    const s = g.players.reduce((a, p) => a + p.stack, 0); ok(s === 4000, `chips conserved ${s}`);
    ok(g.players.every(p => p.stack >= 0), 'no negative stacks');
    if (g.phase === 'gameover') break;
    // for sim, human seat being out ends game; fine
  }
  echoes += g.log.filter(l => l.startsWith('Echo')).length;
}
console.log(`sim: ${hands} hands, ${showdowns} showdowns, ${tells} tells, ${echoes} echoes`);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
