import {AdminNotice,ReviewStatus,type AdminTone} from '../../../../packages/ui/src/AdminStatus';
import {PublishSetup} from './PublishSetup';
import {useEffect,useState} from 'react';
import {Button,Modal} from '../../../../packages/ui/src';
import {stageNames,stagesFor,type EventDraft,type Stage} from '../../../../packages/event-builder/src/model';
import {adminRequest as api} from './operations-api';
interface Row {id:string;revision:number;activity_revision:number;current_stage_id:string;visibility:string;draft_json:string;accepting:number}
interface Entry {id:string;message:string;status:string;revision:number;masked_json:string|null}
interface Candidate {id:string;message:string;votes:number;confirmed:number}
interface Preview {canTransition:boolean;blockers:string[];revision:number;activityRevision:number;candidates:Candidate[];result:{id:string;message:string}|null}
interface Scope {revision:number;activityRevision:number;counts:Record<string,number>}
export function EventOperations({event,onChanged,section='overview'}:{section?:string;event:EventDraft;onChanged:(row:Row)=>void}) {
 const [row,setRow]=useState<Row|null>(null),[entries,setEntries]=useState<Entry[]>([]),[candidates,setCandidates]=useState<Candidate[]>([]);
 const [stage,setStage]=useState<Stage>(stagesFor(event)[0]!),[policyKind,setPolicyKind]=useState('privacy'),[policyBody,setPolicyBody]=useState('');
 const [duplicateTitle,setDuplicateTitle]=useState(''),[duplicateSlug,setDuplicateSlug]=useState('');
 const [candidateText,setCandidateText]=useState(''),[starts,setStarts]=useState(''),[ends,setEnds]=useState('');
 const [messageTone,setMessageTone]=useState<AdminTone>('info');
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<Preview|null>(null);
 const [people,setPeople]=useState<{id:string;masked_json:string;entry_id:string|null;vote_id:string|null}[]>([]),[revealed,setRevealed]=useState<Record<string,string>|null>(null),[logs,setLogs]=useState<{action:string;created_at:number}[]>([]),[deleteId,setDeleteId]=useState('');
 const [scope,setScope]=useState<Scope|null>(null),[token,setToken]=useState(''),[confirmation,setConfirmation]=useState('');
 const [readiness,setReadiness]=useState<Preview|null>(null);
 const [selectedResult,setSelectedResult]=useState(''),[savedResult,setSavedResult]=useState<Preview['result']>(null),[resultConfirm,setResultConfirm]=useState(false);
 const base='events/'+event.id;
 useEffect(()=>{let active=true;setReadiness(null);api<Preview>(base+'/transition-preview?stage='+stage).then(value=>{if(active)setReadiness(value);}).catch(()=>{if(active)setReadiness(null);});return()=>{active=false;};},[event.id,stage,row?.revision,row?.activity_revision,busy]);
 async function refresh(){const [next,list,shortlist]=await Promise.all([api<Row>(base),api<Entry[]>(base+'/entries'),api<Candidate[]>(base+'/candidates?stage=voting')]);setRow(next);setEntries(list);setCandidates(shortlist);onChanged(next);if(stagesFor(event).includes('result')){const resultPreview=await api<Preview>(base+'/transition-preview?stage=result');setSavedResult(resultPreview.result);setSelectedResult(current=>shortlist.some(c=>c.id===current&&c.confirmed)?current:resultPreview.result?.id??'');}}
 useEffect(()=>{refresh().catch(e=>setMessage(e.message));},[event.id]);
 async function run(action:()=>Promise<unknown>,success='저장했습니다.') {setBusy(true);try{await action();await refresh();setMessageTone(success.includes('확인해주세요')?'info':'success');setMessage(success);}catch(e){setMessageTone('error');setMessage(e instanceof Error?e.message:'처리하지 못했습니다.');}finally{setBusy(false);}}
 if(!row)return <p>{message||'운영 현황을 불러오고 있습니다.'}</p>;
 return <section className="operations-panel">
  <h1>{event.title} 운영</h1>
  {message && <AdminNotice tone={messageTone}>{message}</AdminNotice>}
  <section hidden={section!=='overview'}><h2>공개·단계</h2><p>현재 단계: {stageNames[row.current_stage_id as Stage]??row.current_stage_id} · {row.visibility==='published'?'공개':row.visibility==='archived'?'보관':'작성 중'}</p>
   {row.accepting===1&&<Button disabled={busy} onClick={()=>run(async()=>{const current=await api<Preview>(base+'/transition-preview?stage='+row.current_stage_id);await api(base+'/transition','POST',{stage:row.current_stage_id,revision:current.revision,activityRevision:current.activityRevision,accepting:false});},'접수·투표를 중지했습니다.')}>접수·투표 중지</Button>}
   <PublishSetup row={row} onSaved={refresh}/>
   <label>전환할 단계<select value={stage} onChange={e=>setStage(e.target.value as Stage)}>{stagesFor(event).map(s=><option key={s} value={s}>{stageNames[s]}</option>)}</select></label>
   <Button disabled={busy||!readiness?.canTransition} onClick={()=>run(async()=>setPreview(await api<Preview>(base+'/transition-preview?stage='+stage)),'전환할 내용을 확인해주세요.')}>단계 전환</Button>{(readiness?.blockers.length? <AdminNotice tone="warning"><ul>{readiness.blockers.map(reason=><li key={reason}>{reason}</li>)}</ul></AdminNotice>:null)}{!readiness&&<p>전환 조건을 확인하고 있습니다.</p>}
  </section>
  <section hidden={section!=='overview'}><h2>일정</h2><p>{stageNames[stage]} 단계</p><label>시작<input type="datetime-local" value={starts} onChange={e=>setStarts(e.target.value)}/></label><label>종료<input type="datetime-local" value={ends} onChange={e=>setEnds(e.target.value)}/></label><Button disabled={busy} onClick={()=>run(()=>api(base+'/schedule','POST',{stage,startsAt:starts?new Date(starts).getTime():null,endsAt:ends?new Date(ends).getTime():null,revision:row.revision}))}>일정 저장</Button></section>
  <section hidden={section!=='review'}><h2>응모작 심사</h2>{!entries.length&&<p>접수된 응모작이 없습니다.</p>}
   {entries.map(entry=><article key={entry.id}><ReviewStatus status={entry.status}/><p>{entry.message}</p>{entry.masked_json&&<p>{Object.values(JSON.parse(entry.masked_json)).join(' · ')}</p>}
    <label>상태<select disabled={busy} value={entry.status} onChange={e=>run(()=>api(base+'/review','POST',{entryId:entry.id,status:e.target.value,revision:entry.revision}))}>{[['pending','검토 대기'],['approved','승인'],['rejected','반려'],['candidate','후보']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   </article>)}
  </section>
  <section hidden={section!=='voting'}><h2>후보·투표 현황</h2><label>후보 문구<input value={candidateText} onChange={e=>setCandidateText(e.target.value)}/></label><Button disabled={busy||!candidateText.trim()} onClick={()=>run(async()=>{await api(base+'/candidate','POST',{stage:'voting',message:candidateText,revision:row.revision});setCandidateText('');})}>후보 추가</Button>{!candidates.length&&<p>지정된 후보가 없습니다.</p>}
   {candidates.map((candidate,index)=><article key={candidate.id}><p>{index+1}. {candidate.message} · {candidate.votes}표</p></article>)}
   <Button disabled={busy||!candidates.length} onClick={()=>run(()=>api(base+'/confirm-candidates','POST',{stage:'voting',activityRevision:row.activity_revision}),'후보를 확정했습니다.')}>후보 확정</Button>
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
  <section hidden={section!=='privacy'}><h2>개인정보</h2><Button disabled={busy} onClick={()=>run(async()=>setPeople(await api(base+'/participants')),'개인정보 목록을 불러왔습니다.')}>목록 불러오기</Button>
   {people.map(person=><article key={person.id}><p>{person.vote_id?'투표':'공모'} · {Object.values(JSON.parse(person.masked_json)).join(' · ')}</p><Button disabled={busy} onClick={()=>run(async()=>setRevealed(await api(base+'/reveal','POST',{participantId:person.id})),'원문 열람을 운영 기록에 남겼습니다.')}>원문 보기</Button><Button onClick={()=>setDeleteId(person.id)}>개인정보 삭제</Button></article>)}
  </section>
  <section hidden={section!=='audit'}><h2>운영 기록</h2><Button onClick={()=>run(async()=>setLogs(await api(base+'/audit')),'운영 기록을 불러왔습니다.')}>기록 불러오기</Button>{logs.map((log,i)=><p key={i}>{new Date(log.created_at).toLocaleString('ko-KR')} · {({'event.created':'이벤트 생성','event.draft_saved':'페이지 저장','event.published':'페이지 공개','entry.received':'공모 접수','entry.reviewed':'응모작 심사','vote.received':'투표 접수','candidates.confirmed':'후보 확정','result.selected':'결과 선정','stage.changed':'단계 전환','policy.version_created':'동의문 수정','privacy.reveal_requested':'원문 열람 요청','privacy.revealed':'원문 열람','privacy.deleted':'개인정보 삭제','event.test_data_reset':'테스트 데이터 초기화'} as Record<string,string>)[log.action]??'운영 작업'}</p>)}</section>
  <Modal open={!!revealed} onOpenChange={open=>{if(!open)setRevealed(null);}} title="개인정보 원문" description="열람 기록이 남습니다. 필요한 내용만 확인해주세요."><dl>{revealed&&Object.entries(revealed).map(([key,value])=><div key={key}><dt>{({name:'이름',phone:'연락처',email:'이메일',instagram:'인스타그램'} as Record<string,string>)[key]}</dt><dd>{typeof value==='object'?JSON.stringify(value):value}</dd></div>)}</dl></Modal>
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
 </section>;
}
