import {EventDeletion} from './EventDeletion';
import {PrivateDetails} from './PrivateDetails';
import {EntryReview} from './EntryReview';
import {AdminNotice,type AdminTone} from '../../../../packages/ui/src/AdminStatus';
import {ParticipantTable} from './ParticipantTable';
import {useEffect,useState} from 'react';
import {Button,Modal} from '../../../../packages/ui/src';
import {stageNames,stagesFor,type EventDraft,type Stage} from '../../../../packages/event-builder/src/model';
import {adminRequest as api} from './operations-api';
interface Row {id:string;revision:number;activity_revision:number;current_stage_id:string;visibility:string;draft_json:string;accepting:number}
interface Candidate {id:string;message:string;votes:number;confirmed:number;position:number}
interface Preview {checks:{id:string;label:string;complete:boolean}[];stage:{starts_at:number|null;ends_at:number|null};canTransition:boolean;blockers:string[];revision:number;activityRevision:number;candidates:Candidate[];result:{id:string;message:string}|null}
interface Scope {revision:number;activityRevision:number;counts:Record<string,number>}
export function EventOperations({event,onChanged,onDeleted,section='overview'}:{section?:string;event:EventDraft;onChanged:(row:Row)=>void;onDeleted?:(id:string)=>void}) {
 const [row,setRow]=useState<Row|null>(null),[candidates,setCandidates]=useState<Candidate[]>([]);
 const [stage,setStage]=useState<Stage>(stagesFor(event)[0]!);
 const [duplicateTitle,setDuplicateTitle]=useState(''),[duplicateSlug,setDuplicateSlug]=useState('');
 const [starts,setStarts]=useState(''),[ends,setEnds]=useState('');
 const [messageTone,setMessageTone]=useState<AdminTone>('info');
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<Preview|null>(null);
 const [people,setPeople]=useState<{id:string;masked_json:string;entry_id:string|null;vote_id:string|null}[]>([]),[revealed,setRevealed]=useState<Record<string,unknown>|null>(null),[logs,setLogs]=useState<{action:string;created_at:number}[]>([]),[deleteId,setDeleteId]=useState('');
 const [scope,setScope]=useState<Scope|null>(null),[token,setToken]=useState(''),[confirmation,setConfirmation]=useState('');
 const [readiness,setReadiness]=useState<Preview|null>(null);
 const [selectedResult,setSelectedResult]=useState(''),[savedResult,setSavedResult]=useState<Preview['result']>(null),[resultConfirm,setResultConfirm]=useState(false);
 const base='events/'+event.id;
 const localDate=(time:number|null)=>time===null?'':new Date(time-new Date(time).getTimezoneOffset()*60000).toISOString().slice(0,16);
 useEffect(()=>{if(section!=='overview')return;let active=true;setReadiness(null);api<Preview>(base+'/transition-preview?stage='+stage).then(value=>{if(active){setReadiness(value);setStarts(localDate(value.stage.starts_at));setEnds(localDate(value.stage.ends_at));}}).catch(()=>{if(active)setReadiness(null);});return()=>{active=false;};},[event.id,section,stage,row?.revision,row?.activity_revision]);
 async function refresh(){const next=await api<Row>(base);setRow(next);onChanged(next);if(!row){const order=stagesFor(event),index=order.indexOf(next.current_stage_id as Stage);setStage(order[index+1]??order[index]??order[0]!);}
  if(section==='voting'||section==='result'){const shortlist=await api<Candidate[]>(base+'/candidates?stage=voting');setCandidates(section==='voting'?[...shortlist].sort((a,b)=>a.position-b.position):shortlist);if(section==='result'&&stagesFor(event).includes('result')){const resultPreview=await api<Preview>(base+'/transition-preview?stage=result');setSavedResult(resultPreview.result);setSelectedResult(current=>shortlist.some(c=>c.id===current&&c.confirmed)?current:resultPreview.result?.id??'');}}
 }
 useEffect(()=>{setMessage('');refresh().catch(e=>setMessage(e.message));},[event.id,section]);
 async function moveCandidate(index:number,offset:number){const previous=candidates,next=[...candidates];[next[index],next[index+offset]]=[next[index+offset]!,next[index]!];setCandidates(next);setBusy(true);try{const updated=await api<Row>(base+'/reorder-candidates','POST',{stage:'voting',ids:next.map(c=>c.id),activityRevision:row!.activity_revision});setRow(updated);onChanged(updated);}catch(error){setCandidates(previous);setMessageTone('error');setMessage(error instanceof Error?error.message:'순서를 저장하지 못했습니다.');}finally{setBusy(false);}}
 async function run(action:()=>Promise<unknown>,success='저장했습니다.') {setBusy(true);try{await action();if(section!=='privacy'&&section!=='audit')await refresh();setMessageTone(success.includes('확인해주세요')?'info':'success');setMessage(success);}catch(e){setMessageTone('error');setMessage(e instanceof Error?e.message:'처리하지 못했습니다.');}finally{setBusy(false);}}
 if(!row)return <p>{message||'운영 현황을 불러오고 있습니다.'}</p>;
 return <section className="operations-panel">
  <h1>{event.title} 운영</h1>
  {message && <AdminNotice tone={messageTone}>{message}</AdminNotice>}
  <section hidden={section!=='overview'}><h2>공개·단계</h2><p className="operation-address"><a href={'https://events.seoularena.net/'+event.slug} target="_blank" rel="noreferrer">https://events.seoularena.net/{event.slug}</a></p>
   <div className="current-stage-card"><div><span>현재 단계</span><h3>{stageNames[row.current_stage_id as Stage]??row.current_stage_id}</h3><p>{row.visibility==='published'?'공개':row.visibility==='archived'?'보관':'작성 중'} · {row.accepting===1?'참여 가능':'참여 중지'}</p></div>
   {row.accepting===1&&<Button className="danger-button" disabled={busy} onClick={()=>run(async()=>{await api(base+'/transition','POST',{stage:row.current_stage_id,revision:row.revision,activityRevision:row.activity_revision,accepting:false});},'접수·투표를 중지했습니다.')}>접수·투표 중지</Button>}</div>
   <div className="next-stage-card"><h3>다음 단계</h3><label>전환할 단계<select aria-label="전환할 단계" value={stage} onChange={e=>setStage(e.target.value as Stage)}>{stagesFor(event).map(s=><option key={s} value={s}>{stageNames[s]}</option>)}</select></label>
   <Button disabled={busy||!readiness?.canTransition} onClick={()=>setPreview(readiness)}>단계 전환</Button>
   <ul className="transition-checks">{readiness?.checks?.map(check=><li key={check.id} className={check.complete?'is-complete':'is-incomplete'}><span>{check.label}</span><strong>{check.complete?'완료':'확인 필요'}</strong></li>)}</ul>
   {!readiness&&<p>전환 조건을 확인하고 있습니다.</p>}{readiness?.blockers.map(reason=><p key={reason} className="transition-help">{reason.replace('저장해주세요.','콘텐츠 편집에서 작성 후 공개해주세요.')}</p>)}
   <div className="stage-schedule"><h4>{stageNames[stage]} 일정</h4><label>시작<input type="datetime-local" value={starts} onChange={e=>setStarts(e.target.value)}/></label><label>종료<input type="datetime-local" value={ends} onChange={e=>setEnds(e.target.value)}/></label><Button disabled={busy||!readiness} onClick={()=>run(()=>api(base+'/schedule','POST',{stage,startsAt:starts?new Date(starts).getTime():null,endsAt:ends?new Date(ends).getTime():null,revision:row.revision}))}>일정 저장</Button></div>
   </div>
  </section>
  {section==='review'&&<EntryReview key={event.id} base={base} revision={row.activity_revision} onChanged={async()=>{}}/>}
  <section hidden={section!=='voting'}><h2>후보·투표</h2>
   {!candidates.length?<AdminNotice tone="info">응모작 심사에서 상태를 ‘후보’로 변경하면 여기에 표시됩니다.</AdminNotice>:<>
    <p>후보 {candidates.length}개 · 총 {candidates.reduce((sum,c)=>sum+c.votes,0)}표</p>
    <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th scope="col">순서</th><th scope="col">문구</th><th scope="col">득표수</th><th scope="col">상태</th><th scope="col">순서 변경</th></tr></thead><tbody>{candidates.map((candidate,index)=><tr key={candidate.id}><td>{index+1}</td><td className="entry-message">{candidate.message}</td><td>{candidate.votes}표</td><td><span className={`admin-status-badge admin-tone-${candidate.confirmed?'success':'warning'}`}>{candidate.confirmed?'확정':'미확정'}</span></td><td><Button aria-label={`${candidate.message} 위로`} disabled={busy||!!candidate.confirmed||index===0} onClick={()=>moveCandidate(index,-1)}>위로</Button><Button aria-label={`${candidate.message} 아래로`} disabled={busy||!!candidate.confirmed||index===candidates.length-1} onClick={()=>moveCandidate(index,1)}>아래로</Button></td></tr>)}</tbody></table></div>
   </>}
   <Button disabled={busy||!candidates.length||candidates.every(c=>c.confirmed)} onClick={()=>run(()=>api(base+'/confirm-candidates','POST',{stage:'voting',activityRevision:row.activity_revision}),'후보를 확정했습니다.')}>{candidates.length>0&&candidates.every(c=>c.confirmed)?'후보 확정 완료':'후보 확정'}</Button>
  </section>

  <section hidden={section!=='result'}><h2>결과 선정</h2>
   {savedResult&&<AdminNotice tone="success">선정된 문구: {savedResult.message}</AdminNotice>}
   {!candidates.length?<AdminNotice tone="info">후보·투표에서 후보를 등록하고 확정해주세요.</AdminNotice>:<>
    <p>총 {candidates.reduce((sum,c)=>sum+c.votes,0)}표 · 득표순</p>
    <fieldset className="result-options"><legend>결과로 선정할 후보</legend>
     {candidates.map((candidate,index)=><label key={candidate.id} className={`result-option${selectedResult===candidate.id?' is-selected':''}${!candidate.confirmed?' is-disabled':''}`}>
      <input type="radio" name="result-candidate" value={candidate.id} checked={selectedResult===candidate.id} disabled={busy||!candidate.confirmed} onChange={()=>setSelectedResult(candidate.id)}/>
      <span className="result-option-copy"><strong>{candidate.message}</strong><span>{index+1}번째 · {candidate.votes}표{!candidate.confirmed?' · 후보 미확정':''}{savedResult?.id===candidate.id?' · 선정됨':''}</span></span>
     </label>)}
    </fieldset>
    {candidates.some(c=>!c.confirmed)&&<AdminNotice tone="warning">확정된 후보만 결과로 선정할 수 있습니다.</AdminNotice>}
    <Button disabled={busy||!candidates.some(c=>c.id===selectedResult&&c.confirmed)||selectedResult===savedResult?.id} onClick={()=>setResultConfirm(true)}>결과 선정</Button>
    <p>선정한 결과는 공개·일정에서 결과 단계로 전환하면 공개됩니다. 이미 결과 단계라면 저장 즉시 반영됩니다.</p>
   </>}
  </section>
  <Modal open={resultConfirm} onOpenChange={setResultConfirm} title="결과 선정 확인" description="선택한 후보를 최종 문구로 저장합니다.">
   <p>{candidates.find(c=>c.id===selectedResult)?.message}</p>
   <p>{candidates.find(c=>c.id===selectedResult)?.votes??0}표</p>
   <Button disabled={busy||!candidates.some(c=>c.id===selectedResult&&c.confirmed)} onClick={()=>run(async()=>{await api(base+'/result','POST',{revision:row.revision,stage:'result',votingStage:'voting',candidateId:selectedResult});setResultConfirm(false);},'결과 문구를 선정했습니다.')}>확인 후 선정</Button>
  </Modal>

  <section hidden={section!=='settings'}><h2>이벤트 복제·보관</h2><label>새 이벤트 이름<input value={duplicateTitle} onChange={e=>setDuplicateTitle(e.target.value)}/></label><label>새 이벤트 주소<input value={duplicateSlug} onChange={e=>setDuplicateSlug(e.target.value)}/></label><Button disabled={busy||!duplicateTitle||!duplicateSlug} onClick={()=>run(()=>api(base+'/duplicate','POST',{title:duplicateTitle,slug:duplicateSlug}),'이벤트를 복제했습니다. 이벤트 목록을 다시 불러오면 확인할 수 있습니다.')}>이벤트 복제</Button><Button disabled={busy} onClick={()=>run(()=>api(base+'/archive','POST',{revision:row.revision}),'이벤트를 보관했습니다. 공개 페이지는 숨겨집니다.')}>보관</Button></section>
  {section==='privacy'&&<ParticipantTable base={base} onReveal={person=>run(async()=>setRevealed(await api(base+'/reveal','POST',{participantId:person})),'원문 열람을 운영 기록에 남겼습니다.')} onDelete={setDeleteId} busy={busy} refreshKey={deleteId}/>}
  <section hidden={section!=='audit'}><h2>운영 기록</h2><Button onClick={()=>run(async()=>setLogs(await api(base+'/audit')),'운영 기록을 불러왔습니다.')}>기록 불러오기</Button>{logs.map((log,i)=><p key={i}>{new Date(log.created_at).toLocaleString('ko-KR')} · {({'event.created':'이벤트 생성','event.draft_saved':'페이지 저장','event.published':'페이지 공개','entry.received':'공모 접수','entry.reviewed':'응모작 심사','vote.received':'투표 접수','candidates.confirmed':'후보 확정','candidates.reordered':'후보 순서 변경','result.selected':'결과 선정','stage.changed':'단계 전환','policy.version_created':'동의문 수정','privacy.reveal_requested':'원문 열람 요청','privacy.revealed':'원문 열람','privacy.deleted':'개인정보 삭제','event.test_data_reset':'테스트 데이터 초기화'} as Record<string,string>)[log.action]??'운영 작업'}</p>)}</section>
  <Modal open={!!revealed} onOpenChange={open=>{if(!open)setRevealed(null);}} title="개인정보 원문" className="private-details-dialog" description="열람 기록이 남습니다. 필요한 내용만 확인해주세요.">{revealed&&<PrivateDetails value={revealed} event={event}/>}</Modal>
  <Modal open={!!deleteId} onOpenChange={open=>{if(!open)setDeleteId('');}} title="개인정보 삭제 확인" description="개인정보와 연결된 동의 이력·중복 대조 정보가 삭제됩니다. 응모 문구와 투표수는 보존되며 해당 정보의 재참여 제한이 약해질 수 있습니다."><Button disabled={busy} onClick={()=>run(async()=>{await api(base+'/delete-private','POST',{participantId:deleteId});setPeople(people.filter(p=>p.id!==deleteId));setDeleteId('');},'개인정보를 삭제했습니다.')}>확인 후 삭제</Button></Modal>
  <section hidden={section!=='settings'}><h2>테스트 데이터 초기화 후 공모 시작</h2><Button disabled={busy} onClick={()=>run(async()=>{setScope(await api<Scope>(base+'/reset-scope'));setToken('');setConfirmation('');},'삭제 범위를 확인해주세요.')}>삭제 범위 확인</Button></section>
  <Modal open={!!preview} onOpenChange={open=>{if(!open)setPreview(null);}} title="단계 전환 확인" description={`${stageNames[stage]} 화면을 공개합니다.`}>
   {preview?.blockers.map(reason=><AdminNotice tone="warning" key={reason}>{reason}</AdminNotice>)}{preview?.candidates.map(c=><p key={c.id}>{c.message}</p>)}{preview?.result&&<p>{preview.result.message}</p>}
   <Button disabled={busy||!preview?.canTransition} onClick={()=>run(async()=>{await api(base+'/transition','POST',{stage,revision:preview!.revision,activityRevision:preview!.activityRevision,accepting:stage!=='result'});setPreview(null);},'단계를 전환했습니다.')}>확인 후 전환</Button>
  </Modal>
  <Modal open={!!scope} onOpenChange={open=>{if(!open){setScope(null);setToken('');}}} title={token?'최종 삭제 확인':'삭제 범위 확인'} description="이 이벤트의 응모작·개인정보·동의 이력·후보·투표·결과·중복 제한이 삭제됩니다. 문구·동의문 원문·관리자·운영 기록은 보존됩니다.">
   <p>응모작 {scope?.counts.event_entries??0}건 · 투표 {scope?.counts.event_votes??0}건 · 개인정보 {scope?.counts.event_participants??0}건</p>
   {!token?<Button disabled={busy} onClick={()=>run(async()=>{const prepared=await api<{token:string}>(base+'/reset-prepare','POST',{revision:scope!.revision,activityRevision:scope!.activityRevision});setToken(prepared.token);},'이벤트 주소를 입력하고 최종 확인해주세요.')}>범위 확인, 다음</Button>:<><label>이벤트 주소 ({event.slug})<input value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><Button disabled={busy||confirmation!==event.slug} onClick={()=>run(async()=>{await api(base+'/reset','POST',{token,confirmation});setScope(null);setToken('');},'테스트 데이터를 초기화했습니다.')}>최종 확인, 삭제 후 공모 시작</Button></>}
  </Modal>
  {section==='settings'&&onDeleted&&<EventDeletion key={event.id} eventId={event.id} onDeleted={onDeleted}/>}
 </section>;
}
