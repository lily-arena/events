import {chromium} from 'playwright';
import {firstSeat} from '../../artifacts/platform/model.mjs';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8791/api/admin/events',headers={origin:'http://127.0.0.1:5190','content-type':'application/json'};
async function api(path='',body){const r=await fetch(base+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
let row=await api('',{...firstSeat,title:'결과 선정 검증',slug:'result-check-'+Date.now()});const path='/'+row.id;
for(const message of ['첫 번째 후보 문구','두 번째 후보 문구']){await api(path+'/candidate',{stage:'voting',message,revision:row.revision});row=await api(path);}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.route('**/api/admin/events',async route=>{const response=await route.fetch();await route.fulfill({response,json:(await response.json()).filter(r=>r.id===row.id)});});
 await page.goto('http://127.0.0.1:5190/admin');await page.locator('.admin-sidebar').getByRole('button',{name:'운영',exact:true}).click();await page.locator('.admin-sidebar').getByRole('button',{name:'결과 선정',exact:true}).click();
 await page.getByRole('radio').first().waitFor();assert.equal(await page.getByRole('radio').first().isDisabled(),true);assert.equal(await page.getByRole('button',{name:'후보 추가',exact:true}).isVisible(),false);
 await api(path+'/confirm-candidates',{stage:'voting',activityRevision:row.activity_revision});
 await page.reload();await page.locator('.admin-sidebar').getByRole('button',{name:'운영',exact:true}).click();await page.locator('.admin-sidebar').getByRole('button',{name:'결과 선정',exact:true}).click();
 await page.getByRole('radio').nth(1).check();await page.locator('.operations-panel').getByRole('button',{name:'결과 선정',exact:true}).click();
 await page.getByRole('dialog').getByText('두 번째 후보 문구',{exact:true}).waitFor();await page.getByRole('button',{name:'확인 후 선정',exact:true}).click();
 await page.getByText('선정된 문구: 두 번째 후보 문구',{exact:true}).waitFor();
 assert.equal((await api(path+'/transition-preview?stage=result')).result.message,'두 번째 후보 문구');
 await page.screenshot({path:'artifacts/restructure/result-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/restructure/result-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 console.log('Result selection: unconfirmed disabled, select, confirm, persisted result and responsive layout passed.');
}finally{await browser.close();row=await api(path);await api(path+'/archive',{revision:row.revision});}
