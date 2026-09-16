import {useEffect,useRef} from 'react';
import './events.css';

export function CompletionPage({title,kind,onReturn}:{title:string;kind:'submission'|'voting';onReturn?:()=>void}) {
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{window.scrollTo(0,0);heading.current?.focus({preventScroll:true});},[kind]);
 const voting=kind==='voting';
 return <main className="event-page event-theme-dark completion-page">
  <header className="public-header"><span className="wordmark">SEOUL ARENA</span><h1 className="event-title-display">{title}</h1></header>
  <section className="completion-content" aria-labelledby="completion-title">
   <h2 id="completion-title" tabIndex={-1} ref={heading}>{voting?'투표가 완료되었습니다.':'접수가 완료되었습니다.'}</h2>
   <p>{voting?'투표해 주셔서 감사합니다.':'참여해 주셔서 감사합니다.'}</p>
   {!voting&&onReturn&&<button className="completion-return" type="button" onClick={onReturn}>돌아가기</button>}
  </section>
 </main>;
}
