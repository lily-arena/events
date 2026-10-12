import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import '../../../packages/ui/src/tokens.css';
import '../../public/src/events/events.css';
import './preview.css';
function Preview(){
 const [active,setActive]=useState(false);
 const [admin,setAdmin]=useState(false);
 return <><nav className="preview-nav" aria-label="시안 화면 선택"><span>시안 · 운영에 저장되지 않습니다</span><button onClick={()=>setAdmin(!admin)}>{admin?'메인 화면 보기':'백오피스 설정 보기'}</button></nav>{admin?<main className="dashboard-preview"><h1>대시보드</h1><h2>이벤트 목록</h2><p>메인 페이지에서 진행 중인 이벤트와 지난 이벤트를 구분합니다.</p><article><div><h3>FIRST SEAT</h3><span>events.seoularena.net/first-seat</span></div><div><small>공개 상태</small><strong>공개</strong></div><div><small>메인 노출</small><strong>{active?'진행 중인 이벤트':'지난 이벤트'}</strong></div><button onClick={()=>setActive(!active)}>{active?'지난 이벤트로 이동':'진행중인 이벤트로 노출'}</button></article><p className="help">메인 노출 설정은 응모·투표 일정이나 이벤트 공개 상태를 변경하지 않습니다.</p></main>:<main className="event-page event-theme-dark completion-page home-preview"><header className="public-header"><span className="wordmark">SEOUL ARENA</span><h1 className="event-title-display">EVENTS</h1></header><div className="completion-content"><section aria-label="진행 중인 이벤트"><p>{active?'현재 진행 중인 이벤트 바로가기':'현재 진행중인 이벤트가 없습니다.'}</p>{active&&<div className="submission-action"><a className="button primary" href="/first-seat">FIRST SEAT</a></div>}</section>{!active&&<section className="past-events" aria-labelledby="past-heading"><h4 id="past-heading">지난 이벤트</h4><div className="submission-action"><a className="button primary" href="/first-seat">FIRST SEAT</a></div></section>}</div></main>}</>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
