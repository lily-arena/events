import {describe,it,expect} from 'vitest';
import {firstSeat,moveModule,type PageModule} from '../../packages/event-builder/src/model';
import {validateDraft} from '../../packages/event-builder/src/validation';
const header:PageModule={id:'header',type:'header-image',title:'',body:'',headerHeight:80,imageAssetId:'asset'};
describe('header image configuration',()=>{
 it('preserves uploaded asset and viewport height through validation',()=>{const draft=structuredClone(firstSeat);draft.pages.submission.unshift(header);expect(validateDraft(draft,'event').pages.submission[0]).toMatchObject(header);});
 it('rejects invalid heights and multiple headers',()=>{for(const height of [0,39,101,80.5,'80vh']){const draft=structuredClone(firstSeat);draft.pages.submission.unshift({...header,headerHeight:height as number});expect(()=>validateDraft(draft,'event')).toThrow();}const draft=structuredClone(firstSeat);draft.pages.submission.unshift(header,{...header,id:'second'});expect(()=>validateDraft(draft,'event')).toThrow();});
 it('keeps the header at the top when reordering modules',()=>{const list=[header,...firstSeat.pages.submission];expect(moveModule(list,header.id,1)).toEqual(list);expect(moveModule(list,list[1]!.id,-1)).toEqual(list);});
});
