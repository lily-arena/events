import { firstSeat } from "../../../../packages/event-builder/src/model";
import { EventPage } from "./EventPage";
import "./events.css";
export default function PublicPreview() {
  const stage = new URLSearchParams(location.search).get("stage");
  if (location.pathname !== "/first-seat") return null;
  return (
    <>
      <div className="review-note">
        화면 검토용 · 입력 내용은 접수되지 않습니다.
      </div>
      <EventPage
        event={firstSeat}
        stage={stage === "voting" || stage === "result" ? stage : "submission"}
      />
    </>
  );
}
