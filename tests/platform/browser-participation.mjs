import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {firstSeat}=await import(pathToFileURL(process.cwd()+'/artifacts/platform/model.mjs'));
async function api(path,method='GET',body){const r=await fetch('http://127.0.0.1:8791/api/admin/'+path,{method,headers:{origin:'http://127.0.0.1:5190','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const json=await r.json();assert.ok(r.ok,JSON.stringify(json));return json;}
let event=await api('events','POST',{...firstSeat,slug:'browser-'+Date.now(),privacyPolicy:'테스트용 처리방침',contactUrl:'mailto:test@example.invalid'});const path='events/'+event.id;
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5190/admin?connected');
 const content=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,100,100);return canvas.toDataURL('image/webp').split(',')[1];});
 const asset=await api(path+'/upload','POST',{content});
 assert.equal((await fetch('http://127.0.0.1:8792/api/events/'+event.slug+'/assets/'+asset.id)).status,404);
 const draft=JSON.parse(event.draft_json);draft.pages.submission.splice(1,0,{id:'image',type:'image',title:'',body:'',imageAssetId:asset.id,imageAlt:'테스트 이미지'});
 draft.pages.submission.find(m=>m.type==='form').fields=[{id:'city',label:'거주 도시',type:'text',required:true,maxLength:50,options:[]}];
 event=await api(path,'PUT',{revision:event.revision,draft});
 for(const kind of ['privacy','work-license'])event=await api(path+'/policy','POST',{stage:'submission',kind,body:'브라우저 테스트 전용 동의문',revision:event.revision});
 event=await api(path+'/publish','POST',{revision:event.revision});const preview=await api(path+'/transition-preview?stage=submission');await api(path+'/transition','POST',{stage:'submission',revision:preview.revision,activityRevision:preview.activityRevision,accepting:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5190/'+event.slug+'?connected');await page.getByRole('heading',{name:'FIRST SEAT',exact:true}).waitFor();await page.locator('.event-image').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`artifacts/platform/public-${width}.png`,fullPage:true});}
 await page.locator('[name=message]').fill('서울아레나의 첫 기록');await page.locator('[name=name]').fill('테스트');await page.locator('[name=phone]').fill('01000000000');await page.locator('[name=email]').fill('test@example.invalid');await page.locator('[name="extra:city"]').fill('테스트 도시');for(const input of await page.locator('[name=policy]').all())await input.check();
 await page.getByRole('button',{name:'문구 보내기',exact:true}).click();await page.getByRole('heading',{name:'참여가 완료되었습니다.'}).waitFor();
 const entries=await api(path+'/entries');assert.equal(entries.length,1);const person=await api(path+'/reveal','POST',{participantId:entries[0].participant_id});assert.equal(person.extra.city,'테스트 도시');
 const duplicate=await api(path+'/duplicate','POST',{title:'복제 검증',slug:'copy-'+Date.now()});assert.equal((await api('events/'+duplicate.id+'/entries')).length,0);assert.equal((await api('events/'+duplicate.id+'/policies')).length,2);
 assert.equal((await fetch('http://127.0.0.1:8791/api/admin/events/'+duplicate.id+'/assets/'+asset.id)).status,200);
 await api('events/'+duplicate.id+'/archive','POST',{revision:duplicate.revision});event=await api(path);await api(path+'/archive','POST',{revision:event.revision});
 assert.deepEqual(errors,[]);console.log('Browser passed: responsive public page, private draft image, upload/publication, custom field encrypted submission, consent, image/policy-only duplication.');
}finally{await browser.close();}
