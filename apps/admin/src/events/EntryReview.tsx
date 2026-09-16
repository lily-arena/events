import {useEffect,useState} from 'react';
import {Button} from '../../../../packages/ui/src';
import {AdminNotice,ReviewStatus} from '../../../../packages/ui/src/AdminStatus';
import {adminRequest as api} from './operations-api';
interface Entry {id:string;message:string;created_at:number;status:string;revision:number;locked:number}
interface Page {entries:Entry[];total:number;page:number;pageSize:number}
const options=[['pending','검토 대기'],['approved','승인'],['rejected','반려'],['candidate','후보']];
const date=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
export function EntryReview({base,revision,onChanged}:{base:string;revision:number;onChanged:()=>Promise<void>}){
 const [status,setStatus]=useState('all'),[input,setInput]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[reload,setReload]=useState(0);
 const [data,setData]=useState<Page|null>(null),[loading,setLoading]=useState(true),[pending,setPending]=useState<Set<string>>(new Set()),[error,setError]=useState('');
 const busy=pending.size>0;
 useEffect(()=>{let active=true;setLoading(true);api<Page>(base+'/review-entries?'+new URLSearchParams({status,q:query,page:String(page)})).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[base,status,query,page,revision,reload]);
 async function review(entry:Entry,next:string){setPending(p=>new Set(p).add(entry.id));setError('');setData(d=>d?{...d,entries:d.entries.map(e=>e.id===entry.id?{...e,status:next}:e)}:d);
  try{const updated=await api<Entry>(base+'/review','POST',{entryId:entry.id,status:next,revision:entry.revision});setData(d=>{if(!d)return d;const hide=status!=='all'&&status!==next;return {...d,total:d.total-(hide?1:0),entries:hide?d.entries.filter(e=>e.id!==entry.id):d.entries.map(e=>e.id===entry.id?{...e,...updated}:e)};});}
  catch(e){setData(d=>d?{...d,entries:d.entries.map(x=>x.id===entry.id?entry:x)}:d);setError(e instanceof Error?e.message:'상태를 변경하지 못했습니다.');}
  finally{setPending(p=>{const n=new Set(p);n.delete(entry.id);return n;});}
 }

 return <section><h2>응모작 심사</h2>
 <form className="review-toolbar" onSubmit={e=>{e.preventDefault();setQuery(input.trim());setPage(1);setReload(n=>n+1);}}>
 <label>상태 필터<select aria-label="상태 필터" value={status} disabled={busy} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">전체보기</option>{options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <label className="review-search">문구 검색<input type="search" maxLength={200} value={input} onChange={e=>setInput(e.target.value)} placeholder="응모 문구 검색"/></label><Button disabled={busy}>검색</Button>
 </form>
 {error&&<AdminNotice tone="error">{error}</AdminNotice>}
 <p aria-live="polite">{loading?'불러오는 중…':`총 ${data?.total??0}건 · 접수일시 최신순 (한국 시간)`}</p>
 <div className="admin-table-scroll" aria-busy={loading}><table className="admin-data-table"><thead><tr><th scope="col">문구</th><th scope="col">접수일시</th><th scope="col">상태</th><th scope="col">상태 변경</th></tr></thead><tbody>
 {data?.entries.map(entry=><tr key={entry.id}><td className="entry-message">{entry.message}</td><td><time dateTime={new Date(entry.created_at).toISOString()}>{date.format(entry.created_at)}</time></td><td><ReviewStatus status={entry.status}/>{pending.has(entry.id)&&<small className="row-saving">저장 중</small>}</td><td>{entry.locked?<span>후보 확정됨</span>:<select aria-label={`${entry.message} 상태 변경`} disabled={pending.has(entry.id)||loading} value={entry.status} onChange={e=>review(entry,e.target.value)}>{options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}</td></tr>)}
 {!loading&&!data?.entries.length&&<tr><td colSpan={4}>조건에 맞는 응모작이 없습니다.</td></tr>}
 </tbody></table></div>
 <div className="review-pagination"><Button disabled={busy||loading||!data||data.page<=1} onClick={()=>setPage((data?.page??1)-1)}>이전</Button><span>{data?.page??1} / {Math.max(1,Math.ceil((data?.total??0)/(data?.pageSize??50)))} 페이지</span><Button disabled={busy||loading||!data||data.page*data.pageSize>=data.total} onClick={()=>setPage((data?.page??1)+1)}>다음</Button></div>
 </section>;
}
