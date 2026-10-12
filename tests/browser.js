// Headless smoke test: loads index.html, plays several hands as the human, fails on any JS error.
// Usage: NODE_PATH=<dir with playwright-core> CHROME=/usr/bin/google-chrome node tests/browser.js
const { chromium } = require('playwright-core');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.screenshot({ path: path.resolve(__dirname, '../docs/screenshot-rules.png') });
  await page.click('#closeRules');
  let hands = 0, tells = 0;
  for (let step = 0; step < 400 && hands < 6; step++) {
    const phase = await page.evaluate(() => { const g = window.__TH_GAME(); return { phase: g.phase, toAct: g.toAct, tell: g.players[0].tell, folded: g.players[0].folded }; });
    if (phase.phase === 'gameover') break;
    if (phase.phase === 'showdown') { if (hands === 1) await page.screenshot({ path: path.resolve(__dirname, '../docs/screenshot-showdown.png') }); await page.click('text=Next hand'); hands++; continue; }
    if (phase.phase === 'tell' && phase.tell < 0 && !phase.folded) { await page.screenshot({ path: path.resolve(__dirname, '../docs/screenshot-tell.png') }); await page.click('#seat0 .card.pick >> nth=0'); tells++; continue; }
    if (phase.phase === 'betting' && phase.toAct === 0) {
      const b = await page.$('#controls button:has-text("Check")') || await page.$('#controls button:has-text("Call")');
      await b.click(); continue;
    }
    await page.waitForTimeout(300);
  }
  await browser.close();
  console.log(`browser: ${hands} hands played, ${tells} tells chosen, ${errors.length} JS errors`);
  errors.forEach(e => console.log('  ERR', e));
  process.exit(errors.length || hands < 3 ? 1 : 0);
})();
