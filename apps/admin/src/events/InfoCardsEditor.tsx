import type {TextSize} from '../../../../packages/event-builder/src/model';
import {RichTextEditor} from './RichTextEditor';
import type {InfoCard} from '../../../../packages/event-builder/src/model';
import {Button} from '../../../../packages/ui/src';
export function InfoCardsEditor({items,onChange}:{items:InfoCard[];onChange:(items:InfoCard[])=>void}) {
 const patch=(index:number,change:Partial<InfoCard>)=>onChange(items.map((item,i)=>i===index?{...item,...change}:item));
 const move=(index:number,offset:number)=>{const next=[...items];[next[index],next[index+offset]]=[next[index+offset]!,next[index]!];onChange(next);};
 return <div>{items.map((item,index)=><fieldset key={item.id}><legend>안내 카드 {index+1}</legend>
 <label className="field">카드 제목<input maxLength={500} value={item.title} onChange={e=>patch(index,{title:e.target.value})}/></label>
 <label className="field">카드 제목 크기<select aria-label="카드 제목 크기" value={item.titleSize??''} onChange={e=>patch(index,{titleSize:(e.target.value||undefined) as TextSize|undefined})}><option value="">기본 크기</option><option value="h1">H1 · 가장 크게</option><option value="h2">H2 · 크게</option><option value="h3">H3 · 중간</option><option value="h4">H4 · 작게</option><option value="body">본문 크기</option></select></label>
 <RichTextEditor label="강조 문구" value={item.text} size={item.textSize} marks={item.textMarks} onChange={(text,textMarks,textSize)=>patch(index,{text,textMarks,textSize})}/>
 <RichTextEditor label="안내 내용" value={item.description} size={item.descriptionSize??'small'} marks={item.descriptionMarks} onChange={(description,descriptionMarks,descriptionSize)=>patch(index,{description,descriptionMarks,descriptionSize})}/>
 <div className="row"><Button disabled={index===0} onClick={()=>move(index,-1)}>위로</Button><Button disabled={index===items.length-1} onClick={()=>move(index,1)}>아래로</Button><Button onClick={()=>onChange(items.filter((_,i)=>i!==index))}>카드 삭제</Button></div>
 </fieldset>)}<Button disabled={items.length>=12} onClick={()=>onChange([...items,{id:crypto.randomUUID(),title:'새 안내',text:'',description:''}])}>카드 추가</Button></div>;
}
