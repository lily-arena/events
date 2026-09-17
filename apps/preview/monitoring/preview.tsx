import {createRoot} from 'react-dom/client';
import '../../../packages/ui/src/tokens.css';
import AdminPreview from '../../admin/src/events/AdminPreview';
import {EventMonitoring} from '../../admin/src/events/EventMonitoring';
import {firstSeat} from '../../../packages/event-builder/src/model';
import {monitoringStart,monitoringPeriods,type MonitoringPeriod,type EventMonitoringData} from '../../../packages/domain/src/event-monitoring';
function sample(period:MonitoringPeriod):EventMonitoringData {
 const now=Date.UTC(2026,8,17,7,45),from=monitoringStart(period,now),config=monitoringPeriods[period];
 const points=Array.from({length:config.count},(_,i)=>{const views=Math.round((period==='hour'?40:period==='day'?900:4200)*(1+i/config.count)+Math.pow(Math.sin(i*.65),2)*(period==='hour'?110:period==='day'?2400:15000));return {at:from+i*config.step,views:period==='week'&&i<3?null:views,submissions:Math.round(views*.045),votes:Math.round(views*.12)};});
 return {period,stageStatus:{submission:'ended',voting:'active'},from,to:now,generatedAt:now,trackingStartedAt:Date.UTC(2026,6,20),points,surge:{current:324,previous:92,from:now-900000,to:now}};
}
createRoot(document.getElementById('root')!).render(<AdminPreview initialOperationSection="monitoring" storage={{initialEvents:[firstSeat],account:'화면 검토용',local:false,save:async d=>d,create:async d=>d,operations:(event,section)=><div className="operations-panel"><h1>{event.title} 운영</h1>{section==='monitoring'?<EventMonitoring eventId={event.id} preview={sample}/>:<p>왼쪽 ‘모니터링’에서 새 화면을 확인해주세요.</p>}</div>}}/>);
