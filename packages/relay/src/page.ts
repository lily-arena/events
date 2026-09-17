import {publicCacheHeaders} from './public-cache.js';
import {handleGateway,type GatewayEnv} from './events.js';
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function pageMetadata(html:string,title:string,description:string,url:string){
 const t=escapeHtml(title),d=escapeHtml(description),u=escapeHtml(url);
 return html.replace(/<title>[\s\S]*?<\/title>/i,`<title>${t}</title>`).replace('</head>',`<meta property="og:type" content="website"/><meta property="og:title" content="${t}"/><meta property="og:description" content="${d}"/><meta property="og:url" content="${u}"/><meta property="og:site_name" content="서울아레나"/><meta name="description" content="${d}"/><meta name="twitter:card" content="summary"/><meta name="twitter:title" content="${t}"/><meta name="twitter:description" content="${d}"/></head>`);
}
export async function handlePage(request:Request,env:GatewayEnv,shellHtml:string):Promise<Response>{
 const url=new URL(request.url),admin=url.pathname==='/admin'||url.pathname.startsWith('/admin/');
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
 if(!admin&&!/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname))return new Response(null,{status:404});
 let title='서울아레나 이벤트 백오피스',description='서울아레나 이벤트 관리',bootstrap='';
 try{
  if(!admin){const view=await handleGateway(new Request(new URL('/api/events'+url.pathname,env.PUBLIC_ORIGIN)),env);if(!view.ok)return new Response('공개된 이벤트를 찾을 수 없습니다.',{status:view.status===404?404:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});const payload=await view.json() as {event:{title:string;browserTitle?:string;description?:string}};const {event}=payload;bootstrap=JSON.stringify(payload).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');title=event.browserTitle?.trim()||`서울아레나 ${event.title}`;description=event.description??'';}
  const shell=admin?shellHtml:shellHtml.replace('<html','<html data-event-surface="dark"').replace('</head>','<meta name="theme-color" content="#000000"/><style>html[data-event-surface="dark"],html[data-event-surface="dark"] body{background:#000;}</style></head>');
  const html=pageMetadata(shell,title,description,new URL(url.pathname,env.PUBLIC_ORIGIN).href).replace('</body>',(admin?'':`<script type="application/json" id="event-bootstrap">${bootstrap}</script>`)+'</body>');
  return new Response(request.method==='HEAD'?null:html,{headers:{'Content-Type':'text/html; charset=utf-8',...(admin?{'Cache-Control':'no-store'}:publicCacheHeaders(15))}});
 }catch{return new Response('페이지를 불러오지 못했습니다.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});}
}
