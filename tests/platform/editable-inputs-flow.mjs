import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {firstSeat}=await import(pathToFileURL(process.cwd()+'/artifacts/platform/model.mjs'));
async function request(url,method='GET',body,expected=200){const r=await fetch(url,{method,headers:{origin:'http://127.0.0.1:5190','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const raw=await r.text();if(!raw)throw new Error(`${method} ${url}: empty HTTP ${r.status}`);const result=JSON.parse(raw);assert.equal(r.status,expected,JSON.stringify(result));return result;}
firstSeat.pages.submission.find(m=>m.type==='consent').consents=[{id:'privacy',label:'개인정보 확인',body:''},{id:'work-license',label:'응모작 활용 확인',body:''},{id:'extra-confirmation',label:'추가 확인',body:'',required:false}];

firstSeat.pages.submission.find(m=>m.type==='form').inputFields=[
 {id:'email',binding:'email',type:'email',label:'회신 이메일',placeholder:'이메일 주소',help:'선정 안내를 보내드립니다.',maxLength:254,required:true,options:[]},
 {id:'name',binding:'name',type:'text',label:'참여자',placeholder:'성함',help:'',maxLength:10,required:true,options:[]},
 {id:'message',binding:'message',type:'text',label:'당신의 문구',placeholder:'문구 입력',help:'12자 이내로 작성해주세요.',maxLength:12,required:true,options:[]},
 {id:'phone',binding:'phone',type:'tel',label:'휴대폰',placeholder:'010-0000-0000',help:'',maxLength:13,required:true,options:[]}
];

const admin=(path,method,body,status)=>request('http://127.0.0.1:8791/api/admin/'+path,method,body,status);
let event=await admin('events','POST',{...firstSeat,privacyPolicy:'로컬 테스트용 처리방침',contactUrl:'mailto:test@example.invalid',slug:'editable-flow-'+Date.now(),title:'통합 검증 이벤트'},201);const path='events/'+event.id;
event=await admin(path+'/publish','POST',{revision:event.revision});
async function transition(stage){const p=await admin(path+'/transition-preview?stage='+stage);event=await admin(path+'/transition','POST',{stage,revision:p.revision,activityRevision:p.activityRevision,accepting:stage!=='result'});}
await transition('submission');
const publicUrl='http://127.0.0.1:8792/api/events/'+event.slug;
let view=await request(publicUrl);
assert.equal(view.event.pages.voting.length,0);assert.equal(view.policies.length,3);assert.ok(view.policies.every(p=>JSON.parse(p.body).body===''));assert.equal(JSON.parse(view.policies.find(p=>p.kind==='privacy').body).privacyPolicy,'로컬 테스트용 처리방침');
const participant={name:'테스트',phone:'01000000000',email:'test@example.invalid',instagram:'test_arena'};
const submission={revision:view.revision,requestKey:crypto.randomUUID(),turnstileToken:'mock-submission',message:'함께 만드는 첫 기록',participant,policyIds:view.policies.filter(p=>p.required).map(p=>p.id)};
const missingConsent={...submission,requestKey:crypto.randomUUID(),policyIds:submission.policyIds.slice(0,1)};await request(publicUrl+'/participate','POST',missingConsent,409);
await request(publicUrl+'/participate','POST',{...submission,requestKey:crypto.randomUUID(),message:'허용된 글자 제한보다 훨씬 긴 문구입니다'},409);
const receipt=await request(publicUrl+'/participate','POST',submission,201);
assert.deepEqual(await request(publicUrl+'/participate','POST',submission,201),receipt);
let entries=await admin(path+'/entries');assert.equal(entries.length,1);assert.ok(!JSON.stringify(entries).includes(participant.email));
const revealed=await admin(path+'/reveal','POST',{participantId:entries[0].participant_id});assert.equal(revealed.email,participant.email);
assert.ok((await admin(path+'/audit')).some(log=>log.action==='privacy.revealed'));
await admin(path+'/review','POST',{entryId:receipt.id,status:'candidate',revision:1});
const blocked=await admin(path+'/transition-preview?stage=voting');
assert.equal(blocked.canTransition,false);assert.ok(blocked.blockers.includes('후보를 먼저 확정해주세요.'));
await admin(path+'/transition','POST',{stage:'voting',revision:blocked.revision,activityRevision:blocked.activityRevision,accepting:true},409);
assert.equal((await admin(path)).current_stage_id,'submission');
const noResult=await admin(path+'/transition-preview?stage=result');assert.equal(noResult.canTransition,false);
event=await admin(path);event=await admin(path+'/confirm-candidates','POST',{stage:'voting',activityRevision:event.activity_revision});
assert.equal((await admin(path+'/transition-preview?stage=voting')).canTransition,true);
await transition('voting');view=await request(publicUrl);
const vote={revision:view.revision,requestKey:crypto.randomUUID(),turnstileToken:'mock-vote',message:'',candidateId:view.candidates[0].id,participant,policyIds:view.policies.filter(p=>p.required).map(p=>p.id)};
await request(publicUrl+'/participate','POST',vote,201);
await request(publicUrl+'/participate','POST',{...vote,requestKey:crypto.randomUUID()},409);
const candidates=await admin(path+'/candidates');assert.equal(candidates[0].votes,1);
event=await admin(path);await admin(path+'/result','POST',{stage:'result',votingStage:'voting',candidateId:candidates[0].id,revision:event.revision});
await transition('result');view=await request(publicUrl);assert.equal(view.result.message,submission.message);
const scope=await admin(path+'/reset-scope'),prepared=await admin(path+'/reset-prepare','POST',{revision:scope.revision,activityRevision:scope.activityRevision});
event=await admin(path+'/reset','POST',{token:prepared.token,confirmation:event.slug});
assert.equal((await admin(path+'/entries')).length,0);assert.equal((await admin(path+'/candidates')).length,0);
await admin(path+'/archive','POST',{revision:event.revision});
console.log('Editable inputs and optional consent Workers/D1 flow passed: consent, encrypted submission, review, candidate confirmation, vote, duplicate rejection, result, scoped reset.');
