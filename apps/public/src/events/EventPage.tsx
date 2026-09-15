import {EventSchedule} from '../../../../packages/ui/src/EventSchedule';
import {consentItems,decodePolicy} from '../../../../packages/event-builder/src/consents';
import { useState, useRef } from "react";
import type { FormEvent } from "react";
import { Button, Modal } from "../../../../packages/ui/src";
import type {
  EventDraft,
  Stage,
  PageModule,
} from "../../../../packages/event-builder/src/model";
import "./events.css";
const sampleCandidates = [
  "모든 순간이 무대가 되는 곳",
  "우리의 함성이 이야기가 되는 곳",
  "함께여서 더 빛나는 순간",
];
function ModuleTitle({module}:{module:PageModule}) {
 if(!module.title)return null;
 const size=module.titleSize??(module.type==="hero"?"body":module.type==="result"?"h1":module.type==="text"?"h4":"h3");
 const className=`module-title text-size-${size} text-tone-${module.titleTone??(module.type==="text"?"default":"emphasis")}`;
 return size==="body"?<p className={className}>{module.title}</p>:<h2 className={className}>{module.title}</h2>;
}
function ModuleBody({module}:{module:PageModule}) {return module.body?<p className={`module-body text-tone-${module.bodyTone??"default"}`}>{module.body}</p>:null;}
export interface LiveEvent {
 policies:{id:string;kind:string;body:string;required:number}[];
 candidates:{id:string;message:string}[];
 result:{message:string}|null;
 accepting:boolean;
 onDirty?:()=>void;
 submit:(fields:FormData,requestKey:string)=>Promise<void>;
}
export function EventPage({
  selectedModuleId,onSelectModule,
  event,
  stage = "submission",
  embedded = false,
  live,
}: {
  event: EventDraft;
  stage?: Stage;
  selectedModuleId?: string;
  onSelectModule?: (id:string)=>void;
  embedded?: boolean;
  live?: LiveEvent;
}) {
  const [policy, setPolicy] = useState<PageModule | null>(null);
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [notice, setNotice] = useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(false);
  const requestKey=useRef(crypto.randomUUID());
  const formatPhone = (raw: string) => {
    const s = raw.replace(/\D/g, "").slice(0, 11);
    return s.length < 4
      ? s
      : s.length < 8
        ? `${s.slice(0, 3)}-${s.slice(3)}`
        : `${s.slice(0, 3)}-${s.slice(3, s.length - 4)}-${s.slice(-4)}`;
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if(!live){setNotice(true);return;}
    if(busy||complete)return;
    const fields=new FormData(e.currentTarget);setBusy(true);setError('');
    try{await live.submit(fields,requestKey.current);setComplete(true);setNotice(true);}
    catch(error){setError(error instanceof Error?error.message:'참여를 완료하지 못했습니다.');}
    finally{setBusy(false);}
  };
  return (
    <div
      className={`event-page event-theme-dark ${embedded ? "embedded" : ""}`}
    >
      <header className="public-header">
        <span className="wordmark">SEOUL ARENA</span>
        <h1 className="event-title-display">{event.title}</h1>
      </header>
      <form onSubmit={submit} onChange={()=>live?.onDirty?.()}>
        <div className="event-content">
          {event.pages[stage].map((module) => {
            switch (module.type) {
              case "hero":
                return (
                  <section className="event-hero" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}>
                    <ModuleTitle module={module}/>
                    <ModuleBody module={module}/>
                  </section>
                );
              case "image":
                return <section className="event-section" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}>{(module.imageUrl||module.imageAssetId)&&<img className="event-image" src={module.imageAssetId?(embedded?`/api/admin/events/${event.id}/assets/${module.imageAssetId}`:`/api/events/${event.slug}/assets/${module.imageAssetId}`):module.imageUrl} alt={module.imageAlt??''} loading="lazy" referrerPolicy="no-referrer"/>}<ModuleTitle module={module}/><ModuleBody module={module}/></section>;
              case "intro":
                return (
                  <section
                    className="event-section intro-section"
                    key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}
                  >
                    <ModuleTitle module={module}/>
                    <ModuleBody module={module}/>
                  </section>
                );
              case "form":
                return (
                  <section className="event-section" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}>
                    <ModuleTitle module={module}/>
                    <ModuleBody module={module}/>
                    {stage === "submission" && (
                      <>
                        <label className="field sentence-field">
                          응모 문구
                          <textarea
                            required
                            name="message"
                            maxLength={event.maxLength}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="당신의 한 문장을 남겨주세요."
                          />
                          <small className="count">
                            {message.length} / {event.maxLength}자
                          </small>
                        </label>
                        <label className="field">
                          이름
                          <input
                            required
                            name="name"
                            autoComplete="name"
                            placeholder="이름을 입력해주세요."
                          />
                        </label>
                      </>
                    )}
                    {(module.fields??[]).map(field=><label className="field" key={field.id}>{field.label}{field.type==='textarea'?<textarea name={'extra:'+field.id} required={field.required} maxLength={field.maxLength}/>:field.type==='select'?<select name={'extra:'+field.id} required={field.required}><option value="">선택해주세요.</option>{field.options.map(option=><option key={option}>{option}</option>)}</select>:<input name={'extra:'+field.id} type={field.type==='number'?'number':'text'} required={field.required} maxLength={field.maxLength}/>}</label>)}
                    <div className="contact-grid">
                      <label className="field">
                        연락처
                        <input
                          required
                          inputMode="numeric"
                          name="phone"
                          autoComplete="tel-national"
                          value={phone}
                          onChange={(e) =>
                            setPhone(formatPhone(e.target.value))
                          }
                          placeholder="010-0000-0000"
                          pattern={String.raw`0[0-9\-]{8,12}`}
                        />
                      </label>
                      <label className="field">
                        이메일
                        <input
                          required
                          type="email"
                          name="email"
                          autoComplete="email"
                          placeholder="example@email.com"
                        />
                      </label>
                    </div>
                    {stage === "voting" && (
                      <label className="field">
                        인스타그램 계정
                        <input
                          required
                          name="instagram"
                          placeholder="아이디를 입력해주세요. (@ 제외)"
                          pattern="@?[A-Za-z0-9_.]{1,30}"
                        />
                        <small>
                          중복 투표 {event.allowRepeatVotes ? "허용" : "제한"} ·
                          입력하신 정보는 공개되지 않습니다.
                        </small>
                      </label>
                    )}
                  </section>
                );
              case "consent": {
                const items=live?live.policies.map(p=>({...p,...decodePolicy(p.body),label:decodePolicy(p.body).label??(p.kind==='privacy'?'개인정보 수집·이용에 동의합니다.':'응모작 활용에 동의합니다.')})):consentItems(module,stage).map(p=>({...p,required:1}));
                return <section className="consent-section" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}><ModuleTitle module={module}/>{items.map(p=><div className="consent-row" key={p.id}><label><input type="checkbox" name="policy" value={p.id} required={!!p.required}/>{p.required?'[필수]':'[선택]'} {p.label}</label><button type="button" onClick={()=>setPolicy({id:p.id,type:'text',title:p.label,body:p.body||'동의문 내용을 입력해주세요.'})}>자세히 보기</button></div>)}</section>;
              }
              case "schedule":
                return <section className="event-section" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}><ModuleTitle module={module}/><ModuleBody module={module}/><EventSchedule items={module.schedule??[]}/></section>;
              case "notices":
                return (
                  <section
                    className="event-section notices-section"
                    key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}
                  >
                    <ModuleTitle module={module}/>
                    <ul>
                      {module.body
                        .split("\n")
                        .filter(Boolean)
                        .map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                    </ul>
                  </section>
                );
              case "candidates":
                return (
                  <section className="event-section" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}>
                    <ModuleTitle module={module}/>
                    <ModuleBody module={module}/>
                    {!live && <p className="sample-note">화면 검토를 위한 예시 후보입니다.</p>}
                    <div className="candidate-list">
                      {(live?.candidates ?? sampleCandidates.map((message,i)=>({id:String(i),message}))).map(({id,message:text}, i) => (
                        <label className="candidate" key={id}>
                          <span className="candidate-number">0{i + 1}</span>
                          <span>{text}</span>
                          <input
                            required
                            type="radio"
                            name="candidate"
                            value={id}
                          />
                        </label>
                      ))}
                    </div>
                  </section>
                );
              case "result":
                return (
                  <section
                    className="event-section result-module"
                    key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}
                  >
                    <ModuleTitle module={live?.result?{...module,title:live.result.message}:module}/>
                    {!live?.result && <ModuleBody module={module}/>}
                  </section>
                );
              default:
                return (
                  <section className="event-section" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}>
                    <ModuleTitle module={module}/>
                    <ModuleBody module={module}/>
                  </section>
                );
            }
          })}
          {stage !== "result" && (
            <div className="submission-action">
              <Button kind="primary" type="submit" disabled={busy||complete||(live&&!live.accepting)}>
                {complete ? "참여 완료" : busy ? "보내는 중" : stage === "submission" ? "문구 보내기" : "투표하기"}
              </Button>
              {!live && <p>에디터 미리보기입니다. 실제 참여는 공개 페이지에서 진행해주세요.</p>}{live&&!live.accepting&&<p>현재 참여 기간이 아닙니다.</p>}{error&&<p role="alert">{error}</p>}
            </div>
          )}
        </div>
      </form>
      <footer className="public-footer">
        <button
          type="button"
          onClick={() =>
            setPolicy({
              id: "privacy",
              type: "text",
              title: "개인정보 처리방침",
              body: live ? event.privacyPolicy??"" : "검토용 화면입니다. 개인정보 처리방침의 확정 원문은 공개 전에 연결됩니다.",
            })
          }
        >
          개인정보 처리방침
        </button>
        {live&&event.contactUrl?<a href={event.contactUrl}>문의</a>:<button
          type="button"
          onClick={() =>
            setPolicy({
              id: "contact",
              type: "text",
              title: "문의",
              body: "검토용 화면입니다. 문의 채널은 공개 전에 연결됩니다.",
            })
          }
        >
          문의
        </button>}
      </footer>
      <Modal
        className="event-theme-dark event-dialog"
        open={policy !== null}
        onOpenChange={(v) => !v && setPolicy(null)}
        title={policy?.title ?? "동의 내용"}
        description="동의 내용을 확인해주세요."
      >
        <p className="policy-body">{policy?.body}</p>{policy?.id==='privacy'&&<p className="policy-body">이 사이트는 봇 방지를 위해 Cloudflare Turnstile을 사용합니다. <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noreferrer">Cloudflare 개인정보 처리 안내</a></p>}
      </Modal>
      <Modal
        className="event-theme-dark event-dialog"
        open={notice}
        onOpenChange={setNotice}
        title={live?"참여가 완료되었습니다.":"입력 화면을 확인했습니다."}
        description={live?"참여해주셔서 감사합니다.":"미리보기에서는 저장하지 않습니다. 실제 참여는 공개 페이지에서 진행해주세요."}
      />
    </div>
  );
}
