import {afterEach,expect,it,vi} from 'vitest';
import {api} from '../../apps/admin/src/api.js';
afterEach(()=>vi.unstubAllGlobals());
it('accepts JSON null for an unselected final message',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('null',{headers:{'Content-Type':'application/json'}})));
 expect(await api.get('/api/admin/final-message')).toBeNull();
});
it.each([
 ['<html>fallback</html>','text/html'],
 ['broken json','application/json'],
])('still rejects invalid successful responses: %s',async(body,type)=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{headers:{'Content-Type':type}})));
 await expect(api.get('/api/admin/final-message')).rejects.toThrow('API 응답 형식');
});
