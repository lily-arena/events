import { describe,it,expect } from 'vitest';
import {exclusionParagraphs} from '../../apps/public/src/exclusion-copy.js';
describe('exclusion notice prose',()=>{
 it('preserves all criteria and separates the arena explanation without a list heading',()=>{
  expect(exclusionParagraphs(['특정 아티스트를 지칭하는 문구\n(모든 공연과 관객을 위한 공간입니다.)','개인정보가 노출되는 문구'])).toEqual(['특정 아티스트를 지칭하는 문구, 개인정보가 노출되는 문구는 선정에서 제외될 수 있습니다.','모든 공연과 관객을 위한 공간입니다.']);
 });
 it('retains inline parentheses in copyright examples',()=>{
  expect(exclusionParagraphs(['기존 저작물(가사, 대사, 슬로건 등)을 그대로 인용한 문구'])[0]).toContain('(가사, 대사, 슬로건 등)');
 });
});
