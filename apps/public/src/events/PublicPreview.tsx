import {CompletionPage} from './CompletionPage';
import { firstSeat } from "../../../../packages/event-builder/src/model";
import { EventPage } from "./EventPage";
import "./events.css";
export default function PublicPreview() {
  const stage = new URLSearchParams(location.search).get("stage");
  if (location.pathname !== "/first-seat") return null;
  const complete = new URLSearchParams(location.search).get("complete");
  if(complete==="submission"||complete==="voting")return <CompletionPage title={firstSeat.title} kind={complete} onReturn={()=>{location.href="/first-seat?design";}}/>;
  const headerPreview = new URLSearchParams(location.search).has("header");
  const event = structuredClone(firstSeat);
  if(headerPreview) event.pages.submission.unshift({id:"header-preview",type:"header-image",title:"",body:"",headerHeight:80,imageUrl:"/header-sample.png",imageAlt:"헤더 스크롤 검토용 샘플 이미지"});
  return (
    <>
      <div className="review-note">
        {headerPreview?"이미지 구간에서는 제목 고정 · 콘텐츠에 도달하면 함께 스크롤":"화면 검토용 · 입력 내용은 접수되지 않습니다."}
      </div>
      <EventPage
        event={event}
        stage={stage === "voting" || stage === "result" ? stage : "submission"}
      />
    </>
  );
}
