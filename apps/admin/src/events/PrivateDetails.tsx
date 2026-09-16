import type {EventDraft} from '../../../../packages/event-builder/src/model';
import {formInputs} from '../../../../packages/event-builder/src/inputs';
const names:Record<string,string>={name:'이름',phone:'연락처',email:'이메일',instagram:'인스타그램'};
export function privateDetailRows(value:Record<string,unknown>,event:EventDraft){
 const rows=Object.entries(names).flatMap(([key,label])=>typeof value[key]==='string'&&value[key].trim()?[{key,label,value:value[key] as string}]:[]);
 if(value.extra&&typeof value.extra==='object'&&!Array.isArray(value.extra)){
  const fields=Object.entries(event.pages).flatMap(([stage,modules])=>modules.filter(m=>m.type==='form').flatMap(m=>formInputs(m,stage as 'submission'|'voting'|'result',event.maxLength)));
  Object.entries(value.extra).forEach(([key,text])=>{if(typeof text==='string'&&text.trim())rows.push({key:'extra:'+key,label:fields.find(f=>f.binding==='extra'&&f.id===key)?.label??'추가 입력 항목',value:text});});
 }
 return rows;
}
export function PrivateDetails({value,event}:{value:Record<string,unknown>;event:EventDraft}){const rows=privateDetailRows(value,event);return rows.length?<dl className="private-details">{rows.map(row=><div key={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>:<p>저장된 개인정보가 없습니다.</p>;}
