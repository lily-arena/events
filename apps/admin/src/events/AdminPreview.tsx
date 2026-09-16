import {AdminRequestError} from './operations-api';
import {InputFieldsEditor} from './InputFieldsEditor';
import {formInputs} from '../../../../packages/event-builder/src/inputs';
import {InfoCardsEditor} from './InfoCardsEditor';
import {ScheduleEditor} from './ScheduleEditor';
import {consentItems} from '../../../../packages/event-builder/src/consents';
import {AdminNotice,type AdminTone} from '../../../../packages/ui/src/AdminStatus';
import { useEffect, useState, useRef, type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Button, Modal } from "../../../../packages/ui/src";
import {
  createEvent,
  firstSeat,
  FIRST_SEAT_INTRO_TITLE,
  FIRST_SEAT_INTRO_BODY,
  moduleNames,
  moveModule,
  stageNames,
  stagesFor,
  validSlug,
} from "../../../../packages/event-builder/src/model";
import type {
  EventDraft,
  ModuleType,
  PageModule,
  TextSize,
  TextTone,
  Stage,
} from "../../../../packages/event-builder/src/model";
import { EventPage } from "../../../public/src/events/EventPage";
import "./admin.css";
const STORAGE_KEY = "seoul-arena-events:review-drafts:v1";
const templates = [
  {
    id: "first-seat",
    title: "공모 후 투표",
    description: "응모작을 받고, 후보를 선정해 투표와 결과까지 이어갑니다.",
    stages: "공모 · 투표 · 결과",
  },
  {
    id: "submission",
    title: "접수 이벤트",
    description: "참여 정보를 받고 접수를 마무리하는 간단한 이벤트입니다.",
    stages: "접수 · 완료",
  },
  {
    id: "voting",
    title: "투표 이벤트",
    description: "준비한 후보를 등록하고 참여자의 의견을 모읍니다.",
    stages: "투표 · 결과",
  },
] as const;
function migrateTypography(event:EventDraft):EventDraft {
 if(event.id!=="first-seat-preview")return event;
 return {...event,pages:Object.fromEntries(Object.entries(event.pages).map(([stage,modules])=>[stage,modules.map(m=>({...m,...(stage==="submission"&&m.type==="form"&&m.title==="당신의 한 문장"?{title:"",body:""}:{}),titleSize:m.titleSize??(m.type==="hero"?"body":m.type==="result"?"h1":m.type==="text"?"h4":"h3"),titleTone:m.titleTone??(m.type==="text"?"default":"emphasis"),bodyTone:m.bodyTone??"default"}))])) as EventDraft["pages"]};
}
function readDrafts(): EventDraft[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (
      Array.isArray(value) &&
      value.length &&
      value.every(
        (e) =>
          e &&
          typeof e.id === "string" &&
          typeof e.slug === "string" &&
          e.pages?.submission &&
          e.pages?.voting &&
          e.pages?.result,
      )
    )
      return value.map((event: EventDraft) => {
        if (event.id !== "first-seat-preview") return event;
        const hero = event.pages.submission.find((m) => m.id === "hero");
        if (!hero || hero.title !== "FIRST SEAT") return migrateTypography(event);
        return {
          ...event,
          pages: {
            ...event.pages,
            submission: event.pages.submission
              .filter(
                (m) =>
                  !(
                    m.id === "intro" &&
                    m.title === "당신이라면, 어떤 말을 남기고 싶나요?"
                  ),
              )
              .map((m) =>
                m.id === "hero"
                  ? {
                      ...m,
                      title: FIRST_SEAT_INTRO_TITLE,
                      body: FIRST_SEAT_INTRO_BODY,
                    }
                  : m,
              ),
          },
        };
      }).map(migrateTypography);
  } catch {}
  return [structuredClone(firstSeat)];
}
export interface EditorStorage {
 initialEvents: EventDraft[];
 checkRevision?:(id:string)=>Promise<{revision:number}|null>;
 load?:(id:string)=>Promise<EventDraft>;
 publish?:(draft:EventDraft)=>Promise<EventDraft>;
 refresh?:()=>Promise<EventDraft[]>;
 operations?: (event: EventDraft, section?: string, onChanged?: (event:EventDraft)=>void) => ReactNode;
 account: string;
 local?: boolean;
 upload?: (eventId:string,file:File)=>Promise<string>;
 save: (draft: EventDraft) => Promise<EventDraft>;
 create: (draft: EventDraft) => Promise<EventDraft>;
}
export default function AdminPreview({ storage }: {storage?: EditorStorage} = {}) {
  const [events, setEvents] = useState<EventDraft[]>(() => storage?.initialEvents ?? readDrafts());
  const [view, setView] = useState<"list" | "editor" | "operations">("list");
  const [operationSection,setOperationSection]=useState('overview');
  const [selected, setSelected] = useState(events[0]?.id ?? "");
  const [stage, setStage] = useState<Stage>("submission");
  const [moduleId, setModuleId] = useState("hero");
  const [viewport, setViewport] = useState("mobile");
  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [template, setTemplate] =
    useState<EventDraft["template"]>("first-seat");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [noticeTone,setNoticeTone]=useState<AdminTone>('info');
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving,setSaving]=useState(false);
  const event = events.find((x) => x.id === selected) ?? events[0] ?? firstSeat;
  const active = event.pages[stage].find((m) => m.id === moduleId);
  const [draft, setDraft] = useState<EventDraft>(structuredClone(event));
  const draftRef=useRef(draft);draftRef.current=draft;
  const [dirty,setDirty]=useState(false),[conflict,setConflict]=useState(false);
  const [latest,setLatest]=useState<EventDraft|null>(null),[compareMine,setCompareMine]=useState(false);
  const [pendingLeave,setPendingLeave]=useState<(()=>void)|null>(null);
  function navigate(action:()=>void){if(saving){setNoticeTone('info');setMessage('저장이 끝난 뒤 이동해주세요.');return;}if(view==='editor'&&dirty){setPendingLeave(()=>action);return;}action();}
  function backup(){const blob=new Blob([JSON.stringify(draftRef.current,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=draftRef.current.slug+'-draft.json';link.click();URL.revokeObjectURL(url);}
  function finishSave(submitted:EventDraft,result:EventDraft){
   setEvents(items=>items.map(e=>e.id===result.id?result:e));
   if(draftRef.current.id!==submitted.id)return;
   const changed=JSON.stringify(draftRef.current)!==JSON.stringify(submitted);
   setDraft(current=>changed?{...current,editorRevision:result.editorRevision}:result);setDirty(changed);setSaved(!changed);setConflict(false);
  }
  function saveError(error:unknown,fallback:string){if(error instanceof AdminRequestError&&error.code==='EDIT_CONFLICT')setConflict(true);setNoticeTone('error');setMessage(error instanceof Error?error.message:fallback);}
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  useEffect(()=>{
   if(view!=='editor'||!storage?.checkRevision||saving)return;
   let active=true;
   async function check(){if(document.visibilityState==='hidden')return;const id=draftRef.current.id;try{const state=await storage!.checkRevision!(id);if(active&&draftRef.current.id===id&&(!state||state.revision>(draftRef.current.editorRevision??0)))setConflict(true);}catch{/* Saving still checks the version on the server. */}}
   void check();const timer=setInterval(check,15000);window.addEventListener('focus',check);
   return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',check);};
  },[view,selected,saving,storage]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  function openEditor(e:EventDraft){navigate(()=>{void loadEditor(e);});}
  async function loadEditor(e: EventDraft) {
    if(storage?.load){try{e=await storage.load(e.id);}catch(error){setNoticeTone('error');setMessage(error instanceof Error?error.message:'불러오지 못했습니다.');return;}}
    setDirty(false);setConflict(false);setLatest(null);setSelected(e.id);
    setDraft(structuredClone(e));
    setStage(stagesFor(e)[0]!);
    setModuleId("hero");
    setSaved(false);
    setView("editor");
  }
  function update(mutator: (e: EventDraft) => EventDraft) {
    setDraft((e) => mutator(e));
    setDirty(true);
    setSaved(false);
  }
  function persist(next: EventDraft[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setEvents(next);
      return true;
    } catch {
      setMessage("브라우저에 검토용 구성을 저장할 수 없습니다.");
      return false;
    }
  }
  async function publish(){if(!storage?.publish||saving||conflict)return;setSaving(true);const submitted=draft;try{const next=await storage.publish(submitted);finishSave(submitted,next);setNoticeTone('success');setMessage('페이지와 동의문을 공개했습니다.');}catch(error){saveError(error,'공개하지 못했습니다.');}finally{setSaving(false);}}
  async function save() {
    if(saving||conflict)return;
    if (storage) {
      setSaving(true);const submitted=draft;
      try {const result=await storage.save(submitted);finishSave(submitted,result);setNoticeTone('success');setMessage('저장했습니다.');}
      catch(error){saveError(error,'저장하지 못했습니다.');}finally{setSaving(false);}
      return;
    }
    const next = events.map((e) =>
      e.id === draft.id ? { ...draft, updatedAt: "방금" } : e,
    );
    if (persist(next)) {
      setDirty(false);setSaved(true);
      setMessage(
        "검토용 구성을 이 브라우저에 저장했습니다. 실제 사이트에는 반영되지 않습니다.",
      );
    }
  }
  async function create() {
    if (
      !title.trim() ||
      !validSlug(slug) ||
      events.some((e) => e.slug === slug)
    ) {
      setMessage("이벤트 이름과 중복되지 않는 영문 주소를 확인해주세요.");
      return;
    }
    const next = createEvent(template, title.trim(), slug);
    if (storage) {
      try { const result=await storage.create(next); setEvents([...events,result]); setCreateOpen(false);setTitle("");setSlug("");openEditor(result); }
      catch(error){setNoticeTone('error');setMessage(error instanceof Error?error.message:"생성하지 못했습니다.");}
      return;
    }
    if (persist([...events, next])) {
      setCreateOpen(false);
      setTitle("");
      setSlug("");
      openEditor(next);
    }
  }
  function patchModule(patch:Partial<PageModule>){update(d=>({...d,pages:{...d.pages,[stage]:d.pages[stage].map(m=>m.id===moduleId?{...m,...patch}:m)}}));}
  const selectedModule = draft.pages[stage].find((m) => m.id === moduleId);
  const filtered = events.filter(
    (e) =>
      (filter === "all" || e.visibility === filter) &&
      (e.title + " " + e.slug).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a href="/admin" className="admin-brand">
          이벤트 관리
        </a>

        <nav aria-label="관리자 메뉴">
          <button className={view==='list'?'active':''} onClick={()=>navigate(()=>setView('list'))}>대시보드</button>
          <strong className="nav-group-label">이벤트</strong>
          {events.map(item=><div className="nav-event" key={item.id}>
            <h2 className="nav-event-title">{item.title}</h2>
            <div className="nav-event-children">
              <button className={selected===item.id&&view==='editor'?'active':''} onClick={()=>{openEditor(item);}}>콘텐츠 편집</button>
              <button className={selected===item.id&&view==='operations'?'nav-expanded':''} aria-expanded={selected===item.id&&view==='operations'} onClick={()=>navigate(()=>{setSelected(item.id);setView('operations');})}>운영</button>
              {selected===item.id&&view==='operations'&&<div className="nav-operation-children">{[['overview','공개·일정'],['review','응모작 심사'],['voting','후보·투표'],['result','결과 선정'],['privacy','개인정보'],['audit','운영 기록'],['settings','설정']].map(([key,label])=><button key={key} aria-current={operationSection===key?'page':undefined} className={operationSection===key?'active':''} onClick={()=>setOperationSection(key!)}>{label}</button>)}</div>}
            </div>
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="admin-account">
            <span className="avatar">SA</span>
            <div>
              <strong>서울아레나 운영자</strong>
              <small>{storage?.account ?? "검토용 화면"}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="admin-workspace">
        {(!storage||storage.local)&&<div className="review-note">
          {storage ? "로컬 테스트 DB에 저장됩니다. 회사 로그인과 운영 배포는 아직 연결 전입니다." : "검토용 화면 · Google 로그인과 실제 데이터 저장은 아직 연결되지 않았습니다."}
        </div>}
        <main
          className={`admin-main ${view === "editor" ? "editor-main" : ""}`}
        >
          {view === "operations" && storage?.operations?.(event,operationSection,next=>{setEvents(items=>items.map(item=>item.id===next.id?next:item));setDraft(current=>JSON.stringify(current)===JSON.stringify(event)?structuredClone(next):current);})}
          {view === "list" && (
            <>
              <div className="admin-page-heading">
                <div>
                  <h1>이벤트</h1>
                </div>
                <Button kind="primary" onClick={() => setCreateOpen(true)}>
                  이벤트 생성
                </Button>
              </div>
              <div className="overview-stats">
                <div>
                  <span>전체 이벤트</span>
                  <strong>{events.length.toString().padStart(2, "0")}</strong>
                </div>
                <div>
                  <span>공개 구성</span>
                  <strong>
                    {events
                      .filter((e) => e.visibility === "published")
                      .length.toString()
                      .padStart(2, "0")}
                  </strong>
                </div>
                <div>
                  <span>작성 중</span>
                  <strong>
                    {events
                      .filter((e) => e.visibility === "draft")
                      .length.toString()
                      .padStart(2, "0")}
                  </strong>
                </div>
              </div>
              <div className="list-toolbar">
                <Tabs.Root value={filter} onValueChange={setFilter}>
                  <Tabs.List aria-label="이벤트 상태" className="filter-tabs">
                    <Tabs.Trigger value="all">전체</Tabs.Trigger>
                    <Tabs.Trigger value="published">공개 구성</Tabs.Trigger>
                    <Tabs.Trigger value="draft">작성 중</Tabs.Trigger>
                  </Tabs.List>
                </Tabs.Root>
                <input
                  aria-label="이벤트 검색"
                  className="search"
                  placeholder="이벤트 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="event-table">
                <div className="event-table-head">
                  <span>이벤트</span>
                  <span>구성</span>
                  <span>상태</span>
                  <span>마지막 저장</span>
                  <span />
                </div>
                {filtered.map((e) => (
                  <div className="event-table-row" key={e.id}>
                    <div className="event-identity">
                      <div className="event-thumb">
                        {e.template === "first-seat" ? "FS" : "SA"}
                      </div>
                      <div>
                        <button
                          className="event-title"
                          onClick={() => openEditor(e)}
                        >
                          {e.title}
                        </button>
                        <a href={`https://events.seoularena.net/${e.slug}`} target="_blank" rel="noreferrer">events.seoularena.net/{e.slug}</a>
                      </div>
                    </div>
                    <span className="table-template">
                      {templates.find((t) => t.id === e.template)?.title}
                    </span>
                    <span>
                      <span
                        className={`tag ${e.visibility === "published" ? "dark" : ""}`}
                      >
                        {e.visibility === "published" ? "공개" : e.visibility === "archived" ? "보관" : "작성 중"}
                      </span>
                    </span>
                    <span className="muted table-updated">{e.updatedAt}</span>
                    <Button kind="small" onClick={() => openEditor(e)}>
                      편집
                    </Button>
                  </div>
                ))}
                {!filtered.length && (
                  <p className="empty-state">
                    검색 조건에 맞는 이벤트가 없습니다.
                  </p>
                )}
              </div>
              <div className="start-guide">
                <div>
                  <h2>템플릿으로 생성</h2>
                </div>
                <div className="template-cards">
                  {templates.map((t) => (
                    <button
                      className="template-card"
                      key={t.id}
                      onClick={() => {
                        setTemplate(t.id);
                        setCreateOpen(true);
                      }}
                    >
                      <span className="template-lines">
                        <i />
                        <i />
                        <i />
                      </span>
                      <strong>{t.title}</strong>
                      <span>{t.stages}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {view === "editor" && (
            <>
              {conflict&&<AdminNotice tone="warning"><p>다른 운영자가 이벤트를 변경했습니다. 내 수정 내용은 유지되며, 저장·공개는 잠시 중지됩니다.</p><div className="row"><Button onClick={async()=>{try{const next=await storage!.load!(draft.id);setLatest(next);setCompareMine(false);setMessage("");}catch(error){saveError(error,'최신 내용을 불러오지 못했습니다.');}}}>최신 내용 확인</Button><Button onClick={backup}>내 초안 파일로 보관</Button></div></AdminNotice>}
              <div className="editor-heading">
                <div>
                  <button className="back-link" onClick={() => navigate(async () => {if(storage?.refresh){try{setEvents(await storage.refresh());}catch{setMessage("목록을 불러오지 못했습니다.");}}setView("list");})}>
                    이벤트 목록
                  </button>
                  <h1>
                    {draft.title}
                    <span className="tag">페이지 편집</span>
                  </h1>
                  <div className="event-address-panel"><p><a href={`https://events.seoularena.net/${draft.slug}`} target="_blank" rel="noreferrer">https://events.seoularena.net/{draft.slug}</a></p>
                  <label className="field">이벤트 주소<input aria-label="등록된 이벤트 주소" disabled={event.visibility!=="draft"} value={draft.slug} onChange={e=>update(d=>({...d,slug:e.target.value.toLowerCase()}))}/><small>영문 소문자·숫자·하이픈을 사용합니다. 공개한 이벤트의 주소는 변경할 수 없습니다.</small></label>
                  <Button onClick={async()=>{try{await navigator.clipboard.writeText(`https://events.seoularena.net/${draft.slug}`);setMessage('링크를 복사했습니다.');}catch{setMessage('주소를 선택하여 복사해주세요.');}}}>링크 복사</Button></div>
                </div>
                <div className="row">
                  <span className="save-status">
                    {saving?"저장 중":dirty?"저장하지 않은 변경 있음":saved?"저장됨":storage?"저장된 초안":"검토용 초안"}
                  </span>
                  <Button
                    onClick={() =>
                      window.open(`/${draft.slug}`, "_blank")
                    }
                  >
                    공개 페이지에서 테스트
                  </Button>
                  <Button kind="primary" disabled={saving||conflict} onClick={save}>
                    {storage ? "저장" : "검토용 저장"}
                  </Button>
                  {storage?.publish&&<Button disabled={saving||conflict} onClick={publish}>저장 후 공개</Button>}
                  {storage?.operations && <Button onClick={() => navigate(()=>setView("operations"))}>운영</Button>}
                </div>
              </div>
              <section className="stage-configuration"><h2>단계 구성</h2>{stagesFor(draft).map((s,i)=><div key={s}><span className="stage-order-number">{String(i+1).padStart(2,'0')}</span><strong>{stageNames[s]}</strong><Button disabled={i===0} onClick={()=>update(d=>{const order=[...stagesFor(d)];[order[i-1],order[i]]=[order[i]!,order[i-1]!];return {...d,stageOrder:order};})}>앞으로 이동</Button><Button disabled={stagesFor(draft).length===1} onClick={()=>{const order=stagesFor(draft).filter(x=>x!==s);update(d=>({...d,stageOrder:order}));if(stage===s)setStage(order[0]!);}}>단계 제외</Button></div>)}{(['submission','voting','result'] as Stage[]).filter(s=>!stagesFor(draft).includes(s)).map(s=><Button key={s} onClick={()=>update(d=>({...d,stageOrder:[...stagesFor(d),s]}))}>{stageNames[s]} 추가</Button>)}</section>
              <section className="stage-configuration"><h2>푸터 설정</h2><label className="field">개인정보 처리방침<textarea rows={8} value={draft.privacyPolicy??''} onChange={e=>update(d=>({...d,privacyPolicy:e.target.value}))}/></label><label className="field">문의 주소<input type="email" value={(draft.contactUrl??'').replace(/^mailto:/,'')} onChange={e=>update(d=>({...d,contactUrl:e.target.value?'mailto:'+e.target.value:''}))} placeholder="담당자@seoularena.net"/></label><label className="field">개인정보 보유 기간<select value={draft.retentionDays??90} onChange={e=>update(d=>({...d,retentionDays:Number(e.target.value)}))}>{[30,90,180,365].map(days=><option key={days} value={days}>참여일로부터 {days}일</option>)}</select></label></section>
              <div className="editor-stepbar">
                <Tabs.Root
                  value={stage}
                  onValueChange={(value) => {
                    setStage(value as Stage);
                    setModuleId("hero");
                  }}
                >
                  <Tabs.List className="stage-tabs" aria-label="이벤트 단계">
                    {stagesFor(draft).map((s, i) => (
                      <Tabs.Trigger value={s} key={s}>
                        <span>0{i + 1}</span>
                        {stageNames[s]}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Tabs.Root>
              </div>
              <div className="builder-layout">
                <section className="modules-panel">
                  <div className="panel-title">
                    <h2>페이지 구성</h2>
                    <span>{draft.pages[stage].length}개 모듈</span>
                  </div>
                  <div className="module-list">
                    {draft.pages[stage].map((m, i) => (
                      <button
                        key={m.id}
                        className={`module-item ${moduleId === m.id ? "selected" : ""}`}
                        onClick={() => setModuleId(m.id)}
                      >
                        <span className="module-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>
                          <strong>{moduleNames[m.type]}</strong>
                          <small>{m.title}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <Button
                    className="add-module"
                    onClick={() => setAddOpen(true)}
                  >
                    모듈 추가
                  </Button>
                </section>
                <section className="preview-panel">
                  <div className="preview-toolbar">
                    <span>미리보기</span>
                    <Tabs.Root value={viewport} onValueChange={setViewport}>
                      <Tabs.List
                        className="viewport-tabs"
                        aria-label="미리보기 크기"
                      >
                        <Tabs.Trigger value="mobile">모바일</Tabs.Trigger>
                        <Tabs.Trigger value="desktop">PC</Tabs.Trigger>
                      </Tabs.List>
                    </Tabs.Root>
                    <span className="preview-size">
                      {viewport === "mobile" ? "390px" : "가변 너비"}
                    </span>
                  </div>
                  <div className={`preview-canvas ${viewport}`}>
                    <div className="preview-document">
                      <EventPage event={draft} stage={stage} embedded selectedModuleId={moduleId} onSelectModule={setModuleId} />
                    </div>
                  </div>
                </section>
                <section className="settings-panel">
                  <div className="panel-title">
                    <h2>모듈 설정</h2>
                  </div>
                  {selectedModule ? (
                    <div className="settings-content"><div className="module-actions">
                      <div className="field">
                        모듈 순서
                        <div className="row">
                          <Button
                            kind="small"
                            disabled={draft.pages[stage][0]?.id === moduleId}
                            onClick={() =>
                              update((d) => ({
                                ...d,
                                pages: {
                                  ...d.pages,
                                  [stage]: moveModule(
                                    d.pages[stage],
                                    moduleId,
                                    -1,
                                  ),
                                },
                              }))
                            }
                          >
                            위로 이동
                          </Button>
                          <Button
                            kind="small"
                            disabled={
                              draft.pages[stage].at(-1)?.id === moduleId
                            }
                            onClick={() =>
                              update((d) => ({
                                ...d,
                                pages: {
                                  ...d.pages,
                                  [stage]: moveModule(
                                    d.pages[stage],
                                    moduleId,
                                    1,
                                  ),
                                },
                              }))
                            }
                          >
                            아래로 이동
                          </Button>
                        </div>
                      </div>
                      <button
                        className="remove-module"
                        onClick={() => {
                          update((d) => ({
                            ...d,
                            pages: {
                              ...d.pages,
                              [stage]: d.pages[stage].filter(
                                (m) => m.id !== moduleId,
                              ),
                            },
                          }));
                          setModuleId("");
                        }}
                      >
                        모듈 삭제
                      </button></div>
                      {selectedModule.type==="hero"&&<label className="field">이벤트 제목<input aria-label="이벤트 제목" value={draft.title} onChange={e=>update(d=>({...d,title:e.target.value}))}/><small>SEOUL ARENA 아래에 표시됩니다. 모든 단계에 공통 적용됩니다.</small></label>}

                      <label className="field">
                        제목
                        <textarea
                          aria-label="제목"
                          value={selectedModule.title}
                          onChange={(e) =>
                            update((d) => ({
                              ...d,
                              pages: {
                                ...d.pages,
                                [stage]: d.pages[stage].map((m) =>
                                  m.id === moduleId
                                    ? { ...m, title: e.target.value }
                                    : m,
                                ),
                              },
                            }))
                          }
                        />
                      </label>
                      {selectedModule.type==='image'&&<>{storage?.upload&&<label className="field">이미지 업로드<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const id=await storage.upload!(draft.id,file);patchModule({imageAssetId:id,imageUrl:''});setMessage('이미지를 업로드했습니다. 페이지를 저장해주세요.');}catch(error){setNoticeTone('error');setMessage(error instanceof Error?error.message:'업로드하지 못했습니다.');}}}/></label>}<label className="field">이미지 주소<input type="url" value={selectedModule.imageUrl??''} onChange={e=>patchModule({imageUrl:e.target.value})} placeholder="https://.../image.jpg"/></label><label className="field">이미지 설명<input value={selectedModule.imageAlt??''} onChange={e=>patchModule({imageAlt:e.target.value})}/></label></>}
                      <label className="field">제목 크기<select aria-label="제목 크기" value={selectedModule.titleSize??(selectedModule.type==="hero"?"body":"h3")} onChange={e=>patchModule({titleSize:e.target.value as TextSize})}><option value="h1">H1 · 가장 크게</option><option value="h2">H2 · 크게</option><option value="h3">H3 · 중간</option><option value="h4">H4 · 작게</option><option value="body">본문 크기</option></select></label>
                      <label className="field">제목 색상<select aria-label="제목 색상" value={selectedModule.titleTone??"emphasis"} onChange={e=>patchModule({titleTone:e.target.value as TextTone})}><option value="default">기본 · 회색</option><option value="emphasis">강조 · 흰색</option></select></label>
                      <label className="field">
                        설명
                        <textarea
                          aria-label="설명"
                          className="body-editor"
                          value={selectedModule.body}
                          onChange={(e) =>
                            update((d) => ({
                              ...d,
                              pages: {
                                ...d.pages,
                                [stage]: d.pages[stage].map((m) =>
                                  m.id === moduleId
                                    ? { ...m, body: e.target.value }
                                    : m,
                                ),
                              },
                            }))
                          }
                        />
                        <small>줄을 바꾸면 문단이 나뉩니다.</small>
                      </label>
                      <label className="field">본문 색상<select aria-label="본문 색상" value={selectedModule.bodyTone??"default"} onChange={e=>patchModule({bodyTone:e.target.value as TextTone})}><option value="default">기본 · 회색</option><option value="emphasis">강조 · 흰색</option></select></label>
                      {selectedModule.type==='intro'&&<InfoCardsEditor items={selectedModule.cards??[{id:selectedModule.id+'-card',title:selectedModule.title,text:'',description:selectedModule.body}]} onChange={cards=>patchModule({cards,...(!selectedModule.cards?{title:'',body:''}:{})})}/>}
                      {selectedModule.type==='schedule'&&<ScheduleEditor items={selectedModule.schedule??[]} onChange={schedule=>patchModule({schedule})}/>}
                      {selectedModule.type==='form'&&<InputFieldsEditor items={formInputs(selectedModule,stage,draft.maxLength)} onChange={inputFields=>update(d=>({...d,maxLength:inputFields.find(f=>f.binding==='message')?.maxLength??d.maxLength,pages:{...d.pages,[stage]:d.pages[stage].map(m=>m.id===moduleId?{...m,inputFields}:m)}}))}/>}
                      {selectedModule.type === "form" && stage === "voting" && (
                        <label className="field">
                          중복 투표
                          <select
                            aria-label="중복 투표"
                            value={draft.allowRepeatVotes ? "allow" : "deny"}
                            onChange={(e) =>
                              update((d) => ({
                                ...d,
                                allowRepeatVotes: e.target.value === "allow",
                              }))
                            }
                          >
                            <option value="deny">제한하기</option>
                            <option value="allow">허용하기</option>
                          </select>
                          <small>
                            연락처·이메일·인스타그램 중 하나라도 같으면 추가
                            투표를 제한하는 방식입니다. 저장 후 페이지를 공개하면 적용됩니다.
                          </small>
                        </label>
                      )}
                      {selectedModule.type==='consent'&&<fieldset><legend>동의 항목</legend>{consentItems(selectedModule,stage).map((item,index)=><div key={item.id}><div className="consent-item-actions"><span>항목 {index+1}</span>{([-1,1] as const).map(offset=><Button key={offset} kind="small" disabled={index+offset<0||index+offset>=consentItems(selectedModule,stage).length} onClick={()=>{const items=[...consentItems(selectedModule,stage)];[items[index],items[index+offset]]=[items[index+offset]!,items[index]!];patchModule({consents:items});}}>{offset===-1?'위로':'아래로'}</Button>)}</div><label className="field">필수 여부<select value={item.required===false?'optional':'required'} onChange={e=>patchModule({consents:consentItems(selectedModule,stage).map((x,i)=>i===index?{...x,required:e.target.value==='required'}:x)})}><option value="required">필수</option><option value="optional">선택</option></select></label><label className="field">체크박스 문구<input value={item.label} onChange={e=>patchModule({consents:consentItems(selectedModule,stage).map((x,i)=>i===index?{...x,label:e.target.value}:x)})}/></label><label className="field">자세히 보기 원문 (선택)<textarea rows={8} value={item.body} onChange={e=>patchModule({consents:consentItems(selectedModule,stage).map((x,i)=>i===index?{...x,body:e.target.value}:x)})}/></label>{!['privacy','work-license'].includes(item.id)&&<Button onClick={()=>patchModule({consents:consentItems(selectedModule,stage).filter(x=>x.id!==item.id)})}>항목 삭제</Button>}</div>)}<Button disabled={consentItems(selectedModule,stage).length>=12} onClick={()=>patchModule({consents:[...consentItems(selectedModule,stage),{id:'consent-'+crypto.randomUUID(),label:'추가 동의 항목',body:''}]})}>동의 항목 추가</Button><small>저장 후 페이지를 공개하면 적용됩니다. 기존 참여자의 동의 원문은 보존됩니다.</small></fieldset>}

                    </div>
                  ) : (
                    <p className="empty-state">수정할 모듈을 선택해주세요.</p>
                  )}
                </section>
              </div>
            </>
          )}
        </main>
        <footer className="admin-footer">
          <span>{storage ? "" : "검토용 구성만 이 브라우저에 저장됩니다."}</span>
        </footer>
      </div>
      {message && (
        <div className="toast"><AdminNotice tone={noticeTone}>{message}</AdminNotice></div>
      )}
      <Modal open={!!pendingLeave} onOpenChange={v=>{if(!v)setPendingLeave(null);}} title="저장하지 않은 변경이 있습니다." description="계속하면 이 화면의 수정 내용을 버립니다. 필요한 내용은 먼저 저장하거나 파일로 보관해주세요.">
       <Button onClick={backup}>내 초안 파일로 보관</Button><Button onClick={()=>{const action=pendingLeave;setPendingLeave(null);setDirty(false);action?.();}}>수정 내용을 버리고 계속</Button>
      </Modal>
      <Modal className="editor-conflict-dialog" open={!!latest} onOpenChange={v=>{if(!v)setLatest(null);}} title="최신 내용 확인" description="내 수정 내용은 아직 변경되지 않았습니다. 필요한 내용을 보관한 뒤 최신 버전에서 다시 편집해주세요.">
       {latest&&<><div className="row"><Button onClick={()=>setCompareMine(true)} aria-pressed={compareMine}>내 수정 화면</Button><Button onClick={()=>setCompareMine(false)} aria-pressed={!compareMine}>최신 저장 화면</Button><Button onClick={backup}>내 초안 파일로 보관</Button></div>
       <EventPage event={compareMine?draft:latest} stage={stagesFor(compareMine?draft:latest).includes(stage)?stage:stagesFor(compareMine?draft:latest)[0]!} embedded/>
       <h3>푸터 설정</h3><p className="conflict-policy">{(compareMine?draft:latest).privacyPolicy||'개인정보 처리방침 없음'}</p><p>{(compareMine?draft:latest).contactUrl}</p>
       <Button onClick={()=>navigate(()=>{setDraft(structuredClone(latest));if(!stagesFor(latest).includes(stage)){setStage(stagesFor(latest)[0]!);setModuleId("hero");}setEvents(items=>items.map(e=>e.id===latest.id?latest:e));setDirty(false);setConflict(false);setSaved(true);setLatest(null);} )}>최신 버전으로 다시 편집</Button></>}
      </Modal>
      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="새 이벤트 생성"
        description="템플릿과 이벤트 주소를 설정합니다."
      >
        <div className="stack">
          <div className="template-options">
            {templates.map((t) => (
              <label key={t.id}>
                <input
                  type="radio"
                  name="template"
                  checked={template === t.id}
                  onChange={() => setTemplate(t.id)}
                />
                <span>
                  <strong>{t.title}</strong>
                  <small>{t.stages}</small>
                </span>
              </label>
            ))}
          </div>
          <label className="field">
            이벤트 이름
            <input
              aria-label="이벤트 이름"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 서울아레나의 첫 만남"
            />
          </label>
          <label className="field">
            이벤트 주소
            <input
              aria-label="이벤트 주소"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="예: first-meeting"
            />
            <small>
              events.seoularena.net/{slug || "이벤트주소"}
              <br />
              영문 소문자·숫자·하이픈을 사용해주세요.
            </small>
          </label>
          <Button kind="primary" onClick={create}>
            {storage ? "이벤트 생성" : "검토용 이벤트 생성"}
          </Button>
        </div>
      </Modal>
      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        title="모듈 추가"
        description="추가할 모듈을 선택합니다."
      >
        <div className="add-options">
          {(Object.entries(moduleNames) as [ModuleType, string][]).map(
            ([type, name]) => (
              <button
                key={type}
                onClick={() => {
                  const id = crypto.randomUUID();
                  update((d) => ({
                    ...d,
                    pages: {
                      ...d.pages,
                      [stage]: [
                        ...d.pages[stage],
                        { id, type, title: name, body: type==='schedule'?'':"내용을 입력해주세요.", ...(type==='intro'?{title:'',body:'',cards:[{id:crypto.randomUUID(),title:'새 안내',text:'',description:''}]}:{}), ...(type==='schedule'?{schedule:[{id:crypto.randomUUID(),title:'접수 기간',start:'',end:'',description:''}]}:{}) },
                      ],
                    },
                  }));
                  setModuleId(id);
                  setAddOpen(false);
                }}
              >
                {name}
              </button>
            ),
          )}
        </div>
      </Modal>
    </div>
  );
}
