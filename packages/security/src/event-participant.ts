import { checkContact } from '../../domain/src/contact';
import { base64Encode, base64Decode, randomBytes } from './bytes';
import { hmacSha256Hex } from './hash';
import { maskName, maskPhone, maskEmail } from './masking';
export interface Participant {name:string;phone:string;email:string;instagram:string;extra?:Record<string,string>}
export function validateParticipant(value:unknown,voting:boolean,fields?:readonly {binding:string;required:boolean}[]):Participant {
 if(!value || typeof value!=='object')throw new Error('참여자 정보를 입력해주세요.');
 const input=value as Record<string,unknown>;
 const required=(key:string)=>fields?fields.some(f=>f.binding===key&&f.required):['phone','email',...(voting?['instagram']:['name'])].includes(key);
 const raw=(key:string)=>{const value=input[key]??'';if(typeof value!=='string'||value.length>254||(required(key)&&!value.trim()))throw new Error('참여자 정보를 확인해주세요.');return value.trim();};
 const name=voting?'':raw('name'),phone=raw('phone'),email=raw('email');
 // Validate supplied values independently. Optional blanks remain blank in storage.
 const contact=checkContact({name:name||'참여자',phone:phone||'01000000000',email:email||'empty@example.invalid'});
 const instagram=voting?raw('instagram').normalize('NFKC').trim().replace(/^@/,'').toLowerCase():'';
 if(instagram&&!/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(instagram))throw new Error('인스타그램 계정명을 확인해주세요.');
 return {name:name?contact.name:'',phone:phone?contact.phone:'',email:email?contact.email:'',instagram};
}
export async function identityHashes(secret:string,eventId:string,stageId:string,round:number,participant:Participant) {
 const normalized={phone:participant.phone,email:participant.email.toLowerCase(),instagram:participant.instagram};
 return Promise.all((['phone','email','instagram'] as const).filter(field=>!!normalized[field]).map(async field=>({field,hash:await hmacSha256Hex(secret,JSON.stringify(['events-v1',eventId,stageId,round,field,normalized[field]]))})));
}
export interface ParticipantEnvelope {ciphertext:string;wrappedDek:string;iv:string;keyVersion:string}
const encoder=new TextEncoder();
function aad(eventId:string,participantId:string,keyVersion:string){return encoder.encode(JSON.stringify(['events-participant-v1',eventId,participantId,keyVersion]));}
export async function encryptParticipant(publicKey:CryptoKey,keyVersion:string,eventId:string,participantId:string,value:Participant):Promise<ParticipantEnvelope> {
 const raw=randomBytes(32), iv=randomBytes(12);
 try {
  const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt']);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(eventId,participantId,keyVersion)},key,encoder.encode(JSON.stringify(value)));
  const wrapped=await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,raw);
  return {ciphertext:base64Encode(new Uint8Array(ciphertext)),wrappedDek:base64Encode(new Uint8Array(wrapped)),iv:base64Encode(iv),keyVersion};
 }finally{raw.fill(0);}
}
export async function decryptParticipant(privateKey:CryptoKey,eventId:string,participantId:string,envelope:ParticipantEnvelope):Promise<Participant> {
 const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,base64Decode(envelope.wrappedDek));
 try {
  const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64Decode(envelope.iv),additionalData:aad(eventId,participantId,envelope.keyVersion)},key,base64Decode(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain)) as Participant;
 }finally{new Uint8Array(raw).fill(0);}
}
export function maskedParticipant(p:Participant){return {name:p.name?maskName(p.name):'',phone:p.phone?maskPhone(p.phone):'',email:p.email?maskEmail(p.email):'',instagram:p.instagram?`${p.instagram[0]}${'*'.repeat(p.instagram.length-1)}`:''};}

export function validateExtraFields(value:unknown,fields:readonly {id:string;label:string;type:string;required:boolean;maxLength:number;options:string[]}[]):Record<string,string> {
 const input=value&&typeof value==='object'?value as Record<string,unknown>:{};
 return Object.fromEntries(fields.map(field=>{
  const raw=input[field.id]??'';if(typeof raw!=='string')throw new Error('추가 입력 내용을 확인해주세요.');
  const text=raw.normalize('NFC').trim();
  if((field.required&&!text)||text.length>field.maxLength||(text&&field.type==='number'&&!Number.isFinite(Number(text)))||(text&&field.type==='select'&&!field.options.includes(text)))throw new Error(`${field.label} 항목을 확인해주세요.`);
  return [field.id,text];
 }));
}
