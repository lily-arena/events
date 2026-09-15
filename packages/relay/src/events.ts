import {startLogin,completeLogin,createSessionValue,readSessionValue} from './google.js';
import {relayRequest,jsonError} from './index.js';
import {hmacSha256Hex} from '../../security/src/hash.js';
import {base64UrlEncode,timingSafeEqual} from '../../security/src/bytes.js';
export interface GatewayEnv {PUBLIC_ORIGIN:string;GOOGLE_CLIENT_ID:string;GOOGLE_CLIENT_SECRET:string;SESSION_SECRET:string;GATEWAY_SECRET:string;ADMIN_WORKER_URL:string;PUBLIC_WORKER_URL:string}
const cookieName='__Secure-arena-events-admin',flowName='__Secure-arena-events-login';
const cookie=(name:string,value:string,ttl:number)=>`${name}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
function cookieValue(request:Request,name:string){return request.headers.get('cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(name+'='))?.slice(name.length+1)??null;}
function redirect(location:string,cookies:string[]=[]){const headers=new Headers({Location:location,'Cache-Control':'no-store'});for(const value of cookies)headers.append('Set-Cookie',value);return new Response(null,{status:303,headers});}
function decode(value:string){const text=value.replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0))));}
export async function handleGateway(request:Request,env:GatewayEnv):Promise<Response>{
 const url=new URL(request.url),origin=env.PUBLIC_ORIGIN;
 if(!origin||!env.GATEWAY_SECRET||!env.SESSION_SECRET)return jsonError(503,'NOT_CONFIGURED','서비스를 준비하고 있습니다.');
 if(!url.pathname.startsWith('/api/admin/')&&!url.pathname.startsWith('/api/events/'))return new Response(null,{status:404});
 const isAdmin=url.pathname.startsWith('/api/admin/');
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==origin)return jsonError(403,'FORBIDDEN','허용되지 않은 요청입니다.');
 try{
  if(isAdmin&&url.pathname==='/api/admin/auth/login'&&request.method==='GET'){
   if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return jsonError(503,'NOT_CONFIGURED','회사 로그인을 준비하고 있습니다.');
   const flow=await startLogin({clientId:env.GOOGLE_CLIENT_ID,redirectUri:origin+'/api/admin/auth/callback',hostedDomain:'seoularena.net'});
   const encoded=base64UrlEncode(new TextEncoder().encode(JSON.stringify({state:flow.state,nonce:flow.nonce,verifier:flow.codeVerifier,expires:Date.now()+600000})));
   const signature=await hmacSha256Hex(env.SESSION_SECRET,'login:'+encoded);
   return redirect(flow.url,[cookie(flowName,encoded+'.'+signature,600)]);
  }
  if(isAdmin&&url.pathname==='/api/admin/auth/callback'&&request.method==='GET'){
   const value=cookieValue(request,flowName),[encoded,signature]=value?.split('.')??[];
   if(!encoded||!signature||!timingSafeEqual(signature,await hmacSha256Hex(env.SESSION_SECRET,'login:'+encoded)))throw new Error('Invalid login flow');
   const flow=decode(encoded);
   if(typeof flow.expires!=='number'||flow.expires<Date.now()||flow.state!==url.searchParams.get('state')||!url.searchParams.get('code'))throw new Error('Expired login flow');
   const result=await completeLogin({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,redirectUri:origin+'/api/admin/auth/callback',code:url.searchParams.get('code')!,codeVerifier:flow.verifier,nonce:flow.nonce,allowedDomain:'seoularena.net'});
   return redirect(origin+'/admin',[cookie(flowName,'',0),cookie(cookieName,await createSessionValue(env.SESSION_SECRET,result.identity,28800),28800)]);
  }
  if(isAdmin&&url.pathname==='/api/admin/auth/logout'&&request.method==='POST')return redirect(origin+'/admin',[cookie(cookieName,'',0)]);
  const identity=isAdmin?await readSessionValue(env.SESSION_SECRET,cookieValue(request,cookieName)):null;
  if(isAdmin&&(!identity||identity.provider!=='google'))return jsonError(401,'UNAUTHENTICATED','회사 계정으로 로그인해주세요.');
  const upstreamBase=isAdmin?env.ADMIN_WORKER_URL:env.PUBLIC_WORKER_URL;
  if(!upstreamBase||new URL(upstreamBase).protocol!=='https:')return jsonError(503,'NOT_CONFIGURED','서비스를 준비하고 있습니다.');
  return relayRequest(request,{upstreamBase,secret:env.GATEWAY_SECRET,identity,dropHeaders:['cookie','authorization']});
 }catch{return jsonError(401,'UNAUTHENTICATED','로그인을 다시 시도해주세요.');}
}
