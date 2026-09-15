import {chromium} from 'playwright';import assert from 'node:assert/strict';
import {firstSeat} from '../../artifacts/platform/model.mjs';import {seedEntries} from './local-entry-fixtures.mjs';
const base='http://127.0.0.1:8791/api/admin/events',headers={origin:'http://127.0.0.1:5190','content-type':'application/json'};
async function api(path='',body){const r=await fetch(base+path,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
const event=await api('',{...firstSeat,title:'심사 표 검증',slug:'review-table-'+Date.now()});const path='/'+event.id;
const entries=seedEntries(event.id,Array.from({length:251},(_,i)=>'검증 문구 '+String(i).padStart(3,'0')));
let list=await api(path+'/review-entries');assert.equal(list.total,251);assert.equal(list.entries.length,50);assert.equal(list.entries[0].masked_json,undefined);assert.equal(list.entries[0].participant_id,undefined);
assert.equal((await api(path+'/review-entries?page=6')).entries.length,1);
assert.equal((await api(path+'/review-entries?q=문구+000')).total,1);
assert.equal((await api(path+'/review-entries?q=%25')).total,0);
assert.equal((await fetch(base+path+'/candidate',{method:'POST',headers,body:JSON.stringify({stage:'voting',message:'직접 후보'})})).status,404);
const other=await api('',{...firstSeat,title:'다른 이벤트',slug:'other-review-'+Date.now()});assert.equal((await api('/'+other.id+'/review-entries')).total,0);
const browser=await chromium.launch({channel:'chrome'});let debugPage;
try{const page=await browser.newPage({viewport:{width:1440,height:900}});debugPage=page;page.on('pageerror',e=>console.log('PAGE ERROR',e.message));await page.route('**/api/admin/events',async route=>{const r=await route.fetch();const rows=await r.json();const active=rows.find(r=>r.id===event.id);await route.fulfill({response:r,json:[active,...Array.from({length:12},(_,i)=>({...active,id:'nav-only-'+i,title:'다른 이벤트 '+i}))]});});
await page.route('**/api/admin/events/nav-only-*/policies',route=>route.fulfill({json:[]}));await page.goto('http://127.0.0.1:5190/admin');await page.locator('.nav-event').first().getByRole('button',{name:'운영',exact:true}).click();await page.getByRole('button',{name:'응모작 심사',exact:true}).click();await page.getByText('총 251건 · 접수일시 최신순 (한국 시간)',{exact:true}).waitFor();
const nav=page.locator('.admin-sidebar nav');assert.ok(await nav.evaluate(el=>{el.scrollTop=100;const works=el.scrollTop>0;el.scrollTop=0;return works;}));
await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByText('2 / 6 페이지',{exact:true}).waitFor();
await page.getByLabel('문구 검색',{exact:true}).fill('문구 000');await page.getByRole('button',{name:'검색',exact:true}).click();await page.getByText('총 1건 · 접수일시 최신순 (한국 시간)',{exact:true}).waitFor();
await page.getByLabel('검증 문구 000 상태 변경',{exact:true}).selectOption('candidate');await page.getByRole('row').filter({hasText:'검증 문구 000'}).locator('.admin-status-badge').filter({hasText:'후보'}).waitFor();
assert.equal((await api(path+'/candidates?stage=voting')).length,1);
await page.getByLabel('상태 필터',{exact:true}).selectOption('approved');await page.getByText('조건에 맞는 응모작이 없습니다.',{exact:true}).waitFor();
await page.getByLabel('상태 필터',{exact:true}).selectOption('candidate');await page.getByText('총 1건 · 접수일시 최신순 (한국 시간)',{exact:true}).waitFor();
await page.getByLabel('검증 문구 000 상태 변경',{exact:true}).selectOption('approved');await page.getByText('조건에 맞는 응모작이 없습니다.',{exact:true}).waitFor();assert.equal((await api(path+'/candidates?stage=voting')).length,0);
await page.getByLabel('상태 필터',{exact:true}).selectOption('approved');await page.getByLabel('검증 문구 000 상태 변경',{exact:true}).selectOption('candidate');await page.getByText('조건에 맞는 응모작이 없습니다.',{exact:true}).waitFor();
await page.getByLabel('상태 필터',{exact:true}).selectOption('all');await page.getByLabel('문구 검색',{exact:true}).fill('');await page.getByRole('button',{name:'검색',exact:true}).click();await page.getByText('총 251건 · 접수일시 최신순 (한국 시간)',{exact:true}).waitFor();await page.screenshot({path:'artifacts/restructure/review-table-desktop.png'});
await page.setViewportSize({width:390,height:844});await page.locator('.operations-panel h1').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'artifacts/restructure/review-table-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok(await page.locator('.admin-table-scroll:visible').evaluate(el=>{el.scrollLeft=el.scrollWidth;return el.scrollLeft>0;}));await page.screenshot({path:'artifacts/restructure/review-table-mobile-status.png'});
await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'후보·투표',exact:true}).click();await page.getByRole('cell',{name:'검증 문구 000',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'후보 추가',exact:true}).count(),0);await page.getByRole('button',{name:'후보 확정',exact:true}).click();await page.getByRole('button',{name:'후보 확정 완료',exact:true}).waitFor();await page.screenshot({path:'artifacts/restructure/shortlist-table.png'});assert.equal((await api(path+'/candidates?stage=voting'))[0].confirmed,1);
console.log('251-entry pagination/search/status filters, no PII, shortlist sync/confirmation, sidebar scrolling and responsive table passed.');
}catch(error){console.log((await debugPage.locator('body').innerText()).slice(-2000));throw error;}finally{await browser.close();for(const id of [event.id,other.id]){const r=await api('/'+id);await api('/'+id+'/archive',{revision:r.revision});}}
