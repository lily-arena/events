import {decodePolicy,consentItems} from '../../../../packages/event-builder/src/consents';
import { useEffect, useRef, useState } from 'react';
import AdminPreview from './AdminPreview';
import {prepareImage} from './image-upload';
import { EventOperations } from './EventOperations';
import { AdminRequestError, adminRequest as request } from './operations-api';
import type { EventDraft } from '../../../../packages/event-builder/src/model';
interface Row {id:string;draft_json:string;revision:number;visibility:string}
export default function AdminApp() {
 const [initial,setInitial]=useState<EventDraft[]|null>(null),[account,setAccount]=useState(''),[local,setLocal]=useState(false),[error,setError]=useState('');
 const revisions=useRef<Record<string,number>>({});
 function decode(row:Row):EventDraft {revisions.current[row.id]=row.revision;return {...JSON.parse(row.draft_json),id:row.id,visibility:row.visibility};}
 useEffect(()=>{let active=true;(async()=>{
  try {const session=await request<{email:string;local:boolean}>('session'); const rows=await request<Row[]>('events');
  if(active){setAccount(session.email);setLocal(session.local);setInitial(rows.map(decode));}}
  catch(e){if(!active)return;if(e instanceof AdminRequestError&&e.status===401){window.location.replace('/api/admin/auth/login');return;}setError(e instanceof Error?e.message:'연결하지 못했습니다.');}
 })();return()=>{active=false;};},[]);
 if(error)return <main className="empty-state"><h1>이벤트 관리</h1><p>{error}</p><a href="/api/admin/auth/login">회사 Google 계정으로 로그인</a><button onClick={()=>location.reload()}>다시 시도</button></main>;
 if(!initial)return null;
 return <AdminPreview storage={{initialEvents:initial,account,local,
  async load(id){const row=await request<Row>('events/'+id),d=decode(row);const policies=await request<{stage_id:string;kind:string;body:string}[]>('events/'+id+'/policies');for(const stage of ['submission','voting','result'] as const)for(const module of d.pages[stage])if(module.type==='consent'&&!module.consents)module.consents=consentItems(module,stage).map(item=>{const policy=policies.find(p=>p.stage_id===stage&&p.kind===item.id);if(!policy)return item;const decoded=decodePolicy(policy.body);return {...item,body:decoded.body,label:decoded.label??item.label};});return d;},
  async publish(draft){const saved=await request<Row>('events/'+draft.id,'PUT',{revision:revisions.current[draft.id],draft});revisions.current[saved.id]=saved.revision;return decode(await request<Row>('events/'+draft.id+'/publish','POST',{revision:saved.revision}));},
  async refresh(){return (await request<Row[]>('events')).map(decode);},
  async upload(id,file){return (await request<{id:string}>('events/'+id+'/upload','POST',{content:await prepareImage(file)})).id;},
  operations: (event,section,onChanged) => <EventOperations section={section} event={event} onChanged={row=>{revisions.current[row.id]=row.revision;onChanged?.(decode(row));}}/>,
  async save(draft){return decode(await request<Row>('events/'+draft.id,'PUT',{revision:revisions.current[draft.id],draft}));},
  async create(draft){return decode(await request<Row>('events','POST',draft));}
 }}/>;
}
