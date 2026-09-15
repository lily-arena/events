import {decodePolicy} from '../../../../packages/event-builder/src/consents';
import {AdminNotice,type AdminTone} from '../../../../packages/ui/src/AdminStatus';
import {useEffect,useState} from 'react';
import {Button} from '../../../../packages/ui/src';
import {assertPublishable} from '../../../../packages/event-builder/src/validation';
import type {EventDraft,Stage} from '../../../../packages/event-builder/src/model';
import {adminRequest as api} from './operations-api';
interface Row {id:string;revision:number;current_stage_id:string;draft_json:string;visibility:string}
interface Policy {stage_id:string;kind:string;body:string}
export function PublishSetup({row,onSaved}:{row:Row;onSaved:()=>Promise<void>}){
 const [tone,setTone]=useState<AdminTone>('info');
 const [draft,setDraft]=useState<EventDraft>(()=>JSON.parse(row.draft_json));
 const [policies,setPolicies]=useState<Policy[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const stage=row.current_stage_id as Stage,base='events/'+row.id;
 useEffect(()=>{let active=true;setLoaded(false);setDraft(JSON.parse(row.draft_json));api<Policy[]>(base+'/policies').then(p=>{if(active){setPolicies(p);setLoaded(true);}}).catch(()=>{if(active)setMessage('동의문을 불러오지 못했습니다. 다시 시도해주세요.');});return()=>{active=false;};},[row.id,row.revision]);
 const baseKinds=stage==='submission'?['privacy','work-license']:stage==='voting'?['privacy']:[];
 const configured=draft.pages[stage].find(m=>m.type==='consent')?.consents;
 const body=(kind:string)=>configured?.find(x=>x.id===kind)?.body??decodePolicy(policies.find(p=>p.stage_id===stage&&p.kind===kind)?.body??'').body;
 const kinds=configured?configured.map(x=>x.id):baseKinds;
 const label=(kind:string)=>configured?.find(x=>x.id===kind)?.label??(kind==='privacy'?'개인정보 수집·이용 동의문':'응모작 활용 동의문');
 const missing:string[]=[];
 if(!draft.privacyPolicy?.trim())missing.push('개인정보 처리방침');
 if(!draft.contactUrl?.trim())missing.push('문의 주소');
 for(const kind of kinds)if(!body(kind).trim())missing.push(label(kind));
 let pageError='';try{assertPublishable(draft,stage);}catch(e){pageError=e instanceof Error?e.message:'페이지 구성을 확인해주세요.';}
 async function saveAndPublish(){setBusy(true);setMessage('');try{
  let next=row;
  const previous=JSON.parse(row.draft_json);
  if(JSON.stringify(draft)!==JSON.stringify(previous))next=await api<Row>(base,'PUT',{revision:next.revision,draft});
  const stored=await api<Policy[]>(base+'/policies');
  for(const kind of (configured?[]:kinds))if(stored.find(p=>p.stage_id===stage&&p.kind===kind)?.body!==body(kind))next=await api<Row>(base+'/policy','POST',{revision:next.revision,stage,kind,body:body(kind)});
  await api(base+'/publish','POST',{revision:next.revision});await onSaved();setTone('success');setMessage('페이지를 공개했습니다.');
 }catch(e){setTone('error');setMessage(e instanceof Error?e.message:'공개하지 못했습니다.');}finally{setBusy(false);}}
 return <div className="publish-setup">
 <h3>페이지 공개 준비</h3>
 <p>등록된 주소: <a href={'https://events.seoularena.net/'+draft.slug} target="_blank" rel="noreferrer">https://events.seoularena.net/{draft.slug}</a></p>
 {row.visibility!=='published'&&<p>현재 초안입니다. 공개 후 위 주소로 접속할 수 있습니다.</p>}
 {loaded&&missing.length>0&&<AdminNotice tone="warning"><ul>{missing.map(item=><li key={item}>{item}</li>)}</ul></AdminNotice>}
 <details open={missing.length>0}><summary>처리방침·동의문 설정</summary>
 <label>개인정보 처리방침<textarea rows={5} value={draft.privacyPolicy??''} onChange={e=>setDraft({...draft,privacyPolicy:e.target.value})}/></label>
 <label>문의 주소<input value={draft.contactUrl??''} onChange={e=>setDraft({...draft,contactUrl:e.target.value})} placeholder="mailto:담당자@seoularena.net"/></label>
 {kinds.map(kind=><label key={kind}>{label(kind)}<textarea rows={5} value={body(kind)} onChange={e=>{if(configured)setDraft(d=>({...d,pages:{...d.pages,[stage]:d.pages[stage].map(m=>m.type==='consent'?{...m,consents:m.consents!.map(x=>x.id===kind?{...x,body:e.target.value}:x)}:m)}}));else setPolicies(p=>[...p.filter(x=>!(x.stage_id===stage&&x.kind===kind)),{stage_id:stage,kind,body:e.target.value}]);}}/></label>)}
 </details>
 {!missing.length&&pageError&&<AdminNotice tone="warning">{pageError}</AdminNotice>}
 <Button disabled={busy||!loaded||!!missing.length||!!pageError} onClick={saveAndPublish}>{busy?'처리 중':'설정 저장 후 페이지 공개'}</Button>
 {message&&<AdminNotice tone={tone}>{message}</AdminNotice>}
 </div>;
}
