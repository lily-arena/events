import {createRoot} from 'react-dom/client';
import AdminPreview from '../../admin/src/events/AdminPreview';
import {firstSeat,type EventDraft} from '../../../packages/event-builder/src/model';
import '../../../packages/ui/src/tokens.css';
const event:EventDraft={...structuredClone(firstSeat),homeActive:false,updatedAt:'2026-09-29T08:36:55.545Z'};
const unchanged=async(draft:EventDraft)=>draft;
createRoot(document.getElementById('root')!).render(<><div style={{padding:'8px 20px',background:'#eef2f7',color:'#616975',fontSize:12,textAlign:'right'}}>대시보드 시안 · 변경 내용은 운영에 저장되지 않습니다.</div><AdminPreview storage={{initialEvents:[event],account:'lily.arena@seoularena.net',save:unchanged,create:unchanged,setHomeActive:async(draft,active)=>({...draft,homeActive:active})}}/></>);
