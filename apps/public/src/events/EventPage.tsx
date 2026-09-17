import {RichText} from '../../../../packages/ui/src/RichText';
import {BulletText} from "../../../../packages/ui/src/BulletText";
import {eventBrowserTitle} from "../../../../packages/event-builder/src/model";
import {useVoteCheck,duplicateVoteMessage} from './useVoteCheck';
import {CompletionPage} from './CompletionPage';
import {ParticipationFields} from './ParticipationFields';
import {formInputs} from '../../../../packages/event-builder/src/inputs';
import {EventInfoCards} from '../../../../packages/ui/src/EventInfoCards';
import {EventSchedule} from '../../../../packages/ui/src/EventSchedule';
import {consentItems,decodePolicy} from '../../../../packages/event-builder/src/consents';
import { useEffect, useState, useRef } from "react";
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
function ModuleBody({module}:{module:PageModule}) {return module.body?<p className={`module-body text-tone-${module.bodyTone??"default"}`}><RichText text={module.body} marks={module.bodyMarks} size={module.bodySize??'body'}/></p>:null;}
export interface LiveEvent {
 policies:{id:string;kind:string;body:string;required:number}[];
 candidates:{id:string;message:string}[];
 result:{message:string}|null;
 accepting:boolean;
 onDirty?:()=>void;
 completedVote?:boolean;
 checkVote?:(values:Record<string,string>)=>Promise<boolean>;
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


  const [notice, setNotice] = useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(false);
  const requestKey=useRef(crypto.randomUUID());
  const voteCheck=useVoteCheck(stage==="voting"?live?.checkVote:undefined);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if(!live){setNotice(true);return;}
    if(busy||complete||live.completedVote||voteCheck.status!=="clear")return;
    const fields=new FormData(e.currentTarget);setBusy(true);setError('');
    try{await live.submit(fields,requestKey.current);setComplete(true);}
    catch(error){if(error instanceof Error&&error.message===duplicateVoteMessage){voteCheck.markDuplicate();setError('');return;}setError(error instanceof Error?error.message:'참여를 완료하지 못했습니다.');}
    finally{setBusy(false);}
  };
  useEffect(()=>{if(!embedded)document.title=eventBrowserTitle(event);},[embedded,event.browserTitle,event.title]);
  if((complete||live?.completedVote)&&live)return <CompletionPage title={event.title} kind={stage==="voting"?"voting":"submission"} onReturn={()=>{setComplete(false);requestKey.current=crypto.randomUUID();}}/>;
  const headerImage=event.pages[stage].find(m=>m.type==="header-image");
  return (
    <div
      className={`event-page event-theme-dark ${embedded ? "embedded" : ""}`}
    >
      <header className={`public-header ${headerImage?'image-header':''}`} style={headerImage?{minHeight:`${headerImage.headerHeight??80}vh`}:undefined} data-edit-selected={embedded&&headerImage&&selectedModuleId===headerImage.id?true:undefined} onClick={embedded&&headerImage?()=>onSelectModule?.(headerImage.id):undefined}>
        {headerImage&&(headerImage.imageAssetId||headerImage.imageUrl)&&<img className="header-background" src={headerImage.imageAssetId?(embedded?`/api/admin/events/${event.id}/assets/${headerImage.imageAssetId}`:`/api/events/${event.slug}/assets/${headerImage.imageAssetId}`):headerImage.imageUrl} alt={headerImage.imageAlt??''}/>}
        {headerImage&&<div className="header-image-shade" aria-hidden="true"/>}
        <div className={headerImage?"header-sticky-title":undefined}>
          <span className="wordmark">SEOUL ARENA</span>
          <h1 className="event-title-display">{event.title}</h1>
        </div>
      </header>
      <form onSubmit={submit} onChange={e=>{live?.onDirty?.();setError("");voteCheck.update(new FormData(e.currentTarget));}}>
        <div className="event-content">
          {event.pages[stage].map((module) => {
            switch (module.type) {
              case "header-image": return null;
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
                return <section className="event-section intro-section" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}>
                  {module.cards&&<><ModuleTitle module={module}/><ModuleBody module={module}/></>}
                  <EventInfoCards items={module.cards??[{id:module.id,title:module.title,text:'',description:module.body}]}/>
                </section>;
              case "form":
                return (
                  <section className="event-section form-section event-container" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}>
                    <ModuleTitle module={module}/>
                    <ModuleBody module={module}/>
                    <ParticipationFields items={formInputs(module,stage,event.maxLength)}/>
                  </section>
                );
              case "consent": {
                const items=live?[...live.policies].sort((a,b)=>{const order=consentItems(module,stage).map(i=>i.id);return order.indexOf(a.kind)-order.indexOf(b.kind);}).map(p=>({...p,...decodePolicy(p.body),required:p.required,label:decodePolicy(p.body).label??(p.kind==='privacy'?'개인정보 수집·이용에 동의합니다.':'응모작 활용에 동의합니다.')})):consentItems(module,stage).map(p=>({...p,required:p.required!==false?1:0}));
                return <section className="consent-section event-container" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}><ModuleTitle module={module}/>{items.map(p=><div className="consent-row" key={p.id}><label><input type="checkbox" name="policy" value={p.id} required={!!p.required}/>{p.required?'[필수]':'[선택]'} {p.label}</label>{p.body.trim()&&<button type="button" onClick={()=>setPolicy({id:p.id,type:'text',title:p.label,body:p.body})}>자세히 보기</button>}</div>)}</section>;
              }
              case "schedule":
                return <section className="event-section" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}><ModuleTitle module={module}/><ModuleBody module={module}/><EventSchedule items={module.schedule??[]}/></section>;
              case "notices":
                return (
                  <section
                    className="event-section notices-section event-container"
                    key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}
                  >
                    <ModuleTitle module={module}/>
                    <BulletText text={module.body} allLines marks={module.bodyMarks} size={module.bodySize??'small'}/>
                  </section>
                );
              case "candidates":
                return (
                  <section className="event-section voting-section event-container" key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}>
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
                    className="event-section result-module event-container"
                    key={module.id} data-edit-selected={embedded&&selectedModuleId===module.id?true:undefined} onClick={embedded?()=>onSelectModule?.(module.id):undefined}
                  >
                    <ModuleTitle module={live?.result?{...module,title:live.result.message}:module}/>
                    <ModuleBody module={module}/>
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
              {(voteCheck.status==="duplicate"||voteCheck.status==="error")&&<div className="vote-check-notice" aria-live="polite">
                <p>{voteCheck.status==='duplicate'?duplicateVoteMessage:'중복 투표 여부를 확인하지 못했습니다. 다시 확인해주세요.'}</p>
                {voteCheck.status==='error'&&<button type="button" className="completion-return" onClick={voteCheck.retry}>다시 확인</button>}
              </div>}

              <Button kind="primary" type="submit" disabled={busy||complete||(live&&!live.accepting)||voteCheck.status!=="clear"}>
                {complete ? "참여 완료" : busy ? "보내는 중" : stage === "submission" ? "문구 보내기" : "투표하기"}
              </Button>
              {!live && <p>에디터 미리보기입니다. 실제 참여는 공개 페이지에서 진행해주세요.</p>}{live&&!live.accepting&&<p>현재 참여 기간이 아닙니다.</p>}{error&&<p role="alert">{error}</p>}
            </div>
          )}
        </div>
      </form>

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
