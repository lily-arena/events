import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('artifacts/platform',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5190/admin?connected');
  await page.getByRole('button',{name:'FIRST SEAT',exact:true}).click();
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.getByText('저장했습니다.',{exact:true}).waitFor();
  await page.screenshot({path:`artifacts/platform/editor-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'운영',exact:true}).click();await page.getByRole('heading',{name:'FIRST SEAT 운영'}).waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  await page.screenshot({path:`artifacts/platform/operations-${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('Connected editor save and operations render passed on desktop/mobile.');
}finally{await browser.close();}
