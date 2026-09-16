import {it,expect} from 'vitest';
import {firstSeat,eventBrowserTitle} from '../../packages/event-builder/src/model';
import {validateDraft} from '../../packages/event-builder/src/validation';
it('defaults existing and new events to the branded title',()=>{expect(eventBrowserTitle(firstSeat)).toBe('서울아레나 FIRST SEAT');expect(eventBrowserTitle({...firstSeat,title:'새 이벤트',browserTitle:' '})).toBe('서울아레나 새 이벤트');});
it('preserves a custom tab name through saving and rejects oversized values',()=>{const draft=validateDraft({...firstSeat,browserTitle:'서울아레나 특별 이벤트'},'id');expect(eventBrowserTitle(draft)).toBe('서울아레나 특별 이벤트');expect(draft.title).toBe(firstSeat.title);expect(()=>validateDraft({...firstSeat,browserTitle:'a'.repeat(151)},'id')).toThrow();});
