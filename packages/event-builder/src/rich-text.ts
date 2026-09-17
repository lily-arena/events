export type BodySize='small'|'body'|'large';
export interface TextMark {start:number;end:number;size?:BodySize;bold?:boolean;italic?:boolean;underline?:boolean;tone?:'default'|'emphasis'}
export function rebaseMarks(before:string,after:string,marks:TextMark[]=[]):TextMark[]{let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;let tail=0;while(tail<before.length-start&&tail<after.length-start&&before[before.length-1-tail]===after[after.length-1-tail])tail++;const end=before.length-tail,delta=after.length-before.length;return marks.flatMap(m=>m.end<=start?[m]:m.start>=end?[{...m,start:m.start+delta,end:m.end+delta}]:[]);}
export function applyMark(marks:TextMark[],start:number,end:number,style:Omit<TextMark,'start'|'end'>):TextMark[]{
 const points=[...new Set([start,end,...marks.flatMap(m=>[m.start,m.end])])].sort((a,b)=>a-b);const result:TextMark[]=[];
 for(let i=0;i<points.length-1;i++){const a=points[i]!,b=points[i+1]!,old=marks.find(m=>m.start<=a&&m.end>=b);const {start:_,end:__,...previous}=old??{start:a,end:b};const applied=a>=start&&b<=end?(Object.keys(style).length?{...previous,...style}:{}):previous;if(Object.values(applied).some(v=>v!==undefined))result.push({start:a,end:b,...applied});}return result;
}
