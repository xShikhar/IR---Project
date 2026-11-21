import {test,expect} from '@playwright/test';

const guide=page=>page.getByRole('region',{name:'Guided demonstration'});
async function catalog(page){await page.getByRole('navigation',{name:'Workspace views'}).getByRole('button',{name:'Demo lab',exact:true}).click();await expect(page.getByRole('button',{name:'Start guided demo'})).toBeVisible();}
async function step(page){await guide(page).getByRole('button',{name:/Run first step|Run next step/}).click();await expect(guide(page).getByRole('button',{name:/Run first step|Run next step|Return to workspace/})).toBeEnabled();}

test('demo exit restores a draft, clarification and unsaved retrieval controls',async({page})=>{
  await page.goto('/');await page.getByRole('textbox',{name:'Search question'}).fill('Mercury');
  await page.getByRole('main').getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Which interpretation do you mean?'})).toBeVisible();
  await page.getByRole('textbox',{name:'Search question'}).fill('An unsent follow-up for my normal workspace');
  await page.getByLabel('Retrieval model').selectOption('bm25');
  await catalog(page);await page.getByRole('button',{name:'Start guided demo'}).click();await step(page);
  await guide(page).getByRole('button',{name:'Exit demo and restore workspace'}).click();
  await expect(page.getByRole('textbox',{name:'Search question'})).toHaveValue('An unsent follow-up for my normal workspace');
  await expect(page.getByRole('heading',{name:'Which interpretation do you mean?'})).toBeVisible();
  await expect(page.getByLabel('Retrieval model')).toHaveValue('bm25');
});

test('manually choosing a scripted interpretation advances once and does not duplicate the query',async({page})=>{
  await page.goto('/');await catalog(page);
  await page.getByRole('button',{name:'One word, two meanings',exact:true}).click();
  await page.getByRole('button',{name:'Start guided demo'}).click();await step(page);
  await page.getByRole('button',{name:/Mercury \(element\)/}).click();
  await expect(guide(page)).toContainText('2 / 3 steps completed');
  await expect(page.getByLabel('Browse conversation turns').locator('option')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Undo last change'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Reset workspace'})).toBeDisabled();
  await step(page);
  await expect(guide(page).getByRole('heading',{name:'Walkthrough complete'})).toBeVisible();
  await expect(page.getByLabel('Browse conversation turns').locator('option')).toHaveCount(2);
});

test('session switches do not issue a redundant stale session fetch',async({page})=>{
  let demoLoads=0;
  page.on('request',request=>{if(request.method()==='GET'&&/\/session\?sessionId=demo_/.test(request.url()))demoLoads++;});
  await page.goto('/');await catalog(page);
  await page.getByRole('button',{name:'Start guided demo'}).click();await step(page);
  await expect(guide(page)).toContainText('1 / 3 steps completed');
  expect(demoLoads).toBe(1);
});

test('a completed evaluation tour resumes the experiment view',async({page})=>{
  await page.goto('/');await catalog(page);
  await page.getByRole('button',{name:'Show measured results honestly',exact:true}).click();
  await page.getByRole('button',{name:'Start guided demo'}).click();await step(page);await step(page);
  await expect(page.getByRole('heading',{name:'Experiments',exact:true})).toBeVisible();
  await guide(page).getByRole('button',{name:'View guide'}).click();
  await expect(page.getByText('A demo is complete',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Resume walkthrough'}).click();
  await expect(page.getByRole('heading',{name:'Experiments',exact:true})).toBeVisible();
});
