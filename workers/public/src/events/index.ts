import {formInputs,validateFormValues} from '../../../../packages/event-builder/src/inputs';
import type {PublicEventsData} from '../../../data/src/events/index';
import {verifyGatewayRequest} from '../../../../packages/security/src/gateway';
import {verifyTurnstile} from '../../../../packages/security/src/turnstile';
import {validateParticipant,validateExtraFields,identityHashes,encryptParticipant,maskedParticipant} from '../../../../packages/security/src/event-participant';
import {importPublicKey} from '../../../../packages/security/src/envelope';
import {hmacSha256Hex,canonicalJson} from '../../../../packages/security/src/hash';
interface Env {DATA:PublicEventsData;ENVIRONMENT:string;GATEWAY_SECRET:string;PII_PUBLIC_KEY:string;PII_KEY_VERSION:string;IDENTITY_HMAC_KEY:string;TURNSTILE_SECRET:string;TURNSTILE_SITE_KEY:string}
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url),match=/^\/api\/events\/([a-z0-9-]+)(?:\/(participate|vote-check|assets)(?:\/([a-f0-9-]+))?)?$/.exec(url.pathname);
 if(!match)return new Response(null,{status:404});
 if(Number(request.headers.get('content-length')??0)>32768)return json({error:'입력 내용이 너무 큽니다.'},413);
 const body=request.method==='GET'?'':await request.text();if(body.length>32768)return json({error:'입력 내용이 너무 큽니다.'},413);
 try {
  const local=env.ENVIRONMENT==='local'&&['127.0.0.1','localhost'].includes(url.hostname);
  let ip='local';
  if(!local){const verified=await verifyGatewayRequest(env.GATEWAY_SECRET,request,body);if(!verified.ok)return json({error:'허용되지 않은 요청입니다.'},403);ip=verified.clientIp??'unknown';}
  else if(request.method!=='GET'&&request.headers.get('origin')!=='http://127.0.0.1:5190')return json({error:'허용되지 않은 요청입니다.'},403);
  if(match[2]==='assets'&&match[3]&&request.method==='GET'){const asset=await env.DATA.image(match[1]!,match[3]);if(!asset)return new Response(null,{status:404});return new Response(Uint8Array.from(atob(asset.content_base64),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.mime,'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});}
  const view=await env.DATA.event(match[1]!);if(!view)return new Response(null,{status:404});
  if(request.method==='GET'&&!match[2])return json({...view,turnstileSiteKey:env.TURNSTILE_SITE_KEY??'',local});
  if(request.method==='POST'&&match[2]==='vote-check'){
   const input=JSON.parse(body),stage=view.stage;
   if(!stage||stage.kind!=='voting')return json({error:'투표 기간이 아닙니다.'},409);
   const challenge=await verifyTurnstile({mode:local?'mock':'live',secret:env.TURNSTILE_SECRET,allowedHostnames:['events.seoularena.net'],environment:env.ENVIRONMENT},{token:input.turnstileToken??'',action:'voter_session',remoteIp:local?null:ip,idempotencyKey:crypto.randomUUID(),now:Date.now()});
   if(!challenge.ok)return json({error:'자동 입력 방지를 다시 확인해주세요.'},422);
   const participant=validateParticipant(input.participant,true,[]);
   const identities=await identityHashes(env.IDENTITY_HMAC_KEY,view.event.id,String(stage.id),Number(stage.round),participant);
   const status=await env.DATA.checkVote(view.event.id,String(stage.id),Number(stage.round),identities,await hmacSha256Hex(env.IDENTITY_HMAC_KEY,JSON.stringify(['vote-check',view.event.id,ip])));
   return json(status);
  }
  if(request.method!=='POST'||match[2]!=='participate')return json({error:'지원하지 않는 요청입니다.'},405);
  const input=JSON.parse(body),stage=view.stage;
  if(!stage || !['submission','voting'].includes(String(stage.kind)))return json({error:'참여 기간이 아닙니다.'},409);
  if(typeof input.requestKey!=='string'|| !/^[a-f0-9-]{36}$/.test(input.requestKey))return json({error:'요청을 다시 확인해주세요.'},400);
  const kind=stage.kind as 'submission'|'voting';
  const challenge=await verifyTurnstile({mode:local?'mock':'live',secret:env.TURNSTILE_SECRET,allowedHostnames:['events.seoularena.net'],environment:env.ENVIRONMENT},{token:input.turnstileToken??'',action:kind==='voting'?'vote':'submission',remoteIp:local?null:ip,idempotencyKey:input.requestKey,now:Date.now()});
  if(!challenge.ok)return json({error:'자동 입력 방지를 다시 확인해주세요.'},422);
  const module=view.event.pages[kind].find((m:{type:string})=>m.type==='form');
  const fields=module?formInputs(module,kind,view.event.maxLength):[];
  validateFormValues(fields,{...input.participant,message:input.message,...Object.fromEntries(Object.entries(input.extra??{}).map(([id,value])=>['extra:'+id,value]))});
  const participant=validateParticipant(input.participant,kind==='voting',module?fields:undefined),participantId=crypto.randomUUID();
  participant.extra=validateExtraFields(input.extra,fields.filter(f=>f.binding==='extra'));
  const envelope=await encryptParticipant(await importPublicKey(env.PII_PUBLIC_KEY),env.PII_KEY_VERSION,view.event.id,participantId,participant);
  if(!Array.isArray(input.policyIds)||input.policyIds.some((x:unknown)=>typeof x!=='string')||typeof input.message!=='string')return json({error:'입력 내용을 확인해주세요.'},422);
  const identities=kind==='voting'?await identityHashes(env.IDENTITY_HMAC_KEY,view.event.id,String(stage.id),Number(stage.round),participant):[];
  const duplicate=async()=>kind==='voting'&&!stage.allow_repeat&&(await env.DATA.checkVote(view.event.id,String(stage.id),Number(stage.round),identities,await hmacSha256Hex(env.IDENTITY_HMAC_KEY,JSON.stringify(['vote-submit-check',view.event.id,ip])))).duplicate;
  let receipt;
  try{receipt=await env.DATA.participate({eventId:view.event.id,stageId:String(stage.id),round:Number(stage.round),revision:input.revision,participantId,kind,message:input.message,candidateId:input.candidateId??'',policyIds:input.policyIds,envelope,masked:maskedParticipant(participant),identities,requestKey:input.requestKey,payloadHmac:await hmacSha256Hex(env.IDENTITY_HMAC_KEY,canonicalJson({participant,message:input.message,candidate:input.candidateId,policies:input.policyIds})),rateHmac:await hmacSha256Hex(env.IDENTITY_HMAC_KEY,JSON.stringify([view.event.id,ip])),identityKeyVersion:env.PII_KEY_VERSION});
  }catch(error){if(await duplicate())return json({code:'DUPLICATE_VOTE',error:'이미 투표에 사용된 참여 정보가 있습니다. 중복 투표는 할 수 없습니다.'},409);throw error;}
  return json(receipt,201);
 }catch{return json({error:'참여를 완료하지 못했습니다. 입력 내용·이벤트 상태·중복 참여 여부를 확인해주세요.'},409);}
}};
