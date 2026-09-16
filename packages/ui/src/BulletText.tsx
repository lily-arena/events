import React,{type ReactNode} from 'react';
import './bullet-text.css';
type Item={text:string;children:Item[]};
export function BulletText({text,allLines=false}:{text:string;allLines?:boolean}){
 const blocks:ReactNode[]=[];let roots:Item[]=[];let stack:Item[]=[];
 const flush=()=>{if(roots.length){blocks.push(<ul key={blocks.length}>{render(roots)}</ul>);roots=[];stack=[];}};
 const render=(items:Item[]):ReactNode=>items.map((item,i)=><li key={i}>{item.text}{item.children.length>0&&<ul>{render(item.children)}</ul>}</li>);
 for(const line of text.split('\n')){
  if(!line.trim()){flush();continue;}
  const bullet=/^[ \t]*(?:[-*•◦○])[ \t]+/.test(line),indent=/^[ \t]+/.test(line);
  if(allLines||bullet||indent){const prefix=line.match(/^[ \t]*/)?.[0]??'';const requested=Math.floor(prefix.replace(/\t/g,'  ').length/2);const depth=Math.min(requested,stack.length,3);const item:Item={text:line.trim().replace(/^[-*•◦○][ \t]+/,''),children:[]};if(depth===0)roots.push(item);else stack[depth-1]!.children.push(item);stack=stack.slice(0,depth);stack.push(item);}
  else{flush();blocks.push(<p key={blocks.length}>{line}</p>);}
 }
 flush();return <div className="bullet-text">{blocks}</div>;
}
