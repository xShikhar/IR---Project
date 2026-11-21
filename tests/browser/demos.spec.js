import {test,expect} from '@playwright/test';
import fs from 'node:fs';

async function openCatalog(page){
  await page.getByRole('navigation',{name:'Workspace views'}).getByRole('button',{name:'Demo lab',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Demo lab',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'A conversation that remembers',exact:true})).toBeVisible();
}
async function nextStep(page){
  const guide=page.getByRole('region',{name:'Guided demonstration'});
  await guide.getByRole('button',{name:/Run first step|Run next step/}).click();
  await expect(guide.getByText(/Verified:/)).toBeVisible({timeout:45_000});
  await expect(guide.getByRole('button',{name:/Run first step|Run next step|Return to workspace/})).toBeEnabled({timeout:45_000});
}
test('demo lab runs a conversation tour and restores the original workspace',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.getByRole('textbox',{name:'Search question'}).fill('CRISPR gene editing');
  await page.getByRole('main').getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.locator('.evidence-card')).toHaveCount(10);
  await openCatalog(page);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=window.innerHeight)).toBe(true);
  fs.mkdirSync('output/screenshots',{recursive:true});
  await page.screenshot({path:'output/screenshots/demo-lab.png',fullPage:true});
  await page.getByRole('button',{name:'Start guided demo',exact:true}).click();
  const guide=page.getByRole('region',{name:'Guided demonstration'});
  await expect(guide.getByRole('button',{name:'Run first step'})).toBeEnabled();
  await nextStep(page);await nextStep(page);await nextStep(page);
  await expect(guide.getByRole('heading',{name:'Walkthrough complete'})).toBeVisible();
  await page.getByRole('tab',{name:'Rewrite & Phrase'}).click();
  await expect(page.getByText('History · turn 2',{exact:true}).first()).toBeVisible();
  await page.screenshot({path:'output/screenshots/demo-walkthrough.png',fullPage:true});
  await guide.getByRole('button',{name:'Return to workspace'}).click();
  await expect(guide).toHaveCount(0);
  await page.getByRole('navigation',{name:'Workspace views'}).getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.getByRole('heading',{name:'CRISPR gene editing',exact:true})).toBeVisible();
  await expect(page.locator('.topics-heading')).toContainText('1');
  expect(errors).toEqual([]);
});
test('a clarification tour runs its real choice and can restart without leaking topics',async({page})=>{
  await page.goto('/');await openCatalog(page);
  await page.getByRole('button',{name:'One word, two meanings',exact:true}).click();
  await page.getByRole('button',{name:'Start guided demo'}).click();
  await nextStep(page);
  await expect(page.getByRole('heading',{name:'Which interpretation do you mean?'})).toBeVisible();
  await nextStep(page);await nextStep(page);
  await expect(page.locator('.turn-context-row')).toContainText('Mercury (element)');
  const guide=page.getByRole('region',{name:'Guided demonstration'});
  await guide.getByRole('button',{name:'Restart tour'}).click();
  await expect(guide.getByRole('button',{name:'Run first step'})).toBeEnabled();
  await expect(page.locator('.topics-heading')).toContainText('0');
  await guide.getByRole('button',{name:'Exit demo and restore workspace'}).click();
  await expect(guide).toHaveCount(0);
});
test('original conversations are available and the catalog fits a mobile screen',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');await openCatalog(page);
  const selector=page.getByRole('combobox',{name:'Original benchmark conversation'});
  await expect(selector.locator('option')).toHaveCount(15);
  await selector.selectOption('conv_03');
  await page.getByRole('button',{name:'Start conversation',exact:true}).click();
  const guide=page.getByRole('region',{name:'Guided demonstration'});
  await expect(guide.getByRole('button',{name:'Run first step'})).toBeEnabled();
  await nextStep(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'output/screenshots/demo-mobile.png',fullPage:true});
});

test('guided context audit and comparison display their live results in the right views',async({page})=>{
  await page.goto('/');await openCatalog(page);
  await page.getByRole('button',{name:'Inspect and challenge the memory',exact:true}).click();
  await page.getByRole('button',{name:'Start guided demo'}).click();
  for(let i=0;i<4;i++)await nextStep(page);
  await expect(page.getByRole('button',{name:'Earlier aspects',exact:true})).toBeVisible();
  await nextStep(page);
  await expect(page.getByText('History · turn 2',{exact:true})).toHaveCount(0);
  await nextStep(page);
  await expect(page.getByRole('region',{name:'Guided demonstration'}).getByRole('heading',{name:'Walkthrough complete'})).toBeVisible();
  await page.getByRole('button',{name:'Return to workspace'}).click();
  await openCatalog(page);
  await page.getByRole('button',{name:'Make the improvements visible',exact:true}).click();
  await page.getByRole('button',{name:'Start guided demo'}).click();
  await nextStep(page);await nextStep(page);await nextStep(page);
  await expect(page.getByRole('heading',{name:'Midterm baseline',exact:true})).toBeVisible();
  await nextStep(page);
  await expect(page.getByRole('heading',{name:'Hubble Space Telescope',exact:true})).toBeVisible();
});

test('the custom-meaning tour preserves its question and applies a user-defined focus',async({page})=>{
  await page.goto('/');await openCatalog(page);
  await page.getByRole('button',{name:'Explore a word inside any question',exact:true}).click();
  await page.getByRole('button',{name:'Start guided demo'}).click();
  await nextStep(page);
  await expect(page.getByRole('heading',{name:'Explore “Transformer”'})).toBeVisible();
  await nextStep(page);
  await expect(page.getByRole('heading',{name:'How does it change voltage?',exact:true})).toBeVisible();
  await nextStep(page);
  await expect(page.locator('.turn-context-row')).toContainText('Electrical transformer focus');
  await expect(page.getByRole('region',{name:'Guided demonstration'}).getByRole('heading',{name:'Walkthrough complete'})).toBeVisible();
});
