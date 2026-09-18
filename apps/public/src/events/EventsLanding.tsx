import './events.css';

// Remove an event from this list when its campaign has finished.
const activeEvents = [{title:'FIRST SEAT',href:'/first-seat'}];
export default function EventsLanding(){
 return <main className="event-page event-theme-dark completion-page">
  <header className="public-header"><span className="wordmark">SEOUL ARENA</span><h1 className="event-title-display">EVENTS</h1></header>
  <section className="completion-content" aria-label="진행 중인 이벤트">
   <p>{activeEvents.length?'현재 진행 중인 이벤트 바로가기':'현재 진행 중인 이벤트가 없습니다.'}</p>
   <div className="submission-action">{activeEvents.map(event=><a key={event.href} className="button primary" href={event.href}>{event.title}</a>)}</div>
  </section>
 </main>;
}
