import {it,expect} from 'vitest';
import {privateDetailRows} from '../../apps/admin/src/events/PrivateDetails';
import {firstSeat} from '../../packages/event-builder/src/model';
it('omits empty values and never renders an empty extra object as Instagram',()=>{
 const rows=privateDetailRows({name:'테스트',phone:'',email:'test@example.invalid',instagram:'',extra:{}},firstSeat);
 expect(rows.map(r=>r.key)).toEqual(['name','email']);
 expect(rows.some(r=>r.value==='{}')).toBe(false);
});
it('renders collected extra fields separately with their configured labels',()=>{
 const event=structuredClone(firstSeat);event.pages.submission.find(m=>m.type==='form')!.fields=[{id:'city',label:'지역',type:'text',required:false,maxLength:100,options:[]}];
 expect(privateDetailRows({extra:{city:'서울',blank:''}},event)).toEqual([{key:'extra:city',label:'지역',value:'서울'}]);
});
