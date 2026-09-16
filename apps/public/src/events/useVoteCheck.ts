import {useEffect,useState} from 'react';
import {validateParticipant} from '../../../../packages/security/src/event-participant';
export const duplicateVoteMessage='이미 투표에 사용된 참여 정보가 있습니다.';
export function voteCheckValues(fields:FormData){
 const values:Record<string,string>={};
 for(const field of ['phone','email','instagram'] as const){
  try{const p=validateParticipant({[field]:fields.get(field)??''},true,[]);if(p[field])values[field]=p[field];}catch{/* Check each complete, valid identifier independently while typing. */}
 }
 return values;
}
export function useVoteCheck(check:((values:Record<string,string>)=>Promise<boolean>)|undefined){
 const [snapshot,setSnapshot]=useState('{}'),[retry,setRetry]=useState(0);
 const [result,setResult]=useState<{snapshot:string;status:'clear'|'duplicate'|'error'|'checking'}>({snapshot:'{}',status:'clear'});
 useEffect(()=>{
  if(!check||snapshot==='{}')return;
  let current=true;setResult({snapshot,status:'checking'});
  const timer=setTimeout(()=>{check(JSON.parse(snapshot)).then(duplicate=>{if(current)setResult({snapshot,status:duplicate?'duplicate':'clear'});}).catch(()=>{if(current)setResult({snapshot,status:'error'});});},650);
  return()=>{current=false;clearTimeout(timer);};
 },[snapshot,retry,check]);
 const status=!check||snapshot==='{}'?'clear':result.snapshot!==snapshot?'checking':result.status;
 return {status,update:(fields:FormData)=>setSnapshot(JSON.stringify(voteCheckValues(fields))),retry:()=>{setResult({snapshot,status:'checking'});setRetry(n=>n+1);},markDuplicate:()=>setResult({snapshot,status:'duplicate'})};
}
