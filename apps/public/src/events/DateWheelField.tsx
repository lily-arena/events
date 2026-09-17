import {useEffect,useLayoutEffect,useRef,useState,useId} from 'react';
import {Modal,Button} from '../../../../packages/ui/src';
import {koreaToday} from '../../../../packages/domain/src/calendar-date';
import './date-wheel.css';
const rowHeight=44;
function Wheel({label,values,value,onChange}:{label:string;values:number[];value:number;onChange:(v:number)=>void}){
 const ref=useRef<HTMLDivElement>(null),timer=useRef<ReturnType<typeof setTimeout>>(),id=useId();
 useLayoutEffect(()=>{const el=ref.current;if(el)el.scrollTop=Math.max(0,values.indexOf(value))*rowHeight;},[value,values.length]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const choose=(index:number)=>onChange(values[Math.max(0,Math.min(values.length-1,index))]!);
 return <div className="date-wheel-column"><div ref={ref} className="date-wheel" role="listbox" aria-label={label} aria-activedescendant={`${id}-${value}`} tabIndex={0} onKeyDown={e=>{const index=values.indexOf(value);if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();choose(e.key==='Home'?0:e.key==='End'?values.length-1:index+(e.key==='ArrowDown'?1:-1));}}} onScroll={()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>{if(ref.current)choose(Math.round(ref.current.scrollTop/rowHeight));},100);}}>{values.map(n=><div key={n} id={`${id}-${n}`} role="option" aria-selected={n===value} className="date-wheel-option" onClick={()=>onChange(n)}>{n}{label==='연'?'년':label}</div>)}</div></div>;
}
export function DateWheelField({id,name,label,value,required,birthDate,error,describedBy,onChange,onInvalid}:{id:string;name:string;label:string;value:string;required:boolean;birthDate:boolean;error:string;describedBy?:string;onChange:(v:string)=>void;onInvalid:()=>void}){
 const [open,setOpen]=useState(false),today=koreaToday(),currentYear=Number(today.slice(0,4));
 const [parts,setParts]=useState([currentYear-20,1,1]);const validation=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [year,month,day]=parts as [number,number,number];const days=new Date(Date.UTC(year,month,0)).getUTCDate();
 const selected=`${year}-${String(month).padStart(2,'0')}-${String(Math.min(day,days)).padStart(2,'0')}`;
 useEffect(()=>{validation.current?.setCustomValidity(error);},[error]);
 const show=()=>{setParts((value||`${currentYear-20}-01-01`).split('-').map(Number));setOpen(true);};
 const update=(index:number,n:number)=>setParts(old=>{const next=[...old];next[index]=n;next[2]=Math.min(next[2]!,new Date(Date.UTC(next[0]!,next[1]!,0)).getUTCDate());return next;});
 return <div className="date-wheel-field"><button ref={trigger} id={id} type="button" className="date-wheel-trigger" data-empty={!value} aria-haspopup="dialog" aria-invalid={!!error} aria-describedby={describedBy} onClick={show}><span>{value?`${Number(value.slice(0,4))}년 ${Number(value.slice(5,7))}월 ${Number(value.slice(8,10))}일`:'연도 / 월 / 일'}</span><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/></svg></button>
 <input ref={validation} className="date-wheel-validation" tabIndex={-1} aria-hidden="true" name={name} value={value} required={required} onChange={()=>{}} onInvalid={e=>{e.preventDefault();onInvalid();trigger.current?.focus();if(!value)show();}}/>
 <Modal open={open} onOpenChange={setOpen} title={label+' 선택'} hideCloseButton className="date-wheel-dialog"><div className="date-wheels"><Wheel label="연" values={Array.from({length:birthDate?131:151},(_,i)=>currentYear-130+i)} value={year} onChange={n=>update(0,n)}/><Wheel label="월" values={Array.from({length:12},(_,i)=>i+1)} value={month} onChange={n=>update(1,n)}/><Wheel label="일" values={Array.from({length:days},(_,i)=>i+1)} value={Math.min(day,days)} onChange={n=>update(2,n)}/></div><div className="date-wheel-actions"><Button disabled={birthDate&&selected>today} onClick={()=>{onChange(selected);setOpen(false);}}>선택 완료</Button></div></Modal></div>;
}
