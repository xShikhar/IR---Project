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
