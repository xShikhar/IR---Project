import {test,expect} from '@playwright/test';
import fs from 'node:fs';

const screenshots='output/screenshots';
test.beforeAll(()=>fs.mkdirSync(screenshots,{recursive:true}));
async function ask(page,question) {
  await page.getByRole('textbox',{name:'Search question'}).fill(question);
  await page.getByRole('main').getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.getByRole('heading',{name:question,exact:true})).toBeVisible();
  await expect(page.getByText('Searching the corpus and tracing the ranking…')).toBeHidden({timeout:45_000});
}

test('a researcher resumes a topic, previews rankings, provides feedback and compares',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Follow the evidence.'})).toBeVisible();
  await page.screenshot({path:`${screenshots}/welcome.png`,fullPage:true});
  await ask(page,'What is the James Webb Space Telescope?');
  await expect(page.locator('.evidence-card')).toHaveCount(10);
  await ask(page,'Explain CRISPR gene editing.');
  await ask(page,'Back to JWST, what instruments does it carry?');
  await expect(page.locator('.turn-context-row')).toContainText('James Webb Space Telescope');
  await expect(page.getByLabel('Browse conversation turns').locator('option')).toHaveCount(2);
  await page.getByRole('button',{name:'Re-score',exact:true}).click();
  await expect(page.locator('.preview-banner')).toContainText('Saved conversation unchanged');
  await expect(page.getByLabel('Browse conversation turns').locator('option')).toHaveCount(2);
  await page.getByRole('button',{name:'Pin passage',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Pin passage',exact:true}).first()).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:`${screenshots}/workspace.png`,fullPage:true});
  await page.getByLabel('Browse conversation turns').selectOption('turn_1');
  await page.getByRole('main').getByRole('button',{name:'Compare',exact:true}).click();
  await expect(page.getByText('Replayed turn 1 · 0 earlier turns supplied to both engines')).toBeVisible();
  await page.getByRole('navigation',{name:'Workspace views'}).getByRole('button',{name:'Compare'}).click();
  await page.getByLabel('Search question').fill('What instruments does JWST carry?');
  await page.getByRole('button',{name:'Compare rankings'}).click();
  await expect(page.getByRole('heading',{name:'Midterm baseline'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'TurnTrace 2',exact:true})).toBeVisible();
  await page.screenshot({path:`${screenshots}/comparison.png`,fullPage:true});
  expect(errors).toEqual([]);
});

test('ambiguity choices persist and the mobile workspace fits its viewport',async({page})=>{
  await page.goto('/');
  await ask(page,'Mercury');
  await expect(page.getByRole('heading',{name:'Which interpretation do you mean?'})).toBeVisible();
  await page.getByRole('button',{name:/Mercury \(element\)/}).click();
  await expect(page.locator('.evidence-card').first()).toContainText('Mercury');
  await ask(page,'How does it affect the nervous system?');
  await expect(page.locator('.turn-context-row')).toContainText('Mercury (element)');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('textbox',{name:'Search question'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`${screenshots}/mobile.png`,fullPage:true});
});

test('an elaboration shows its earlier aspect and allows a reversible correction', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'James Webb Space Telescope');
  await ask(page, 'What about its mirror?');
  await ask(page, 'Tell me more.');
  await page.getByRole('tab', { name: 'Rewrite & Phrase' }).click();
  await expect(page.getByText('History · turn 2', { exact: true })).toBeVisible();
  await page.locator('button[title="Remove mirror inherited from turn 2"]').click();
  await expect(page.locator('.preview-banner')).toContainText('Saved conversation unchanged');
  await expect(page.getByText('History · turn 2', { exact: true })).toHaveCount(0);
  await page.locator('button[title="Restore mirror"]').click();
  await expect(page.getByText('History · turn 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check context impact' }).click();
  await page.getByRole('button', { name: 'Earlier aspects', exact: true }).click();
  await page.getByRole('button', { name: 'Preview this variant' }).click();
  await expect(page.locator('.preview-banner')).toContainText('Without earlier aspect terms');
  await page.getByRole('button', { name: 'Question only', exact: true }).click();
  await expect(page.locator('.preview-banner')).toContainText('Question only');
  await expect(page.getByText('History · turn 2', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Browse conversation turns').locator('option')).toHaveCount(3);
});

test('two-subject comparison and measured experiments are accessible',async({page})=>{
  await page.goto('/');
  await page.getByRole('navigation',{name:'Workspace views'}).getByRole('button',{name:'Compare'}).click();
  await page.getByRole('button',{name:'Two subjects',exact:true}).click();
  await page.getByLabel('First subject').fill('James Webb Space Telescope');
  await page.getByLabel('Second subject').fill('Hubble Space Telescope');
  await page.getByLabel('Focus question (optional)').fill('infrared instruments');
  await page.getByRole('button',{name:'Compare subjects'}).click();
  await expect(page.getByRole('heading',{name:'James Webb Space Telescope',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Hubble Space Telescope',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Workspace views'}).getByRole('button',{name:'Experiments'}).click();
  await expect(page.getByRole('heading',{name:'Experiments',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:/Same-turn retrieval metrics|Evaluation report unavailable/})).toBeVisible();
});

test('neural ranking controls expose passage scores and evaluation results', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Follow the evidence.' })).toBeVisible();
  const health = await (await page.request.get('/api/health')).json();
  test.skip(!health.semantic?.reranker?.available, 'The optional passage model has not been prepared');
  await page.getByLabel('Passage reranking').selectOption('adaptive');
  await ask(page, 'James Webb Space Telescope');
  await page.getByRole('tab', { name: 'Postings & Fusion' }).click();
  await expect(page.getByText(/Adaptive · \d+ passages scored/)).toBeVisible();
  await page.getByRole('button', { name: /Inspect ranking score/ }).first().click();
  await expect(page.getByText('Cross-encoder logit', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Workspace views' }).getByRole('button', { name: 'Experiments' }).click();
  await expect(page.getByRole('heading', { name: 'How each retrieval change performed' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download blind review pool' })).toBeVisible();
});

test('execution trace shows phrase diagnostics, method rankings, novelty and timings', async ({ page }) => {
  await page.goto('/');
  await ask(page, '"James Webb Space Telescope"');
  await expect(page.getByRole('heading', { name: 'IR Execution Trace' })).toBeVisible();
  await page.getByRole('tab', { name: 'State & Decision' }).click();
  await expect(page.getByText('Conversation memory', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Rewrite & Phrase' }).click();
  await expect(page.getByText(/Positional intersection · \d+ matches/)).toBeVisible();
  await page.getByRole('tab', { name: 'Postings & Fusion' }).click();
  await expect(page.getByRole('columnheader', { name: 'BM25 IDF' })).toBeVisible();
  await page.getByRole('button', { name: 'Compare methods', exact: true }).click();
  await page.getByRole('button', { name: 'BM25', exact: true }).click();
  await expect(page.getByText(/of the first five shared with Hybrid/)).toBeVisible();
  await page.getByRole('tab', { name: 'Novelty & Profiler' }).click();
  await expect(page.getByText('Turn latency profiler', { exact: true })).toBeVisible();
  await expect(page.getByText('Lexical scoring', { exact: true })).toBeVisible();
  await expect(page.getByText('New passages', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Novelty & Profiler' }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Postings & Fusion' })).toHaveAttribute('aria-selected', 'true');
});

test('benchmark comparison shows grades separately from rank movement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Workspace views' }).getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('button', { name: 'Benchmark relevance' }).click();
  await expect(page.getByLabel('Benchmark question')).toBeEnabled();
  await page.getByLabel('Benchmark question').selectOption('conv_03_turn_01');
  await page.getByRole('button', { name: 'Run benchmark replay' }).click();
  await expect(page.getByRole('heading', { name: 'Measured relevance for this question' })).toBeVisible();
  await expect(page.getByText('Judged passages', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Relevance grade' })).toBeVisible();
  const health = await (await page.request.get('/api/health')).json();
  if (health.semantic?.reranker?.available) {
    await page.getByLabel('TurnTrace 2 reranking').selectOption('adaptive');
    await page.getByRole('button', { name: 'Run benchmark replay' }).click();
    await expect(page.getByText(/Adaptive reranking scored \d+ passages/)).toBeVisible();
  }
});

test('switching from soft boost to hard lock previews the same conversation turn', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'What is the James Webb Space Telescope?');
  await page.getByLabel('Topic constraint').selectOption('hard');
  await page.getByRole('button', { name: 'Re-score', exact: true }).click();
  await expect(page.getByText('Hard lock active', { exact: true })).toBeVisible();
  await expect(page.getByText('Eligible passages', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Browse conversation turns').locator('option')).toHaveCount(1);
  await page.getByLabel('Topic constraint').selectOption('soft');
  await page.getByRole('button', { name: 'Re-score', exact: true }).click();
  await expect(page.getByText('Hard lock active', { exact: true })).toHaveCount(0);
});

test('exploring a custom word offers indexed senses for a separate question', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search question' }).fill('How does it change voltage?');
  await page.getByRole('button', { name: 'Explore meanings' }).click();
  await page.getByLabel('Term to explore').fill('Transformer');
  await page.getByRole('button', { name: 'Find meanings' }).click();
  await expect(page.getByRole('heading', { name: 'Explore “Transformer”' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Transformer \(deep learning architecture\)/ })).toBeVisible();
  await page.getByRole('button', { name: /^Transformer Indexed title/ }).click();
  await expect(page.getByRole('heading', { name: 'How does it change voltage?' })).toBeVisible();
  await expect(page.locator('.turn-context-row')).toContainText('Transformer');
  await expect(page.locator('.evidence-card').first()).toBeVisible();
});
