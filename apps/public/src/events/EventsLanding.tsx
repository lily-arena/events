import {useEffect,useState} from 'react';
import './events.css';
type Item={title:string;href:string;active:boolean};
export default function EventsLanding(){
 const [events,setEvents]=useState<Item[]|null>(null),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError(false);const timer=setTimeout(()=>controller.abort(),10000);fetch('/api/events/catalog/list',{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error();const rows=await response.json();if(!Array.isArray(rows))throw new Error();setEvents(rows);}).catch(()=>{if(!cancelled)setError(true);}).finally(()=>clearTimeout(timer));let cancelled=false;return()=>{cancelled=true;clearTimeout(timer);controller.abort();};},[attempt]);
 const active=events?.filter(e=>e.active)??[],past=events?.filter(e=>!e.active)??[];
 const links=(items:Item[])=><div className="submission-action home-event-links">{items.map(event=><a key={event.href} className="button primary" href={event.href}>{event.title}</a>)}</div>;
 return <main className="event-page event-theme-dark completion-page events-landing">
  <header className="public-header"><span className="wordmark">SEOUL ARENA</span><h1 className="event-title-display">EVENTS</h1></header>
  <div className="completion-content">
   {error?<div role="alert"><p>이벤트 목록을 불러오지 못했습니다.</p><button className="completion-return" onClick={()=>setAttempt(n=>n+1)}>다시 시도</button></div>:events===null?<p role="status">이벤트를 불러오고 있습니다.</p>:<>
    <section aria-label="진행 중인 이벤트"><p>{active.length?'현재 진행 중인 이벤트 바로가기':'현재 진행중인 이벤트가 없습니다.'}</p>{active.length>0&&links(active)}</section>
    {past.length>0&&<section className="past-events" aria-labelledby="past-heading"><h4 id="past-heading">지난 이벤트</h4>{links(past)}</section>}
   </>}
  </div>
 </main>;
}
