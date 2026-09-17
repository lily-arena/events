import {koreaToday} from '../../../../packages/domain/src/calendar-date';
import {useId,useState} from 'react';
import {inputName,inputPattern,type FormInput} from '../../../../packages/event-builder/src/inputs';
function formatPhone(raw:string){const s=raw.replace(/\D/g,'').slice(0,11);return s.length<4?s:s.length<8?`${s.slice(0,3)}-${s.slice(3)}`:`${s.slice(0,3)}-${s.slice(3,s.length-4)}-${s.slice(-4)}`;}
function Field({field}:{field:FormInput}){
 const id=useId(),[value,setValue]=useState(''),[touched,setTouched]=useState(false),[invalid,setInvalid]=useState(false);const instagram=field.type==='instagram'||field.binding==='instagram';
 const update=(raw:string)=>setValue(field.binding==='phone'||field.type==='tel'?formatPhone(raw):instagram?raw.replace(/^@+/,''):raw);
 const formatMessage=field.binding==='phone'||field.type==='tel'?'연락처 형식을 확인해주세요.':field.binding==='email'||field.type==='email'?'이메일 형식을 확인해주세요.':'';
 const error=touched&&invalid&&value.trim()?formatMessage:'';
 const inspect=(el:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement)=>setInvalid(el.validity.typeMismatch||el.validity.patternMismatch);
 const common={id,name:inputName(field),value,onChange:(e:{target:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement})=>{update(e.target.value);inspect(e.target);},onBlur:(e:{target:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement})=>{setTouched(true);inspect(e.target);},onInvalid:(e:{currentTarget:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement})=>{setTouched(true);inspect(e.currentTarget);},'aria-invalid':error?true:undefined,required:field.required,maxLength:field.maxLength,placeholder:field.placeholder,'aria-describedby':[error?id+'-error':undefined,field.help?id+'-help':undefined].filter(Boolean).join(' ')||undefined};
 const control=field.type==='textarea'?<textarea {...common}/>:field.type==='select'?<select {...common}><option value="">{field.placeholder||'선택해주세요.'}</option>{field.options.map(option=><option key={option}>{option}</option>)}</select>:<input {...common} type={field.type==='email'?'email':field.type==='tel'?'tel':field.type==='date'?'date':'text'} min={field.type==='date'?'0001-01-01':undefined} max={field.binding==='birthDate'?koreaToday():undefined} inputMode={field.binding==='phone'||field.type==='tel'?'tel':field.type==='number'?'decimal':field.type==='email'?'email':undefined} pattern={inputPattern(field)} autoCapitalize={instagram?'none':undefined} autoComplete={field.binding==='phone'?'tel-national':field.binding==='email'?'email':field.binding==='name'?'name':undefined}/>;
 return <div className={`field ${field.binding==='message'?'sentence-field':''}`}><div className="field-heading"><label htmlFor={id}>{field.label}{!field.required&&' (선택)'}</label>{field.binding==='message'&&<small className="count">{value.length} / {field.maxLength}자</small>}</div>{instagram?<div className="instagram-input"><span aria-hidden="true">@</span>{control}</div>:control}
 {error&&<small className="field-error" id={id+'-error'} aria-live="polite">{error}</small>}
 {field.help&&<small id={id+'-help'}>{field.help}</small>}</div>;
}
export function ParticipationFields({items}:{items:FormInput[]}){return <>{items.map(field=><Field field={field} key={field.id}/>)}</>;}
