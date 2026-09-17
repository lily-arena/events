import {useState} from 'react';
import {Button} from '../../../../packages/ui/src';
import {adminRequest as api} from './operations-api';
export function EntryComment({base,id,initial,revision,onSaved}:{base:string;id:string;initial:string;revision:number;onSaved:(value:{review_comment:string;comment_revision:number})=>void}){
 const [text,setText]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){if(busy||text===initial)return;setBusy(true);setError('');try{onSaved(await api(base+'/comment','POST',{entryId:id,comment:text,revision}));}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.');}finally{setBusy(false);}}
 return <div className="entry-comment"><textarea aria-label="심사 코멘트" rows={2} maxLength={300} value={text} disabled={busy} onChange={e=>setText(e.target.value)} placeholder="짧은 코멘트 (최대 300자)"/><Button kind="small" disabled={busy||text===initial} onClick={save}>{busy?'저장 중':'저장'}</Button>{error&&<small role="alert">{error}</small>}</div>;
}
