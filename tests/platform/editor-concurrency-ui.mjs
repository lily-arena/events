import {chromium} from 'playwright';import assert from 'node:assert/strict';import {firstSeat} from '../../artifacts/platform/model.mjs';
let row={id:'concurrency-fixture',revision:1,visibility:'draft',draft_json:JSON.stringify({...firstSeat,id:'concurrency-fixture',slug:'concurrency-fixture',privacyPolicy:'Initial policy'})};
let release,hold=false,held=false;const writes=[];
async function route(r){const path=new URL(r.request().url()).pathname,method=r.request().method();
 if(path.endsWith('/session'))return r.fulfill({json:{email:'test@seoularena.net',local:true}});
 if(path.endsWith('/edit-state'))return r.fulfill({json:{revision:row.revision}});
 if(path.endsWith('/policies'))return r.fulfill({json:[]});
 if(method==='GET')return r.fulfill({json:path.endsWith('/events')?[row]:row});
 const input=r.request().postDataJSON();writes.push({method,path,revision:input.revision});if(hold){held=true;await new Promise(resolve=>release=resolve);hold=false;}
 if(input.revision!==row.revision)return r.fulfill({status:409,json:{code:'EDIT_CONFLICT',error:'다른 운영자가 이벤트를 변경했습니다. 내 수정 내용은 유지됩니다. 최신 내용을 확인해주세요.'}});
 row={...row,revision:row.revision+1,visibility:path.endsWith('/save-publish')?'published':row.visibility,draft_json:JSON.stringify(input.draft)};return r.fulfill({json:row});
}
const browser=await chromium.launch({channel:'chrome'});try{
 const ca=await browser.newContext({viewport:{width:1440,height:1000}}),cb=await browser.newContext({viewport:{width:1440,height:1000}});await ca.route('**/api/admin/**',route);await cb.route('**/api/admin/**',route);const a=await ca.newPage(),b=await cb.newPage();
 for(const p of [a,b]){await p.goto('http://127.0.0.1:5190/admin');await p.locator('.admin-sidebar').getByRole('button',{name:'콘텐츠 편집',exact:true}).click();await p.locator('.editor-heading').waitFor();}
 const field=p=>p.locator('.stage-configuration textarea').first();const save=p=>p.getByRole('button',{name:'저장',exact:true});
 await field(b).fill('B unsaved policy');await field(a).fill('A saved policy');await save(a).click();await a.getByText('저장했습니다.',{exact:true}).waitFor();
 await save(b).click();await b.getByRole('button',{name:'최신 내용 확인',exact:true}).waitFor();assert.ok(await save(b).isDisabled());assert.equal(await field(b).inputValue(),'B unsaved policy');assert.equal(JSON.parse(row.draft_json).privacyPolicy,'A saved policy');assert.equal(writes[1].revision,1);
 await b.getByRole('button',{name:'최신 내용 확인',exact:true}).click();const compare=b.getByRole('dialog',{name:'최신 내용 확인',exact:true});await compare.waitFor();await compare.getByText('A saved policy',{exact:true}).waitFor();await compare.getByRole('button',{name:'내 수정 화면',exact:true}).click();await compare.getByText('B unsaved policy',{exact:true}).waitFor();await b.screenshot({path:'artifacts/restructure/editor-conflict-desktop.png'});
 await compare.getByRole('button',{name:'최신 버전으로 다시 편집',exact:true}).click();const leave=b.getByRole('dialog',{name:'저장하지 않은 변경이 있습니다.',exact:true});await leave.waitFor();await leave.getByRole('button',{name:'수정 내용을 버리고 계속'}).click();await compare.waitFor({state:'hidden'});assert.equal(await field(b).inputValue(),'A saved policy');
 hold=true;await field(b).fill('B saved while typing');await save(b).click();while(!held)await b.waitForTimeout(20);await field(b).fill('B extra edits during save');release();await b.getByText('저장했습니다.',{exact:true}).waitFor();await b.getByText('저장하지 않은 변경 있음',{exact:true}).waitFor();assert.equal(await field(b).inputValue(),'B extra edits during save');assert.equal(JSON.parse(row.draft_json).privacyPolicy,'B saved while typing');
 await save(b).click();await b.locator('.save-status').filter({hasText:'저장됨'}).waitFor();assert.equal(JSON.parse(row.draft_json).privacyPolicy,'B extra edits during save');assert.equal(writes.at(-1).revision,3);
 const previous=writes.length;await field(b).fill('Published once');await b.getByRole('button',{name:'저장 후 공개',exact:true}).click();await b.getByText('페이지와 동의문을 공개했습니다.',{exact:true}).waitFor();assert.equal(writes.length,previous+1);assert.ok(writes.at(-1).path.endsWith('/save-publish'));
 await field(b).fill('Keep when navigation cancelled');await b.locator('.admin-sidebar').getByRole('button',{name:'대시보드',exact:true}).click();await b.getByRole('dialog',{name:'저장하지 않은 변경이 있습니다.',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();assert.equal(await field(b).inputValue(),'Keep when navigation cancelled');
 await a.evaluate(()=>window.dispatchEvent(new Event('focus')));await a.getByRole('button',{name:'최신 내용 확인',exact:true}).waitFor();await a.setViewportSize({width:390,height:900});await a.screenshot({path:'artifacts/restructure/editor-conflict-mobile.png'});
 console.log('Two-editor conflict retention, latest comparison, explicit discard, in-flight edits, atomic publish and focus detection passed.');
}finally{await browser.close();}
