import {useRef,useState} from 'react';
import {Button} from '../../../../packages/ui/src';
import {parseFollowerArchives,type FollowerArchive} from '../../../../packages/domain/src/follower-archive';
import {adminRequest as api} from './operations-api';
export interface FollowerMetadata {id:string;export_date:string|null;created_at:number;applied_at:number;count:number}
export const followerDate=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'});
export function FollowerUpload({base,metadata,busy,onBusy,onApplied}:{base:string;metadata:FollowerMetadata|null;busy:boolean;onBusy:(v:boolean)=>void;onApplied:()=>void}){
 const [pending,setPending]=useState<FollowerArchive|null>(null),[message,setMessage]=useState(''),[error,setError]=useState(''),[drag,setDrag]=useState(false);
 const sequence=useRef(0),input=useRef<HTMLInputElement>(null);
 async function read(files:File[]){if(busy||!files.length)return;const version=++sequence.current;setPending(null);setError('');setMessage('팔로워 자료를 확인하고 있습니다…');onBusy(true);try{const result=await parseFollowerArchives(files);if(version!==sequence.current)return;setPending(result);setMessage(`ZIP ${result.files}개에서 팔로워 파일 ${result.parts}개 · 계정 ${result.usernames.length.toLocaleString()}개를 찾았습니다.`);}catch(e){setMessage('');setError(e instanceof Error?e.message:'파일을 확인하지 못했습니다.');}finally{onBusy(false);if(input.current)input.current.value='';}}
 async function apply(){if(!pending||busy)return;onBusy(true);setError('');try{
  const result=await api<{id:string}>(base+'/follower-begin','POST',{exportDate:pending.exportDate,previousId:metadata?.id??null});
  const chunks=Math.ceil(pending.usernames.length/500);
  for(let i=0;i<chunks;i++){setMessage(`팔로워 자료 적용 중 (${i+1}/${chunks})`);await api(base+'/follower-chunk','POST',{uploadId:result.id,position:i,usernames:pending.usernames.slice(i*500,(i+1)*500)});}
  await api(base+'/follower-apply','POST',{uploadId:result.id,chunks,count:pending.usernames.length});setPending(null);setMessage('자료 적용 완료');onApplied();
 }catch(e){setError(e instanceof Error?e.message:'자료를 적용하지 못했습니다.');setMessage('기존 적용 자료는 유지됩니다.');onApplied();}finally{onBusy(false);}}
 return <div className="participant-draw follower-upload"><h3>서울아레나 인스타 팔로우 여부 확인</h3><p>{metadata?<>{metadata.export_date?`${metadata.export_date.replaceAll('-','.')} 내보내기 자료와 대조합니다. (파일명 기준)`:'업로드한 자료와 대조합니다.'}<br/>업로드 {followerDate.format(metadata.created_at)} (한국 시간) · {metadata.count.toLocaleString()}개 계정</>:'파일을 업로드하세요.'}</p>
 <details><summary>팔로워 자료 받는 방법</summary><ol><li>인스타그램 <strong>계정 센터</strong>에서 <strong>내 정보 및 권한</strong>을 선택하세요.</li><li><strong>내 정보 내보내기(다운로드)</strong>에서 <strong>@seoularena.official</strong>을 선택하세요.</li><li><strong>기기로 내보내기</strong>를 선택하세요.</li><li>자료는 <strong>팔로워 및 팔로잉</strong>, 기간은 <strong>전체 기간</strong>, 형식은 <strong>JSON</strong>으로 설정하세요.</li><li>다운로드한 <strong>ZIP을 그대로 선택하거나 아래 영역에 드래그</strong>하세요. 여러 ZIP으로 나뉜 경우 한 번에 모두 올려주세요.</li></ol></details>
 <div className={'follower-dropzone'+(drag?' is-dragging':'')} onDragOver={e=>{e.preventDefault();if(!busy)setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);void read([...e.dataTransfer.files]);}}><strong>다운로드한 ZIP을 여기에 놓으세요</strong><p>압축을 풀지 않아도 팔로워 목록과 파일명의 날짜를 자동으로 확인합니다.</p><input ref={input} aria-label="팔로워 ZIP 파일 업로드" type="file" accept=".zip,application/zip" multiple disabled={busy} onChange={e=>void read([...e.target.files??[]])}/></div>
 {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="follower-error">{error}</p>}<Button disabled={busy||!pending} onClick={()=>void apply()}>자료 적용</Button><p>적용 후 기존 투표자와 새 투표자를 이 자료와 대조합니다. 팔로우 x는 자료에 ID가 없다는 뜻으로, 실시간 상태와 다를 수 있습니다.</p></div>;
}
