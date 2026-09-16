import type {InfoCard} from '../../../../packages/event-builder/src/model';
import {Button} from '../../../../packages/ui/src';
export function InfoCardsEditor({items,onChange}:{items:InfoCard[];onChange:(items:InfoCard[])=>void}) {
 const patch=(index:number,change:Partial<InfoCard>)=>onChange(items.map((item,i)=>i===index?{...item,...change}:item));
 const move=(index:number,offset:number)=>{const next=[...items];[next[index],next[index+offset]]=[next[index+offset]!,next[index]!];onChange(next);};
 return <div>{items.map((item,index)=><fieldset key={item.id}><legend>안내 카드 {index+1}</legend>
 <label className="field">카드 제목<input maxLength={500} value={item.title} onChange={e=>patch(index,{title:e.target.value})}/></label>
 <label className="field">강조 문구<textarea maxLength={1000} value={item.text} onChange={e=>patch(index,{text:e.target.value})}/></label>
 <label className="field">안내 내용<textarea maxLength={20000} value={item.description} onChange={e=>patch(index,{description:e.target.value})}/></label>
 <div className="row"><Button disabled={index===0} onClick={()=>move(index,-1)}>위로</Button><Button disabled={index===items.length-1} onClick={()=>move(index,1)}>아래로</Button><Button onClick={()=>onChange(items.filter((_,i)=>i!==index))}>카드 삭제</Button></div>
 </fieldset>)}<Button disabled={items.length>=12} onClick={()=>onChange([...items,{id:crypto.randomUUID(),title:'새 안내',text:'',description:''}])}>카드 추가</Button></div>;
}
