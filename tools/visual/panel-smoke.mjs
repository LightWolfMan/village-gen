import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const out=resolve('.cache/panel-smoke');
await mkdir(out,{recursive:true});
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../../',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
try {
  const base=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Servidor não iniciou')),10000);
    server.once('error',reject);
    server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});
  });
  browser=await chromium.launch({channel:'chrome',headless:true,args:[`--log-file=${join(out,'chromium.log')}`]});
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  page.setDefaultTimeout(60000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`${base}/?visual=1`);
  await page.waitForFunction(()=>Boolean(window.villageTest));
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.selectOption('#theme-input','dark');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
  await page.reload();
  await page.waitForFunction(()=>Boolean(window.villageTest));
  assert.equal(await page.locator('#theme-input').inputValue(),'dark','Tema deve persistir');
  await page.selectOption('#theme-input','system');
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.evaluate(()=>window.villageTest.generate('visual-17'));
  await page.screenshot({path:join(out,'painel-escuro.png')});
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  const originalSeed=await page.locator('#seed-input').inputValue();
  for(const [preset,settlement,layout,river] of [['rural','hamlet','organic',false],['city','town','grid',false],['river','village','organic',true]]){
    await page.selectOption('#preset-input',preset);
    assert.equal(await page.locator('#settlement-input').inputValue(),settlement);
    assert.equal(await page.locator('#layout-input').inputValue(),layout);
    assert.equal(await page.locator('#river-input').isChecked(),river);
    assert.equal(await page.locator('#size-input').isDisabled(),settlement==='town');
    assert.equal(await page.locator('#seed-input').inputValue(),originalSeed);
    assert.equal(await page.evaluate(()=>window.villageTest.map().seed),originalSeed);
  }
  await page.click('#reset-settings');
  assert.equal(await page.locator('#biome-input').inputValue(),'temperate');
  assert.equal(await page.locator('#settlement-input').inputValue(),'village');
  assert.equal(await page.locator('#size-input').inputValue(),'96');
  const fits=await page.locator('#generator-form').evaluate(form=>form.scrollHeight<=form.clientHeight+1);
  assert.ok(fits,`Controles padrão precisam caber sem rolagem em 1366×768: ${await page.locator('#generator-form').evaluate(e=>e.scrollHeight+' / '+e.clientHeight)}`);
  await page.screenshot({path:join(out,'painel-desktop.png')});
  await page.selectOption('#biome-input','arid');
  assert.equal(await page.locator('#preset-input').inputValue(),'custom');
  await page.selectOption('#layout-input','grid');
  assert.equal(await page.evaluate(()=>window.villageTest.map().settings.biome),'temperate','Editar não deve regenerar');
  assert.equal(await page.locator('#pending-changes').getAttribute('data-pending'),'true');
  await page.click('#apply-button');
  await page.waitForFunction(()=>window.villageTest.map().settings.biome==='arid'&&!document.querySelector('#apply-button').hasAttribute('aria-busy'));
  assert.equal(await page.evaluate(()=>window.villageTest.map().seed),'visual-17');
  assert.equal(await page.evaluate(()=>window.villageTest.map().settings.layout),'grid');
  const preserved=await page.evaluate(async()=>{
    const task=window.villageTest.generate('pedido-em-andamento');
    const input=document.querySelector('#seed-input');input.value='edicao-preservada';input.dispatchEvent(new Event('input',{bubbles:true}));
    await task;
    return input.value;
  });
  assert.equal(preserved,'edicao-preservada','Resultado antigo não pode apagar edição em andamento');
  await page.locator('#seed-input').press('Enter');
  await page.waitForFunction(()=>window.villageTest.map().seed==='edicao-preservada');
  await page.click('#generate-button');
  await page.waitForFunction(()=>window.villageTest.map().seed!=='edicao-preservada'&&!document.querySelector('#generate-button').hasAttribute('aria-busy'));
  const seed=await page.evaluate(()=>window.villageTest.map().seed);
  await page.check('#zones-input');
  await page.selectOption('#quality-input','economy');
  assert.equal(await page.evaluate(()=>window.villageTest.map().seed),seed);
  assert.equal(await page.locator('#zone-legend').isVisible(),true);
  for(const viewport of [{width:1280,height:720},{width:900,height:600}]){
    await page.setViewportSize(viewport);
    for(const id of ['#generate-button','#apply-button','#stat-houses','#stat-time']){
      const box=await page.locator(id).boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=viewport.height,`${id} precisa continuar visível`);
    }
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(out,'painel-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await writeFile(join(out,'results.json'),JSON.stringify({passed:true,themesAndPersistence:true,presetsAndReset:true,desktopFitsWithoutScrolling:fits,errors},null,2));
  console.log('Painel: dimensões, aplicação em lote, seeds, edição concorrente, visualização e responsividade passaram.');
} finally {
  await browser?.close();
  server.kill();
}
