import {useId,useState} from 'react';
import {inputName,inputPattern,type FormInput} from '../../../../packages/event-builder/src/inputs';
function formatPhone(raw:string){const s=raw.replace(/\D/g,'').slice(0,11);return s.length<4?s:s.length<8?`${s.slice(0,3)}-${s.slice(3)}`:`${s.slice(0,3)}-${s.slice(3,s.length-4)}-${s.slice(-4)}`;}
function Field({field}:{field:FormInput}){
 const id=useId(),[value,setValue]=useState('');const instagram=field.type==='instagram'||field.binding==='instagram';
 const update=(raw:string)=>setValue(field.binding==='phone'||field.type==='tel'?formatPhone(raw):instagram?raw.replace(/^@+/,''):raw);
 const common={id,name:inputName(field),value,onChange:(e:{target:{value:string}})=>update(e.target.value),required:field.required,maxLength:field.maxLength,placeholder:field.placeholder,'aria-describedby':field.help?id+'-help':undefined};
 const control=field.type==='textarea'?<textarea {...common}/>:field.type==='select'?<select {...common}><option value="">{field.placeholder||'선택해주세요.'}</option>{field.options.map(option=><option key={option}>{option}</option>)}</select>:<input {...common} type={field.type==='email'?'email':field.type==='tel'?'tel':'text'} inputMode={field.binding==='phone'||field.type==='tel'?'tel':field.type==='number'?'decimal':field.type==='email'?'email':undefined} pattern={inputPattern(field)} autoCapitalize={instagram?'none':undefined} autoComplete={field.binding==='phone'?'tel-national':field.binding==='email'?'email':field.binding==='name'?'name':undefined}/>;
 return <div className={`field ${field.binding==='message'?'sentence-field':''}`}><label htmlFor={id}>{field.label}</label>{instagram?<div className="instagram-input"><span aria-hidden="true">@</span>{control}</div>:control}
 {field.binding==='message'&&<small className="count">{value.length} / {field.maxLength}자</small>}
 {field.help&&<small id={id+'-help'}>{field.help}</small>}</div>;
}
export function ParticipationFields({items}:{items:FormInput[]}){return <>{items.map(field=><Field field={field} key={field.id}/>)}</>;}
