import type {TextMark} from './rich-text';
import {inputTypes,inputLimit,type FormInput} from './inputs';
import {consentItems} from './consents';
import { moduleNames, validSlug, type EventDraft, type PageModule, type InputField, type Stage } from './model';

export class ConfigurationError extends Error {}
const fail = (message: string): never => { throw new ConfigurationError(message); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('설정을 확인해주세요.');
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return fail('문구 길이와 필수 항목을 확인해주세요.');
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fail('선택할 수 없는 설정입니다.');
}
function marks(value:unknown,body:unknown):TextMark[]|undefined {if(value===undefined)return undefined;if(!Array.isArray(value)||value.length>200||typeof body!=='string')return fail('본문 서식을 확인해주세요.');return value.map(v=>{const m=object(v);if(!Number.isSafeInteger(m.start)||!Number.isSafeInteger(m.end)||Number(m.start)<0||Number(m.end)<=Number(m.start)||Number(m.end)>body.length)fail('선택 글자 범위를 확인해주세요.');for(const key of ['bold','italic','underline'])if(m[key]!==undefined&&typeof m[key]!=='boolean')fail('글자 서식을 확인해주세요.');return {start:Number(m.start),end:Number(m.end),size:m.size===undefined?undefined:choice(m.size,['small','body','large'] as const),bold:m.bold as boolean|undefined,italic:m.italic as boolean|undefined,underline:m.underline as boolean|undefined,tone:m.tone===undefined?undefined:choice(m.tone,['default','emphasis'] as const)};});}
function imageUrl(value:unknown):string {
 if(value===undefined||value==='')return '';
 const raw=text(value,2000);let url:URL;try{url=new URL(raw);}catch{return fail('이미지 주소를 확인해주세요.');}
 if(url.protocol!=='https:'||url.username||url.password||!/\.(png|jpe?g|webp|avif|gif)$/i.test(url.pathname))fail('HTTPS 이미지 주소(PNG·JPG·WebP·AVIF·GIF)를 입력해주세요.');
 return raw;
}
function fields(value:unknown):InputField[] {
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>10)fail('추가 입력 항목은 최대 10개입니다.');
 const result=(value as unknown[]).map(item=>{const f=object(item);const id=text(f.id,100,true);if(!/^[a-zA-Z0-9_-]+$/.test(id))fail('입력 항목을 확인해주세요.');
 const type=choice(f.type,['text','textarea','number','select'] as const);
 if(typeof f.required!=='boolean'||!Number.isInteger(f.maxLength)||Number(f.maxLength)<1||Number(f.maxLength)>2000)fail('입력 제한을 확인해주세요.');
 const options=Array.isArray(f.options)&&f.options.length<=30?f.options.map(o=>text(o,100,true)):[];
 if(type==='select'&&!options.length)fail('선택지를 입력해주세요.');
 return {id,label:text(f.label,100,true),type,required:f.required as boolean,maxLength:f.maxLength as number,options};});
 if(new Set(result.map(f=>f.id)).size!==result.length)fail('입력 항목이 중복되었습니다.');return result;
}
function consents(value:unknown):import('./consents').ConsentItem[]|undefined {
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>12)fail('동의 항목은 최대 12개입니다.');
 const items=(value as unknown[]).map(v=>{const item=object(v),id=text(item.id,100,true);if(!/^[a-z0-9-]+$/.test(id))fail('동의 항목을 확인해주세요.');if(item.required!==undefined&&typeof item.required!=='boolean')fail('필수 여부를 확인해주세요.');return {id,label:text(item.label,300,true),body:text(item.body,20000),required:item.required!==false};});
 if(new Set(items.map(i=>i.id)).size!==items.length)fail('동의 항목이 중복되었습니다.');return items;
}
function schedule(value:unknown):import('./model').ScheduleItem[]|undefined {
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>12)fail('일정은 최대 12개입니다.');
 const date=(v:unknown)=>{const raw=text(v,10);if(raw&&(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||!Number.isFinite(Date.parse(raw))||new Date(raw).toISOString().slice(0,10)!==raw))fail('일정 날짜를 확인해주세요.');return raw;};
 const items=(value as unknown[]).map(v=>{const i=object(v),start=date(i.start),end=date(i.end);if(end&&(!start||end<start))fail('종료일은 시작일 이후로 입력해주세요.');return {id:text(i.id,100,true),title:text(i.title,100,true),start,end,description:text(i.description,500)};});
 if(new Set(items.map(i=>i.id)).size!==items.length)fail('일정 항목이 중복되었습니다.');return items;
}
function cards(value:unknown):import('./model').InfoCard[]|undefined {
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>12)fail('안내 카드는 최대 12개입니다.');
 const items=(value as unknown[]).map(v=>{const i=object(v);return {id:text(i.id,100,true),title:text(i.title,500),text:text(i.text,1000),description:text(i.description,20000),textSize:i.textSize===undefined?undefined:choice(i.textSize,['small','body','large'] as const),textMarks:marks(i.textMarks,i.text),descriptionSize:i.descriptionSize===undefined?undefined:choice(i.descriptionSize,['small','body','large'] as const),descriptionMarks:marks(i.descriptionMarks,i.description)};});
 if(new Set(items.map(i=>i.id)).size!==items.length)fail('안내 카드가 중복되었습니다.');return items;
}
function inputFields(value:unknown):FormInput[]|undefined {
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>15)fail('입력 항목은 최대 15개입니다.');
 const items=(value as unknown[]).map(v=>{const i=object(v),binding=choice(i.binding,['message','name','phone','email','instagram','extra'] as const),type=choice(i.type,inputTypes(binding));const id=text(i.id,100,true);if(!/^[a-zA-Z0-9_-]+$/.test(id))fail('입력 항목을 확인해주세요.');
 if(typeof i.required!=='boolean')fail('필수 여부를 확인해주세요.');
 if(!Number.isInteger(i.maxLength)||Number(i.maxLength)<1||Number(i.maxLength)>inputLimit(binding))fail('입력 글자 제한을 확인해주세요.');
 const options=Array.isArray(i.options)&&i.options.length<=30?i.options.map(x=>text(x,100,true)):[];if(type==='select'&&!options.length)fail('선택지를 입력해주세요.');
 return {id,binding,type,required:i.required as boolean,maxLength:Number(i.maxLength),label:text(i.label,100,true),placeholder:text(i.placeholder,300),help:text(i.help,1000),options};});
 if(new Set(items.map(i=>i.id)).size!==items.length)fail('입력 항목이 중복되었습니다.');
 return items;
}
function module(value: unknown): PageModule {
  const m = object(value);
  if(m.headerHeight!==undefined&&(!Number.isInteger(m.headerHeight)||Number(m.headerHeight)<40||Number(m.headerHeight)>100))fail('헤더 높이는 40~100vh로 입력해주세요.');
  // Construct an allow-listed object. Never retain arbitrary HTML, CSS or unknown fields.
  return { id: text(m.id, 100, true), type: choice(m.type, Object.keys(moduleNames) as PageModule['type'][]),
    headerHeight:m.headerHeight===undefined?undefined:Number(m.headerHeight),inputFields:inputFields(m.inputFields),cards:cards(m.cards),schedule:schedule(m.schedule),consents:consents(m.consents),imageAssetId:m.imageAssetId===undefined?undefined:text(m.imageAssetId,100,true),fields:fields(m.fields),imageUrl:imageUrl(m.imageUrl),imageAlt:m.imageAlt===undefined?'':text(m.imageAlt,300),
    title: text(m.title, 500), body: text(m.body, 20000),bodySize:m.bodySize===undefined?undefined:choice(m.bodySize,['small','body','large'] as const),bodyMarks:marks(m.bodyMarks,m.body),
    titleSize: choice(m.titleSize, ['h1','h2','h3','h4','body'] as const, 'h3'),
    titleTone: choice(m.titleTone, ['default','emphasis'] as const, 'emphasis'),
    bodyTone: choice(m.bodyTone, ['default','emphasis'] as const, 'default') };
}
/** Server and editor share limits. IDs, status and timestamps are assigned by the server. */
export function validateDraft(value: unknown, id: string): EventDraft {
  const input = object(value), pages = object(input.pages);
  const slug = text(input.slug, 64, true);
  if (!validSlug(slug)) fail('주소는 영문 소문자·숫자·하이픈으로 입력해주세요.');
  const privacyPolicy=input.privacyPolicy===undefined?'':text(input.privacyPolicy,20000);
  const contactUrl=input.contactUrl===undefined?'':text(input.contactUrl,2000);
  const retentionDays=input.retentionDays??90;if(![30,90,180,365].includes(Number(retentionDays)))fail('개인정보 보유 기간을 확인해주세요.');
  const maxLength = input.maxLength;
  if (typeof maxLength !== 'number' || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > 1000) fail('글자 수는 1~1000 사이로 설정해주세요.');
  if (typeof input.allowRepeatVotes !== 'boolean') fail('중복 투표 설정을 확인해주세요.');
  const stageOrder = input.stageOrder === undefined ? undefined : Array.isArray(input.stageOrder) && input.stageOrder.length>0 && input.stageOrder.length<=3 ? input.stageOrder.map(stage=>choice(stage,['submission','voting','result'] as const)) : fail('단계를 확인해주세요.');
  if(stageOrder && new Set(stageOrder).size!==stageOrder.length)fail('같은 단계는 한 번만 추가할 수 있습니다.');
  const resultPages = {} as Record<Stage, PageModule[]>;
  for (const stage of ['submission','voting','result'] as const) {
    const blocks = pages[stage];
    if (!Array.isArray(blocks) || blocks.length > 30) fail('페이지당 모듈은 최대 30개입니다.');
    const validated = (blocks as unknown[]).map(module);
    if (new Set(validated.map(m => m.id)).size !== validated.length) fail('모듈이 중복되었습니다.');
    if(validated.filter(m=>m.type==='header-image').length>1)fail('헤더 이미지는 페이지마다 하나만 추가할 수 있습니다.');
    for (const functional of ['form','consent','candidates','result']) {
      if (validated.filter(m => m.type === functional).length > 1) fail('참여 기능은 페이지마다 하나씩만 넣을 수 있습니다.');
    }
    for(const form of validated.filter(m=>m.type==='form'&&m.inputFields)){
      const bindings=form.inputFields!.filter(f=>f.binding!=='extra').map(f=>f.binding).sort();
      const expected=stage==='submission'?['email','message','name','phone']:stage==='voting'?['email','instagram','phone']:[];
      if(JSON.stringify(bindings)!==JSON.stringify(expected))fail('기본 입력 항목을 확인해주세요.');
    }
    resultPages[stage] = validated;
  }
  return { id, slug, title: text(input.title, 100, true), description: text(input.description, 1000),
    template: choice(input.template, ['first-seat','submission','voting']), pages: resultPages,
    browserTitle:input.browserTitle===undefined?undefined:text(input.browserTitle,150),privacyPolicy,contactUrl,retentionDays:Number(retentionDays),stageOrder, visibility: 'draft', updatedAt: new Date().toISOString(), maxLength: resultPages.submission.find(m=>m.type==='form')?.inputFields?.find(f=>f.binding==='message')?.maxLength??maxLength as number,
    allowRepeatVotes: input.allowRepeatVotes as boolean };
}
export function assertPublishable(draft: EventDraft, stage: Stage) {
  const modules = draft.pages[stage];
  if (!modules.some(m => m.type === 'hero')) fail('이벤트 소개를 추가해주세요.');
  if (stage !== 'result' && !modules.some(m => m.type === 'consent')) fail('개인정보 동의를 추가해주세요.');
  const consent=modules.find(m=>m.type==='consent');
  if(stage!=='result'&&consent){const items=consentItems(consent,stage);if(!items.some(i=>i.id==='privacy'))fail('개인정보 동의 항목을 추가해주세요.');if(stage==='submission'&&!items.some(i=>i.id==='work-license'))fail('응모작 활용 동의 항목을 추가해주세요.');}
  if (stage === 'submission' && !modules.some(m => m.type === 'form')) fail('참여자 입력을 추가해주세요.');
  if (stage === 'voting' && !modules.some(m => m.type === 'candidates')) fail('후보·투표를 추가해주세요.');
  if (stage === 'result' && !modules.some(m => m.type === 'result')) fail('최종 결과를 추가해주세요.');
}
