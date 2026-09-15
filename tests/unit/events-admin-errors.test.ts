import {describe,it,expect} from 'vitest';
import {adminErrorMessage} from '../../workers/admin/src/events/errors';
describe('관리자 오류 안내',()=>{
 it('공개 조건 미충족 이유를 전달한다',()=>{expect(adminErrorMessage(new Error('개인정보 처리방침과 문의 주소를 입력해주세요.'))).toBe('개인정보 처리방침과 문의 주소를 입력해주세요.');});
 it('예상하지 못한 DB 오류 내용은 노출하지 않는다',()=>{expect(adminErrorMessage(new Error('SQL secret participant@example.invalid'))).not.toContain('participant@example.invalid');});
});
