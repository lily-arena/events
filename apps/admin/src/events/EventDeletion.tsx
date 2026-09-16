import {useState} from 'react';
import {Button,Modal} from '../../../../packages/ui/src';
import {AdminNotice} from '../../../../packages/ui/src/AdminStatus';
import {adminRequest as api} from './operations-api';
interface Scope {title:string;slug:string;revision:number;activityRevision:number;counts:Record<string,number>}
export function EventDeletion({eventId,onDeleted}:{eventId:string;onDeleted:(id:string)=>void}) {
 const [scope,setScope]=useState<Scope|null>(null),[token,setToken]=useState(''),[confirmation,setConfirmation]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const base='events/'+eventId;
 async function open(){setBusy(true);setError('');setToken('');setConfirmation('');setAck(false);try{setScope(await api<Scope>(base+'/delete-scope'));}catch(e){setError(e instanceof Error?e.message:'삭제 범위를 불러오지 못했습니다.');}finally{setBusy(false);}}
 async function prepare(){if(!scope||!ack)return;setBusy(true);setError('');try{const next=await api<{token:string;scope:Scope}>(base+'/delete-prepare','POST',{revision:scope.revision,activityRevision:scope.activityRevision});setToken(next.token);setScope(next.scope);}catch(e){setError(e instanceof Error?e.message:'삭제 범위를 다시 확인해주세요.');}finally{setBusy(false);}}
 async function remove(){if(!scope||confirmation!==scope.slug||!ack||!token||busy)return;setBusy(true);setError('');try{await api(base+'/delete','POST',{token,confirmation});onDeleted(eventId);}catch(e){setToken('');setAck(false);setError(e instanceof Error?e.message:'삭제하지 못했습니다. 삭제 범위를 다시 확인해주세요.');}finally{setBusy(false);}}
 return <section className="event-danger-zone">
  <h2>이벤트 삭제</h2><p>공개 링크가 비활성화되고, 페이지 설정과 모든 참여 데이터가 영구 삭제됩니다. 복구할 수 없습니다.</p>
  {!scope&&error&&<AdminNotice tone="error">{error}</AdminNotice>}
  <Button className="danger-button" disabled={busy} onClick={open}>이벤트 삭제</Button>
  <Modal className="event-delete-dialog" open={!!scope} onOpenChange={v=>{if(!v&&!busy){setScope(null);setError('');}}} title={token?'이벤트 영구 삭제 확인':'이벤트 삭제 범위 확인'} description="해당 이벤트만 삭제됩니다. 삭제 후에는 복구할 수 없습니다.">
   {scope&&<><strong>{scope.title}</strong><p className="delete-event-address">https://events.seoularena.net/{scope.slug}</p>
    <dl className="delete-scope-list">{[['응모작','event_entries'],['투표','event_votes'],['개인정보','event_participants'],['후보','event_candidates'],['이미지','event_assets']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{scope.counts[key!]??0}건</dd></div>)}</dl>
    <p>페이지 설정·일정·결과·동의문·운영 기록도 함께 삭제됩니다.</p>
    {error&&<AdminNotice tone="error">{error}</AdminNotice>}
    {!token?<><label className="delete-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>삭제 범위와 복구 불가를 확인했습니다.</label><Button disabled={!ack||busy} onClick={prepare}>다음: 최종 확인</Button><Button disabled={busy} onClick={open}>삭제 범위 새로 확인</Button></>:<><label className="field">확인을 위해 이벤트 주소를 입력해주세요.<strong>{scope.slug}</strong><input aria-label="삭제할 이벤트 주소" autoComplete="off" spellCheck={false} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><Button className="danger-button" disabled={busy||confirmation!==scope.slug} onClick={remove}>{busy?'삭제 중':'영구 삭제'}</Button></>}
   </>}
  </Modal>
 </section>;
}
