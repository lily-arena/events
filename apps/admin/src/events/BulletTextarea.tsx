import {useLayoutEffect,useRef,type TextareaHTMLAttributes} from 'react';
type Props=Omit<TextareaHTMLAttributes<HTMLTextAreaElement>,'onChange'|'value'>&{value:string;onValueChange:(value:string)=>void};
export function BulletTextarea({value,onValueChange,...props}:Props){const ref=useRef<HTMLTextAreaElement>(null),selection=useRef<[number,number]|null>(null);useLayoutEffect(()=>{if(selection.current){ref.current?.setSelectionRange(...selection.current);selection.current=null;}},[value]);return <textarea {...props} ref={ref} value={value} onChange={e=>onValueChange(e.target.value)} onKeyDown={e=>{
 if(e.key!=='Tab'||e.altKey||e.ctrlKey||e.metaKey)return;
 const el=e.currentTarget,start=el.selectionStart,end=el.selectionEnd,lineStart=value.lastIndexOf('\n',start-1)+1;
 const stop=end>start&&value[end-1]==='\n'?end-1:end;const lineEnd=value.indexOf('\n',stop);const finish=lineEnd<0?value.length:lineEnd;
 const chunk=value.slice(lineStart,finish);if(!chunk.trim())return;
 const lines=chunk.split('\n');if(e.shiftKey&&!lines.some(line=>/^(\t| {2})/.test(line)))return;
 e.preventDefault();let delta=0;const changed=lines.map(line=>{if(e.shiftKey){const next=line.replace(/^(\t| {2})/,'');delta+=next.length-line.length;return next;}delta++;return '\t'+line;}).join('\n');
 const firstDelta=e.shiftKey?changed.split('\n')[0]!.length-lines[0]!.length:1;
 selection.current=[Math.max(lineStart,start+firstDelta),Math.max(lineStart,end+delta)];onValueChange(value.slice(0,lineStart)+changed+value.slice(finish));
 }}/>;}
