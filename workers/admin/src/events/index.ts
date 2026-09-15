import {adminErrorMessage} from './errors';
import {importPrivateKey} from '../../../../packages/security/src/envelope';
import {decryptParticipant} from '../../../../packages/security/src/event-participant';
import { verifyGatewayRequest } from '../../../../packages/security/src/gateway';
import type { AdminEventsData } from '../../../data/src/events/index';
interface Env { DATA: AdminEventsData; ENVIRONMENT: string; GATEWAY_SECRET: string; PII_PRIVATE_KEY:string }
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json = (body: unknown,status=200)=>new Response(JSON.stringify(body??{ok:true}),{status,headers});
export default {
 async fetch(request: Request,env:Env):Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/admin/')) return new Response(null,{status:404});
  if (Number(request.headers.get('content-length')??0)>300000) return json({error:'내용이 너무 큽니다.'},413);
  const body = request.method==='GET'?'':await request.text();
  if (new TextEncoder().encode(body).length>300000) return json({error:'내용이 너무 큽니다.'},413);
  try {
   let identity;
   if (env.ENVIRONMENT === 'local' && ['127.0.0.1','localhost'].includes(url.hostname)) {
    const origin=request.headers.get('origin');
    if(request.method!=='GET' && origin!=='http://127.0.0.1:5190' && origin!=='http://localhost:5190') return json({error:'허용되지 않은 요청입니다.'},403);
    identity={provider:'local',subject:'local-operator',email:'local-operator@seoularena.net'};
   } else {
    const verified = await verifyGatewayRequest(env.GATEWAY_SECRET,request,body);
    if(!verified.ok || !verified.identity || verified.identity.provider!=='google') return json({error:'로그인이 필요합니다.'},401);
    identity=verified.identity;
   }
   const assetMatch=/^\/api\/admin\/events\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
   if(assetMatch&&request.method==='GET'){const asset=await env.DATA.asset(identity,assetMatch[1]!,assetMatch[2]!);if(!asset)return new Response(null,{status:404});return new Response(Uint8Array.from(atob(asset.content_base64),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
   if(url.pathname==='/api/admin/session') return json({email:identity.email,local:identity.provider==='local'});
   const match=/^\/api\/admin\/events(?:\/([^/]+))?(?:\/(duplicate|archive|reset-scope|reset-prepare|reset|entries|review-entries|policies|policy|publish|candidates|review|confirm-candidates|result|transition-preview|transition|reveal|delete-private|audit|participants|schedule|upload))?$/.exec(url.pathname);
   if(!match) return json({error:'페이지를 찾을 수 없습니다.'},404);
   const id=match[1],action=match[2], input=body?JSON.parse(body):{};
   if(!id && request.method==='GET') return json(await env.DATA.list(identity));
   if(!id && request.method==='POST') return json(await env.DATA.create(identity,input),201);
   if(id && !action && request.method==='GET') return json(await env.DATA.get(identity,id));
   if(id && !action && request.method==='PUT') return json(await env.DATA.save(identity,id,input.revision,input.draft));
   if(id && action==='duplicate' && request.method==='POST') return json(await env.DATA.duplicate(identity,id,input.title,input.slug),201);
   if(id && action==='archive' && request.method==='POST') return json(await env.DATA.archive(identity,id,input.revision));
   if(id && action==='reset-scope' && request.method==='GET') return json(await env.DATA.resetScope(identity,id));
   if(id && action==='reset-prepare' && request.method==='POST') return json(await env.DATA.prepareReset(identity,id,input.revision,input.activityRevision));
   if(id && action==='reset' && request.method==='POST') return json(await env.DATA.reset(identity,id,input.token,input.confirmation));
   if(id && action==='upload' && request.method==='POST')return json(await env.DATA.uploadAsset(identity,id,input.content));
   if(id && action==='schedule' && request.method==='POST')return json(await env.DATA.schedule(identity,id,input.stage,input.startsAt,input.endsAt,input.revision));
   if(id && action==='review-entries' && request.method==='GET')return json(await env.DATA.reviewEntries(identity,id,url.searchParams.get('status')??'all',url.searchParams.get('q')??'',Number(url.searchParams.get('page')??1)));
   if(id && action==='entries' && request.method==='GET') return json(await env.DATA.entries(identity,id));
   if(id && action==='policies' && request.method==='GET') return json(await env.DATA.policies(identity,id));
   if(id && action==='policy' && request.method==='POST') return json(await env.DATA.savePolicy(identity,id,input.stage,input.kind,input.body,input.revision));
   if(id && action==='publish' && request.method==='POST') return json(await env.DATA.publish(identity,id,input.revision));
   if(id && action==='candidates' && request.method==='GET') return json(await env.DATA.candidates(identity,id,url.searchParams.get('stage')??'voting'));
   if(id && action==='review' && request.method==='POST') return json(await env.DATA.review(identity,id,input.entryId,input.status,input.revision));
   if(id && action==='confirm-candidates' && request.method==='POST') return json(await env.DATA.confirmCandidates(identity,id,input.stage,input.activityRevision));
   if(id && action==='result' && request.method==='POST') return json(await env.DATA.selectResult(identity,id,input.stage,input.votingStage,input.candidateId,input.revision));
   if(id && action==='transition-preview' && request.method==='GET') return json(await env.DATA.transitionPreview(identity,id,url.searchParams.get('stage')??'submission'));
   if(id && action==='transition' && request.method==='POST') return json(await env.DATA.transition(identity,id,input.stage,input.revision,input.activityRevision,input.accepting));

   if(id && action==='participants' && request.method==='GET')return json(await env.DATA.participants(identity,id));
   if(id && action==='audit' && request.method==='GET')return json(await env.DATA.auditLog(identity,id));
   if(id && action==='delete-private' && request.method==='POST')return json(await env.DATA.deletePrivate(identity,id,input.participantId));
   if(id && action==='reveal' && request.method==='POST'){
    const stored=await env.DATA.revealEnvelope(identity,id,input.participantId);
    try {const value=await decryptParticipant(await importPrivateKey(env.PII_PRIVATE_KEY),id,input.participantId,JSON.parse(stored.envelope_json));await env.DATA.revealOutcome(identity,id,input.participantId,true);return json(value);}
    catch {await env.DATA.revealOutcome(identity,id,input.participantId,false);throw new Error('개인정보를 조회하지 못했습니다.');}
   }
   return json({error:'지원하지 않는 요청입니다.'},405);
  } catch(error) {return json({error:adminErrorMessage(error)},409);}
 }
};
