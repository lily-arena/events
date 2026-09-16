import {describe,it,expect} from 'vitest';
import {firstSeat} from '../../packages/event-builder/src/model';
import {formInputs,validateFormValues} from '../../packages/event-builder/src/inputs';
import {validateDraft} from '../../packages/event-builder/src/validation';
describe('editable bound inputs',()=>{
 it('preserves labels, order and help while keeping storage bindings',()=>{
  const draft=structuredClone(firstSeat),form=draft.pages.submission.find(m=>m.type==='form')!;
  form.inputFields=formInputs(form,'submission',draft.maxLength).reverse();
  form.inputFields.find(f=>f.binding==='message')!.maxLength=15;
  form.inputFields[0]!.label='회신 이메일';form.inputFields[0]!.help='선정 안내에 사용됩니다.';
  const saved=validateDraft(draft,'test');expect(saved.maxLength).toBe(15);expect(saved.pages.submission.find(m=>m.type==='form')!.inputFields?.[0]).toMatchObject({binding:'email',label:'회신 이메일',help:'선정 안내에 사용됩니다.'});
  form.inputFields.pop();expect(()=>validateDraft(draft,'test')).toThrow('기본 입력');
 });
 it('enforces configured length and types on requests that bypass the browser',()=>{
  const fields=formInputs(firstSeat.pages.submission.find(m=>m.type==='form')!,'submission',5);
  const values={message:'첫 자리',name:'참여자',phone:'010-1234-5678',email:'test@example.invalid'};
  expect(()=>validateFormValues(fields,values)).not.toThrow();
  expect(()=>validateFormValues(fields,{...values,message:'다섯 글자보다 긴 문구'})).toThrow();
  expect(()=>validateFormValues(fields,{...values,email:'wrong'})).toThrow();
  expect(()=>validateFormValues([{id:'ig',binding:'extra',type:'instagram',required:false,label:'계정',placeholder:'',help:'',maxLength:30,options:[]}],{'extra:ig':'bad id'})).toThrow();
 });
 it('defaults old consents to required and retains explicit optional settings',()=>{
  const draft=structuredClone(firstSeat),module=draft.pages.submission.find(m=>m.type==='consent')!;
  module.consents=[{id:'privacy',label:'개인정보',body:''},{id:'work-license',label:'활용',body:'',required:false}];
  const items=validateDraft(draft,'test').pages.submission.find(m=>m.type==='consent')!.consents!;
  expect(items[0]!.required).toBe(true);expect(items[1]!.required).toBe(false);
 });
});
