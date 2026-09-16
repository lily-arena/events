import { describe,it,expect } from 'vitest';
import {validateParticipant,identityHashes,encryptParticipant,decryptParticipant,maskedParticipant} from '../../packages/security/src/event-participant';
describe('voter identity and private envelope',()=>{
 const value={phone:'010-1234-5678',email:'Person@Example.com',instagram:'@Arena_Fan'};
 it('normalizes phone and handle and scopes all comparisons to event/stage/round',async()=>{
  const p=validateParticipant(value,true);expect(p.phone).toBe('+821012345678');expect(p.instagram).toBe('arena_fan');
  const a=await identityHashes('test-key','a','vote',1,p),b=await identityHashes('test-key','b','vote',1,p);
  expect(a[0]!.hash).not.toBe(b[0]!.hash);
  const same=await identityHashes('test-key','a','vote',1,{...p,email:'person@example.com'});expect(a).toEqual(same);
 });
 it('allows optional blanks without inventing stored values or shared empty identity hashes',async()=>{
  const fields=['name','phone','email','instagram'].map(binding=>({binding,required:false}));
  const empty=validateParticipant({},true,fields);
  expect(empty).toEqual({name:'',phone:'',email:'',instagram:''});
  expect(Object.values(maskedParticipant(empty)).every(value=>value==='')).toBe(true);
  expect(await identityHashes('key','event','voting',1,empty)).toEqual([]);
  const partial=validateParticipant({email:'test@example.invalid'},true,fields);
  expect((await identityHashes('key','event','voting',1,partial)).map(x=>x.field)).toEqual(['email']);
  expect(()=>validateParticipant({email:'broken'},true,fields)).toThrow();
  expect(()=>validateParticipant({},true,[{binding:'phone',required:true}])).toThrow();
 });
 it('encrypts every collected field and rejects cross-event decryption',async()=>{
  const keys=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const p=validateParticipant(value,true), envelope=await encryptParticipant(keys.publicKey,'v1','event','person',p);
  expect(JSON.stringify(envelope)).not.toContain('arena_fan');
  expect(await decryptParticipant(keys.privateKey,'event','person',envelope)).toEqual(p);
  await expect(decryptParticipant(keys.privateKey,'other-event','person',envelope)).rejects.toThrow();
 });
});
