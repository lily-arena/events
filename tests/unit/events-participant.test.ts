import { describe,it,expect } from 'vitest';
import {validateParticipant,identityHashes,encryptParticipant,decryptParticipant} from '../../packages/security/src/event-participant';
describe('voter identity and private envelope',()=>{
 const value={phone:'010-1234-5678',email:'Person@Example.com',instagram:'@Arena_Fan'};
 it('normalizes phone and handle and scopes all comparisons to event/stage/round',async()=>{
  const p=validateParticipant(value,true);expect(p.phone).toBe('+821012345678');expect(p.instagram).toBe('arena_fan');
  const a=await identityHashes('test-key','a','vote',1,p),b=await identityHashes('test-key','b','vote',1,p);
  expect(a[0]!.hash).not.toBe(b[0]!.hash);
  const same=await identityHashes('test-key','a','vote',1,{...p,email:'person@example.com'});expect(a).toEqual(same);
 });
 it('encrypts every collected field and rejects cross-event decryption',async()=>{
  const keys=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const p=validateParticipant(value,true), envelope=await encryptParticipant(keys.publicKey,'v1','event','person',p);
  expect(JSON.stringify(envelope)).not.toContain('arena_fan');
  expect(await decryptParticipant(keys.privateKey,'event','person',envelope)).toEqual(p);
  await expect(decryptParticipant(keys.privateKey,'other-event','person',envelope)).rejects.toThrow();
 });
});
