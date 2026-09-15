import type {ScheduleItem} from '../../../../packages/event-builder/src/model';
import {Button} from '../../../../packages/ui/src';
export function ScheduleEditor({items,onChange}:{items:ScheduleItem[];onChange:(items:ScheduleItem[])=>void}) {
 const patch=(index:number,change:Partial<ScheduleItem>)=>onChange(items.map((item,i)=>i===index?{...item,...change}:item));
 const move=(index:number,offset:number)=>{const next=[...items];[next[index],next[index+offset]]=[next[index+offset]!,next[index]!];onChange(next);};
 return <div><p>화면에 표시할 일정입니다. 실제 접수·투표 기간은 운영 → 공개·일정에서 설정해주세요.</p>{items.map((item,index)=><fieldset key={item.id}><legend>일정 {index+1}</legend>
 <label className="field">일정명<input maxLength={100} value={item.title} onChange={e=>patch(index,{title:e.target.value})}/></label>
 <label className="field">시작일<input type="date" value={item.start} onChange={e=>patch(index,{start:e.target.value})}/></label>
 <label className="field">종료일<input type="date" min={item.start||undefined} value={item.end} onChange={e=>patch(index,{end:e.target.value})}/></label>
 <small>하루 일정은 시작일만 입력합니다. 날짜가 없으면 ‘추후 안내’로 표시됩니다.</small>
 <label className="field">안내 문구<textarea maxLength={500} value={item.description} onChange={e=>patch(index,{description:e.target.value})} placeholder="오후 6시 마감 등"/></label>
 <Button disabled={index===0} onClick={()=>move(index,-1)}>위로</Button><Button disabled={index===items.length-1} onClick={()=>move(index,1)}>아래로</Button><Button onClick={()=>onChange(items.filter((_,i)=>i!==index))}>일정 삭제</Button>
 </fieldset>)}<Button disabled={items.length>=12} onClick={()=>onChange([...items,{id:crypto.randomUUID(),title:'새 일정',start:'',end:'',description:''}])}>일정 추가</Button></div>;
}
