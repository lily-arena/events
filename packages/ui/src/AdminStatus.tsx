import type {ReactNode} from 'react';
import './admin-status.css';
export type AdminTone='success'|'error'|'warning'|'info';
export function AdminNotice({tone='info',children}:{tone?:AdminTone;children:ReactNode}){return <div className={`admin-notice admin-tone-${tone}`} role={tone==='error'?'alert':'status'}><strong>{({success:'완료',error:'오류',warning:'확인 필요',info:'안내'})[tone]}</strong><div>{children}</div></div>;}
export function ReviewStatus({status}:{status:string}){const values:Record<string,[AdminTone,string]>={pending:['warning','검토 대기'],approved:['success','승인'],rejected:['error','반려'],candidate:['info','후보']};const [tone,label]=values[status]??['info',status];return <span className={`admin-status-badge admin-tone-${tone}`}>{label}</span>;}
