import { describe, it, expect } from 'vitest';
import { firstSeat as seed } from '../../packages/event-builder/src/model';
import { validateDraft, assertPublishable } from '../../packages/event-builder/src/validation';
const firstSeat={...seed,privacyPolicy:'로컬 테스트용 처리방침',contactUrl:'mailto:test@example.invalid'};
describe('event configuration boundary', () => {
 it('assigns identity and visibility on server and strips arbitrary properties', () => {
  const value = validateDraft({...firstSeat, id:'forged', visibility:'published', css:'bad'}, 'server-id');
  expect(value.id).toBe('server-id'); expect(value.visibility).toBe('draft'); expect(value).not.toHaveProperty('css');
 });
 it('rejects reserved routes, invalid typography and duplicate functional modules', () => {
  expect(()=>validateDraft({...firstSeat,slug:'admin'},'id')).toThrow();
  const value = structuredClone(firstSeat);
  value.pages.submission[0]!.titleSize = '999px' as never;
  expect(()=>validateDraft(value,'id')).toThrow();
  value.pages.submission = [...firstSeat.pages.submission, {...firstSeat.pages.submission.find(m=>m.type==='form')!,id:'second'}];
  expect(()=>validateDraft(value,'id')).toThrow();
 });
 it('requires participation capabilities before publication', () => {
  const value = validateDraft(firstSeat,'id');
  expect(()=>assertPublishable(value,'submission')).not.toThrow();
  value.pages.submission = value.pages.submission.filter(m=>m.type!=='consent');
  expect(()=>assertPublishable(value,'submission')).toThrow('개인정보');
 });
});

describe('schedule configuration',()=>{
 const draft=(start:string,end:string)=>({...firstSeat,pages:{...firstSeat.pages,submission:[...firstSeat.pages.submission,{id:'schedule',type:'schedule',title:'일정',body:'',schedule:[{id:'date',title:'접수',start,end,description:''}]}]}});
 it('preserves date-only ranges and rejects invalid dates or reversed ranges',()=>{
  expect(validateDraft(draft('2026-10-01','2026-10-15'),'id').pages.submission.at(-1)?.schedule?.[0]?.end).toBe('2026-10-15');
  expect(()=>validateDraft(draft('2026-02-30',''),'id')).toThrow();
  expect(()=>validateDraft(draft('2026-10-15','2026-10-01'),'id')).toThrow();
  expect(()=>validateDraft(draft('','2026-10-01'),'id')).toThrow();
  expect(()=>validateDraft(draft('',''),'id')).not.toThrow();
 });
});
