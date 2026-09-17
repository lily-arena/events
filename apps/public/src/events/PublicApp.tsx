import {readBootstrap,nextRefreshDelay,type PublicState} from './public-refresh';
import {hasCompletedVote,rememberCompletedVote,voteCompletionKey} from './vote-completion';
import {duplicateVoteMessage} from './useVoteCheck';
import {useEffect,useState,useRef,useCallback} from 'react';
import {EventPage,type LiveEvent} from './EventPage';
import type {EventDraft,Stage} from '../../../../packages/event-builder/src/model';
import {getTurnstileToken} from '../turnstile';
interface View {event:EventDraft;stage:{id:string;kind:Stage;round:number;allow_repeat:number;accepting:number;starts_at:number|null;ends_at:number|null};policies:LiveEvent['policies'];candidates:LiveEvent['candidates'];result:LiveEvent['result'];revision:number;local:boolean;turnstileSiteKey:string}
export default function PublicApp(){
 const slug=location.pathname.slice(1);
 const [view,setView]=useState<View|null>(()=>readBootstrap<View>(slug)),[error,setError]=useState('');
 const dirty=useRef(false),viewRef=useRef<View|null>(view),tracked=useRef(false),visitId=useRef(crypto.randomUUID());
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const times=[view?.stage.starts_at,view?.stage.ends_at].filter((t):t is number=>typeof t==='number'&&t>Date.now());if(!times.length)return;const timer=setTimeout(()=>setClock(Date.now()),Math.min(2147483647,Math.min(...times)-Date.now()+10));return()=>clearTimeout(timer);},[view,clock]);
 useEffect(()=>{if(!view||tracked.current)return;
  const record=()=>{if(document.visibilityState==='hidden'||tracked.current)return;tracked.current=true;
   const send=async()=>{for(let attempt=0;attempt<3;attempt++){try{const r=await fetch('/api/events/'+encodeURIComponent(slug)+'/page-view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitId:visitId.current}),keepalive:true});if(r.ok||r.status<500)return;}catch{}await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}};void send();};
  record();document.addEventListener('visibilitychange',record);return()=>document.removeEventListener('visibilitychange',record);
 },[!!view,slug]);
 useEffect(()=>{let active=true,inFlight=false,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
  const pause=()=>{if(active)setView(current=>current?{...current,stage:{...current.stage,accepting:0}}:null);};
  async function refresh(){
   if(!active||inFlight||document.visibilityState==='hidden')return;
   inFlight=true;
   try{
    let revision:number|undefined;
    if(viewRef.current){
     const response=await fetch('/api/events/'+encodeURIComponent(slug)+'/state',{signal:controller.signal});
     if(!response.ok){pause();return;}
     const state=await response.json() as PublicState;if(!active)return;
     if(dirty.current&&(state.id!==viewRef.current.stage.id||state.round!==viewRef.current.stage.round)){pause();return;}
     if(state.revision===viewRef.current.revision){const next={...viewRef.current,stage:{...viewRef.current.stage,accepting:state.accepting,starts_at:state.starts_at,ends_at:state.ends_at}};viewRef.current=next;setView(next);setClock(Date.now());return;}
     revision=state.revision;
    }
    const response=await fetch('/api/events/'+encodeURIComponent(slug)+(revision===undefined?'':'?revision='+revision),{signal:controller.signal});
    if(!response.ok){if(!viewRef.current)throw new Error('공개된 이벤트를 찾을 수 없습니다.');pause();return;}
    const next=await response.json() as View;if(!active)return;
    if(dirty.current&&(viewRef.current?.stage.id!==next.stage.id||viewRef.current?.stage.round!==next.stage.round)){pause();return;}
    viewRef.current=next;setView(next);setClock(Date.now());
   }catch(e){if(active){pause();if(!viewRef.current)setError(e instanceof Error?e.message:'이벤트를 불러오지 못했습니다.');}}
   finally{inFlight=false;}
  }
  const schedule=()=>{clearTimeout(timer);if(!active||document.visibilityState==='hidden')return;timer=setTimeout(async()=>{await refresh();schedule();},nextRefreshDelay());};
  const resume=()=>{clearTimeout(timer);if(document.visibilityState==='visible')void refresh().then(schedule);};
  void refresh().then(schedule);document.addEventListener('visibilitychange',resume);window.addEventListener('pageshow',resume);
  return()=>{active=false;clearTimeout(timer);controller.abort();document.removeEventListener('visibilitychange',resume);window.removeEventListener('pageshow',resume);};
 },[slug]);

 const completionKey=view?voteCompletionKey(view.event.id,view.stage.id,view.stage.round):'';
 const [completion,setCompletion]=useState('');
 useEffect(()=>{const sync=()=>setCompletion(hasCompletedVote(completionKey)?completionKey:'');sync();window.addEventListener('storage',sync);window.addEventListener('pageshow',sync);return()=>{window.removeEventListener('storage',sync);window.removeEventListener('pageshow',sync);};},[completionKey]);
 const siteKey=view?.local?'mock':view?.turnstileSiteKey??'';
 const checkVote=useCallback(async(participant:Record<string,string>)=>{
  const turnstileToken=await getTurnstileToken(siteKey,'voter_session');
  const response=await fetch('/api/events/'+encodeURIComponent(slug)+'/vote-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participant,turnstileToken})});
  if(!response.ok)throw new Error('중복 투표 여부를 확인하지 못했습니다.');
  const result=await response.json();if(typeof result.duplicate!=='boolean')throw new Error('Invalid response');return result.duplicate;
 },[slug,siteKey]);
 if(error)return <p className="empty-state">{error}</p>;
 if(!view)return <p className="empty-state">이벤트를 불러오고 있습니다.</p>;
 const now=clock,accepting=!!view.stage.accepting&&(!view.stage.starts_at||now>=view.stage.starts_at)&&(!view.stage.ends_at||now<view.stage.ends_at);
 return <>{view.local&&<div className="review-note">로컬 개발 화면 · 테스트용 정보만 입력해주세요.</div>}<EventPage key={completionKey} event={view.event} stage={view.stage.kind} live={{...view,accepting,completedVote:view.stage.kind==='voting'&&!view.stage.allow_repeat&&(completion===completionKey||hasCompletedVote(completionKey)),checkVote:view.stage.kind==='voting'&&!view.stage.allow_repeat?checkVote:undefined,onDirty:()=>{dirty.current=true;},
  async submit(fields,requestKey){
   const turnstileToken=await getTurnstileToken(view.local?'mock':view.turnstileSiteKey,view.stage.kind==='voting'?'vote':'submission');
   const response=await fetch('/api/events/'+encodeURIComponent(slug)+'/participate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:view.revision,requestKey,turnstileToken,extra:Object.fromEntries([...fields.entries()].filter(([key])=>key.startsWith("extra:")).map(([key,value])=>[key.slice(6),value])),message:fields.get('message')??'',candidateId:fields.get('candidate')??'',participant:{birthDate:fields.get('birthDate')??'',name:fields.get('name')??'',phone:fields.get('phone')??'',email:fields.get('email')??'',instagram:fields.get('instagram')??''},policyIds:fields.getAll('policy')})});
   if(!response.ok){const value=await response.json();throw new Error(value.code==='DUPLICATE_VOTE'?duplicateVoteMessage:value.error??'참여를 완료하지 못했습니다.');}
   dirty.current=false;
   if(view.stage.kind==='voting'){rememberCompletedVote(completionKey);setCompletion(completionKey);}
  }
 }}/></>;
}
