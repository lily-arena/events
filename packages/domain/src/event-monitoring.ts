export type MonitoringPeriod = 'hour' | 'day' | 'week';
export type MonitoringStageStatus='pending'|'active'|'paused'|'ended'|'unused';
export interface MonitoringPoint { at:number; views:number|null; submissions:number; votes:number }
export interface EventMonitoringData {
 period:MonitoringPeriod; from:number; to:number; generatedAt:number; trackingStartedAt:number|null;
 points:MonitoringPoint[];
 stageStatus:{submission:MonitoringStageStatus;voting:MonitoringStageStatus};
 surge:{current:number;previous:number;from:number;to:number}|null;
}
export const monitoringPeriods = {
 hour:{label:'시간별',window:'최근 24시간',count:24,step:3600000},
 day:{label:'일별',window:'최근 30일',count:30,step:86400000},
 week:{label:'주간별',window:'최근 12주',count:12,step:604800000},
} as const;
const offset=9*3600000;
export function monitoringStart(period:MonitoringPeriod,now:number):number {
 const {step,count}=monitoringPeriods[period];
 const anchor=period==='week'?Date.UTC(1970,0,5)-offset:-offset;
 return Math.floor((now-anchor)/step)*step+anchor-(count-1)*step;
}
export function monitoringLabel(at:number,period:MonitoringPeriod,full=false):string {
 const date=new Date(at+offset),day=`${date.getUTCMonth()+1}.${date.getUTCDate()}`;
 return period==='hour'?`${full?day+' ':''}${String(date.getUTCHours()).padStart(2,'0')}시`:day+(period==='week'?' 주':'');
}
export function isTrafficSurging(surge:EventMonitoringData['surge']):boolean {
 return !!surge&&surge.current>=100&&surge.previous>0&&surge.current>=surge.previous*3;
}
