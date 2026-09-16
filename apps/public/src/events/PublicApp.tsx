import {hasCompletedVote,rememberCompletedVote,voteCompletionKey} from './vote-completion';
import {duplicateVoteMessage} from './useVoteCheck';
import {useEffect,useState,useRef,useCallback} from 'react';
import {EventPage,type LiveEvent} from './EventPage';
import type {EventDraft,Stage} from '../../../../packages/event-builder/src/model';
import {getTurnstileToken} from '../turnstile';
interface View {event:EventDraft;stage:{id:string;kind:Stage;round:number;allow_repeat:number;accepting:number;starts_at:number|null;ends_at:number|null};policies:LiveEvent['policies'];candidates:LiveEvent['candidates'];result:LiveEvent['result'];revision:number;local:boolean;turnstileSiteKey:string}
export default function PublicApp(){
 const [view,setView]=useState<View|null>(null),[error,setError]=useState('');
 const dirty=useRef(false),viewRef=useRef<View|null>(null);
 const slug=location.pathname.slice(1);

 useEffect(()=>{let active=true;
  async function refresh(){
   if(document.visibilityState==='hidden')return;
   try{const response=await fetch('/api/events/'+encodeURIComponent(slug));if(!response.ok){if(!viewRef.current)throw new Error('공개된 이벤트를 찾을 수 없습니다.');if(active)setView(current=>current?{...current,stage:{...current.stage,accepting:0}}:null);return;}
    const next=await response.json() as View;if(!active)return;
    if(dirty.current&&viewRef.current?.stage.id!==next.stage.id){setView(current=>current?{...current,stage:{...current.stage,accepting:0}}:null);return;}
    viewRef.current=next;setView(next);
   }catch(e){if(active&&!viewRef.current)setError(e instanceof Error?e.message:'이벤트를 불러오지 못했습니다.');}
  }
  refresh();const timer=setInterval(refresh,20000);return()=>{active=false;clearInterval(timer);};
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
 const now=Date.now(),accepting=!!view.stage.accepting&&(!view.stage.starts_at||now>=view.stage.starts_at)&&(!view.stage.ends_at||now<view.stage.ends_at);
 return <>{view.local&&<div className="review-note">로컬 개발 화면 · 테스트용 정보만 입력해주세요.</div>}<EventPage key={completionKey} event={view.event} stage={view.stage.kind} live={{...view,accepting,completedVote:view.stage.kind==='voting'&&!view.stage.allow_repeat&&(completion===completionKey||hasCompletedVote(completionKey)),checkVote:view.stage.kind==='voting'&&!view.stage.allow_repeat?checkVote:undefined,onDirty:()=>{dirty.current=true;},
  async submit(fields,requestKey){
   const turnstileToken=await getTurnstileToken(view.local?'mock':view.turnstileSiteKey,view.stage.kind==='voting'?'vote':'submission');
   const response=await fetch('/api/events/'+encodeURIComponent(slug)+'/participate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:view.revision,requestKey,turnstileToken,extra:Object.fromEntries([...fields.entries()].filter(([key])=>key.startsWith("extra:")).map(([key,value])=>[key.slice(6),value])),message:fields.get('message')??'',candidateId:fields.get('candidate')??'',participant:{name:fields.get('name')??'',phone:fields.get('phone')??'',email:fields.get('email')??'',instagram:fields.get('instagram')??''},policyIds:fields.getAll('policy')})});
   if(!response.ok){const value=await response.json();throw new Error(value.code==='DUPLICATE_VOTE'?duplicateVoteMessage:value.error??'참여를 완료하지 못했습니다.');}
   dirty.current=false;
   if(view.stage.kind==='voting'){rememberCompletedVote(completionKey);setCompletion(completionKey);}
  }
 }}/></>;
}
