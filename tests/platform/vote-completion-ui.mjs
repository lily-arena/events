import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {firstSeat} from '../../artifacts/platform/model.mjs';
const browser=await chromium.launch({channel:'chrome'}),context=await browser.newContext(),page=await context.newPage();
let kind='voting',round=1,repeat=0,duplicate=false,fail=false,checks=0,submissions=0;
const fixture=()=>({event:{...firstSeat,id:'completion-test',slug:'completion-test'},stage:{id:kind,kind,round,allow_repeat:repeat,accepting:1,starts_at:null,ends_at:null},policies:[{id:'privacy',kind:'privacy',body:'Privacy test',required:1}],candidates:[{id:'candidate',message:'함께 만드는 첫 기록'}],result:null,revision:1,local:true,turnstileSiteKey:'mock'});
await context.route('**/api/events/completion-test**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path.endsWith('/vote-check')){checks++;await new Promise(r=>setTimeout(r,100));return route.fulfill({status:fail?503:200,json:fail?{error:'Unavailable'}:{duplicate}});}
 if(path.endsWith('/participate')){submissions++;return route.fulfill({status:201,json:{id:'receipt',kind}});}
 return route.fulfill({json:fixture()});
});
try{
 await page.setViewportSize({width:390,height:900});await page.goto('http://127.0.0.1:5190/completion-test');
 const button=page.getByRole('button',{name:'투표하기',exact:true});
 duplicate=true;await page.locator('input[name=phone]').fill('01012345678');
 await page.getByText('이미 투표에 사용된 참여 정보가 있습니다.',{exact:false}).waitFor();assert.ok(await button.isDisabled());
 duplicate=false;await page.locator('input[name=phone]').fill('01098765432');
 await page.waitForFunction(()=>!document.querySelector('.submission-action .button').disabled);
 fail=true;await page.locator('input[name=email]').fill('test@example.invalid');
 await page.getByRole('button',{name:'다시 확인',exact:true}).waitFor();assert.ok(await button.isDisabled());
 fail=false;await page.getByRole('button',{name:'다시 확인',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.submission-action .button').disabled);
 await page.locator('input[name=instagram]').fill('test_arena');
 await page.locator('input[name=candidate]').check();await page.locator('input[name=policy]').check();
 await page.waitForFunction(()=>!document.querySelector('.submission-action .button').disabled);await button.click();
 await page.getByRole('heading',{name:'투표가 완료되었습니다.'}).waitFor();assert.equal(await page.getByRole('button',{name:'돌아가기'}).count(),0);assert.equal(await page.getByRole('dialog').count(),0);
 await page.reload();await page.getByRole('heading',{name:'투표가 완료되었습니다.'}).waitFor();
 const tab=await context.newPage();await tab.goto('http://127.0.0.1:5190/completion-test');await tab.getByRole('heading',{name:'투표가 완료되었습니다.'}).waitFor();await tab.close();
 const stored=await page.evaluate(()=>JSON.stringify(localStorage));assert.ok(!stored.includes('example.invalid'));assert.ok(!stored.includes('0109876'));
 await page.screenshot({path:'artifacts/restructure/vote-complete-final-mobile.png'});
 round=2;await page.reload();await page.locator('input[name=phone]').waitFor();
 repeat=1;duplicate=true;const oldChecks=checks;await page.locator('input[name=phone]').fill('01012345678');await page.reload();await page.locator('input[name=phone]').fill('01012345678');await page.waitForTimeout(900);assert.equal(checks,oldChecks);
 kind='submission';await page.reload();await page.locator('[name=message]').fill('함께 만드는 첫 기록');await page.locator('[name=name]').fill('테스트');await page.locator('[name=phone]').fill('01012345678');await page.locator('[name=email]').fill('test@example.invalid');await page.locator('[name=policy]').check();await page.getByRole('button',{name:'문구 보내기',exact:true}).click();await page.getByRole('heading',{name:'접수가 완료되었습니다.'}).waitFor();await page.getByRole('button',{name:'돌아가기',exact:true}).click();await page.locator('[name=message]').waitFor();assert.equal(await page.locator('[name=message]').inputValue(),'');
 assert.equal(submissions,2);console.log('Completion pages, reload/new tab persistence, round reset, optional repeat, duplicate UI and retry passed.');
}finally{await browser.close();}
