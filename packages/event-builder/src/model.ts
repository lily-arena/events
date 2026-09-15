export type ModuleType =
  | "schedule"
  | "image"
  | "hero"
  | "intro"
  | "form"
  | "consent"
  | "notices"
  | "candidates"
  | "result"
  | "text";
export type Stage = "submission" | "voting" | "result";
export type TextSize = "h1" | "h2" | "h3" | "h4" | "body";
export type TextTone = "default" | "emphasis";
export interface InputField {id:string;label:string;type:"text"|"textarea"|"number"|"select";required:boolean;maxLength:number;options:string[]}
export interface ScheduleItem {id:string;title:string;start:string;end:string;description:string}
export interface PageModule {
  schedule?: ScheduleItem[];
  consents?: import("./consents").ConsentItem[];
  fields?: InputField[];
  imageAssetId?: string;
  imageUrl?: string;
  imageAlt?: string;
  titleSize?: TextSize;
  titleTone?: TextTone;
  bodyTone?: TextTone;
  id: string;
  type: ModuleType;
  title: string;
  body: string;
}
export interface EventDraft {
  id: string;
  slug: string;
  title: string;
  description: string;
  visibility: "draft" | "published" | "archived";
  template: "first-seat" | "submission" | "voting";
  updatedAt: string;
  pages: Record<Stage, PageModule[]>;
  privacyPolicy?: string;
  contactUrl?: string;
  retentionDays?: number;
  stageOrder?: Stage[];
  maxLength: number;
  allowRepeatVotes: boolean;
}
export const moduleNames: Record<ModuleType, string> = {
  schedule: "일정",
  image: "이미지",
  hero: "이벤트 소개",
  intro: "이벤트 안내",
  form: "입력창",
  consent: "개인정보 동의",
  notices: "유의사항",
  candidates: "후보·투표",
  result: "최종 결과",
  text: "본문",
};
export const stageNames: Record<Stage, string> = {
  submission: "공모",
  voting: "투표",
  result: "결과",
};
const block = (
  id: string,
  type: ModuleType,
  title: string,
  body = "",
): PageModule => ({ id, type, title, body });
export function createEvent(
  template: EventDraft["template"],
  title: string,
  slug: string,
  id: string = crypto.randomUUID(),
): EventDraft {
  return {
    id,
    slug,
    title,
    description: "서울아레나와 함께 만들어가는 새로운 순간.",
    visibility: "draft",
    template,
    updatedAt: "방금",
    maxLength: 30,
    allowRepeatVotes: false,
    pages: {
      submission: [
        block(
          "hero",
          "hero",
          title,
          "서울아레나의 첫 번째 순간, 당신의 한 문장으로 시작됩니다.",
        ),
        block(
          "intro",
          "intro",
          "당신이라면, 어떤 말을 남기고 싶나요?",
          "무대의 설렘부터 함께하는 마음까지.\n서울아레나에서 만나게 될 우리에게 한 문장을 보내주세요.",
        ),
        block(
          "form",
          "form",
          "당신의 한 문장",
          "마음을 담은 한 문장을 들려주세요.",
        ),
        block(
          "consent",
          "consent",
          "참여를 위해 확인해주세요.",
          "수집 항목: 이름, 연락처, 이메일\n수집 목적: 응모 접수 및 당선 안내\n검토용 예시이며 실제 공개 전 보유기간과 운영 주체를 확정합니다.",
        ),
        block(
          "notices",
          "notices",
          "참여 전 확인해주세요.",
          "직접 작성한 문구만 응모할 수 있습니다.\n타인의 권리를 침해하는 내용은 선정에서 제외될 수 있습니다.\n선정 일정과 안내는 이벤트 페이지에서 확인할 수 있습니다.",
        ),
      ],
      voting: [
        block(
          "hero",
          "hero",
          "마음을 움직이는\n한 문장을 골라주세요.",
          "서울아레나의 첫 번째 이야기를 함께 완성해주세요.",
        ),
        block(
          "candidates",
          "candidates",
          "당신의 선택은?",
          "가장 공감하는 문구 하나를 선택해주세요.",
        ),
        block(
          "form",
          "form",
          "투표 참여 정보",
          "연락처·이메일·인스타그램을 확인하여 중복 투표를 제한합니다.",
        ),
        block(
          "consent",
          "consent",
          "투표를 위해 확인해주세요.",
          "수집 항목: 연락처, 이메일, 인스타그램 계정\n수집 목적: 투표 운영 및 중복 참여 확인\n검토용 동의문입니다. 실제 공개 전 보유기간과 운영 주체를 확정합니다.",
        ),
      ],
      result: [
        block(
          "hero",
          "hero",
          "우리의 첫 문장이\n완성되었습니다.",
          "서울아레나의 시작을 함께해주셔서 감사합니다.",
        ),
        block(
          "result",
          "result",
          "함께 만든 첫 번째 이야기",
          "선정된 문구는 결과 공개 후 이곳에 표시됩니다.",
        ),
        block(
          "text",
          "text",
          "다음 순간에도, 함께해요.",
          "서울아레나의 새로운 소식을 기다려주세요.",
        ),
      ],
    },
  };
}
export const firstSeat = createEvent("first-seat", "FIRST SEAT", "first-seat", "first-seat-preview");
export const FIRST_SEAT_INTRO_TITLE =
  "서울아레나, 첫 좌석에 새길 한 문장을 보내주세요.";
export const FIRST_SEAT_INTRO_BODY =
  "18,269개의 좌석 중 가장 먼저 자리를 잡게 될 단 하나의 좌석, First Seat.\n무대도, 조명도 채워지지 않은 지금. 가장 먼저 완성되는 것은 관객의 자리입니다.\n서울아레나는 그 첫 좌석에 새길 문구를 대중과 함께 완성하려 합니다. 당신이 남긴 한 문장이, 서울아레나의 첫 기록이 됩니다.";
firstSeat.pages.submission = firstSeat.pages.submission
  .filter((m) => m.id !== "intro")
  .map((m) =>
    m.id === "hero"
      ? { ...m, title: FIRST_SEAT_INTRO_TITLE, body: FIRST_SEAT_INTRO_BODY }
      : m,
  );
firstSeat.pages.submission = firstSeat.pages.submission.map(m=>m.type==="form"?{...m,title:"",body:""}:m);
for(const stage of ["submission","voting","result"] as Stage[]) {
 firstSeat.pages[stage] = firstSeat.pages[stage].map(m=>({...m,titleSize:m.type==="hero"?"body":m.type==="result"?"h1":m.type==="text"?"h4":"h3",titleTone:m.type==="text"?"default":"emphasis",bodyTone:"default"}));
}
firstSeat.id = "first-seat-preview";
firstSeat.visibility = "published";
firstSeat.updatedAt = "검토용";
firstSeat.description = "서울아레나의 첫 번째 문장을 함께 만들어주세요.";
export function validSlug(slug: string) {
  return (
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    slug.length <= 64 &&
    !["admin", "api", "assets", "auth", "privacy", "preview"].includes(slug)
  );
}
export function stagesFor(event: EventDraft): Stage[] {
  if(event.stageOrder?.length)return event.stageOrder;
  return event.template === "submission"
    ? ["submission"]
    : event.template === "voting"
      ? ["voting", "result"]
      : ["submission", "voting", "result"];
}
export function moveModule(
  modules: PageModule[],
  id: string,
  direction: -1 | 1,
) {
  const next = [...modules];
  const from = next.findIndex((x) => x.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= next.length) return modules;
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
