import {RichText} from './RichText';
import type {TextMark,BodySize} from '../../event-builder/src/rich-text';
import React,{type ReactNode} from 'react';
import './bullet-text.css';
type Item={text:string;offset:number;children:Item[]};
export function BulletText({text,allLines=false,marks=[],size}:{text:string;allLines?:boolean;marks?:TextMark[];size?:BodySize}){
 let offset=0;
 const blocks:ReactNode[]=[];let roots:Item[]=[];let stack:Item[]=[];
 const flush=()=>{if(roots.length){blocks.push(<ul key={blocks.length}>{render(roots)}</ul>);roots=[];stack=[];}};
 const render=(items:Item[]):ReactNode=>items.map((item,i)=><li key={i}>{<RichText text={item.text} size={size} marks={marks.filter(m=>m.end>item.offset&&m.start<item.offset+item.text.length).map(m=>({...m,start:Math.max(0,m.start-item.offset),end:Math.min(item.text.length,m.end-item.offset)}))}/>}{item.children.length>0&&<ul>{render(item.children)}</ul>}</li>);
 for(const line of text.split('\n')){
  const lineOffset=offset;offset+=line.length+1;
  if(!line.trim()){flush();continue;}
  const bullet=/^[ \t]*(?:[-*•◦○])[ \t]+/.test(line),indent=/^[ \t]+/.test(line);
  if(allLines||bullet||indent){const prefix=line.match(/^[ \t]*/)?.[0]??'';const requested=Math.floor(prefix.replace(/\t/g,'  ').length/2);const depth=Math.min(requested,stack.length,3);const content=line.trim().replace(/^[-*•◦○][ \t]+/,'');const item:Item={text:content,offset:lineOffset+line.indexOf(content),children:[]};if(depth===0)roots.push(item);else stack[depth-1]!.children.push(item);stack=stack.slice(0,depth);stack.push(item);}
  else{flush();blocks.push(<p key={blocks.length}>{line}</p>);}
 }
 flush();return <div className="bullet-text">{blocks}</div>;
}
