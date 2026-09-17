import {useEffect,useState} from 'react';
import {Button} from '../../../../packages/ui/src';
import {AdminNotice} from '../../../../packages/ui/src/AdminStatus';
import {monitoringPeriods,monitoringLabel,isTrafficSurging,type EventMonitoringData,type MonitoringPeriod,type MonitoringPoint} from '../../../../packages/domain/src/event-monitoring';
import {adminRequest} from './operations-api';
import './event-monitoring.css';
const number=(n:number)=>n.toLocaleString('ko-KR');
const date=(n:number)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(n);
type Series={key:'views'|'submissions'|'votes';label:string;color:string};
const traffic:Series[]=[{key:'views',label:'페이지 조회수',color:'#2563eb'}];
const submissions:Series[]=[{key:'submissions',label:'응모',color:'#252a34'}];
const votes:Series[]=[{key:'votes',label:'투표',color:'#7493c7'}];
const statusNames={pending:'진행 전',active:'진행 중',paused:'일시 중지',ended:'종료',unused:'사용하지 않는 단계'};
function MonitoringChart({title,description,points,period,series,stageStatus}:{title:string;description:string;stageStatus?:string;points:MonitoringPoint[];period:MonitoringPeriod;series:Series[]}) {
 const [selected,setSelected]=useState<number|null>(null);
 const max=Math.max(4,...points.flatMap(p=>series.map(s=>p[s.key]??0))),ceiling=Math.ceil(max/4)*4;
 const x=(i:number)=>48+i*(684/Math.max(1,points.length-1)),y=(value:number)=>208-value/ceiling*180;
 const active=selected!==null?points[selected]:undefined;
 const available=points.some(p=>series.some(s=>p[s.key]!==null));
 return <section className="monitor-chart"><header><div><h3>{title}{stageStatus&&<span className="monitor-stage-status">{stageStatus}</span>}</h3><p>{description}</p></div><div className="monitor-legend">{series.map(s=><span key={s.key}><i style={{background:s.color}}/>{s.label}</span>)}</div></header>
 {available?<><div className="monitor-chart-scroll"><svg viewBox="0 0 760 246" role="group" aria-label={title}>
 {[0,1,2,3,4].map(n=><g key={n}><line x1="48" x2="732" y1={y(ceiling*n/4)} y2={y(ceiling*n/4)} stroke="#e8eaee"/><text x="36" y={y(ceiling*n/4)+4} textAnchor="end">{number(ceiling*n/4)}</text></g>)}
 {series.map(s=>{let previous=false;const path=points.map((p,i)=>{const value=p[s.key];if(value===null){previous=false;return '';}const segment=`${previous?'L':'M'}${x(i)},${y(value)}`;previous=true;return segment;}).join(' ');return <path key={s.key} d={path} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round"/>;})}
 {series.flatMap(s=>points.map((p,i)=>p[s.key]===null?null:<circle key={s.key+p.at} cx={x(i)} cy={y(p[s.key]!)} r="2.5" fill={s.color}/>))}
 {points.map((p,i)=><g key={p.at}>{(i===0||i===points.length-1||i%Math.ceil(points.length/6)===0)&&<text x={x(i)} y="235" textAnchor="middle">{monitoringLabel(p.at,period)}</text>}<rect className="monitor-chart-hit" x={x(i)-Math.min(14,342/points.length)} y="20" width={Math.min(28,684/points.length)} height="190" fill="transparent" tabIndex={0} role="button" aria-label={`${monitoringLabel(p.at,period,true)}, ${series.map(s=>`${s.label} ${p[s.key]===null?'미수집':number(p[s.key]!)}회`).join(', ')}`} onFocus={()=>setSelected(i)} onBlur={()=>setSelected(null)} onMouseEnter={()=>setSelected(i)} onMouseLeave={()=>setSelected(null)} onClick={()=>setSelected(i)}/></g>)}
 {active&&<line x1={x(selected!)} x2={x(selected!)} y1="20" y2="208" stroke="#9ca3af" strokeDasharray="4 4" pointerEvents="none"/>}
 </svg></div><div className="monitor-chart-detail" aria-live="polite">{active?<><strong>{monitoringLabel(active.at,period,true)}</strong>{series.map(s=><span key={s.key}>{s.label} {active[s.key]===null?'미수집':number(active[s.key]!)}{active[s.key]===null?'':s.key==='views'?'회':'건'}</span>)}</>:<span>그래프에 마우스를 올리거나 선택하면 상세 수치를 볼 수 있습니다.</span>}</div></>:<div className="monitor-empty">페이지 조회수 수집을 시작하면 그래프가 표시됩니다.</div>}
 </section>;
}
export function EventMonitoring({eventId,preview}:{eventId:string;preview?:(period:MonitoringPeriod)=>EventMonitoringData}) {
 const [period,setPeriod]=useState<MonitoringPeriod>('hour'),[data,setData]=useState<EventMonitoringData|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');const load=preview?Promise.resolve(preview(period)):adminRequest<EventMonitoringData>(`events/${eventId}/monitoring?period=${period}`);load.then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'모니터링 정보를 불러오지 못했습니다.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[eventId,period,refresh,preview]);
 const totals=data?.points.reduce((sum,p)=>({views:sum.views+(p.views??0),submissions:sum.submissions+p.submissions,votes:sum.votes+p.votes}),{views:0,submissions:0,votes:0});
 return <div className="event-monitoring"><div className="monitor-heading"><div><h2>모니터링</h2><p>방문과 참여 흐름을 확인하세요.</p></div><Button disabled={loading} onClick={()=>setRefresh(n=>n+1)}>새로고침</Button></div>
 {preview&&<AdminNotice tone="info">화면 검토용 예시 데이터입니다. 실제 운영 수치가 아닙니다.</AdminNotice>}
 <div className="monitor-toolbar"><div className="monitor-periods" aria-label="집계 단위">{(Object.keys(monitoringPeriods) as MonitoringPeriod[]).map(key=><button key={key} type="button" aria-pressed={period===key} onClick={()=>setPeriod(key)}>{monitoringPeriods[key].label}</button>)}</div><span>{monitoringPeriods[period].window} · 한국 시간</span></div>
 {error&&<AdminNotice tone="error">{error} 새로고침해 다시 시도해주세요.</AdminNotice>}{loading&&<p role="status">모니터링 정보를 불러오고 있습니다.</p>}
 {data&&totals&&<>{isTrafficSurging(data.surge)&&<AdminNotice tone="warning"><strong>최근 방문량이 증가했습니다.</strong><p>최근 완료된 15분 {number(data.surge!.current)}회로, 이전 15분 {number(data.surge!.previous)}회 대비 {(data.surge!.current/data.surge!.previous).toFixed(1)}배입니다.</p><small>집계 구간: {date(data.surge!.from)} ~ {date(data.surge!.to)}. 홍보 유입으로도 증가할 수 있습니다. 오류나 공격 여부를 의미하지 않습니다.</small></AdminNotice>}
 <div className="monitor-metrics">{[{label:'페이지 조회수',value:data.trackingStartedAt===null?'—':number(totals.views),unit:'회',help:'새로고침 포함 · 자동 재조회 제외'},{label:'응모 완료',value:number(totals.submissions),unit:'건',help:'접수가 완료된 응모작'},{label:'투표 완료',value:number(totals.votes),unit:'건',help:'정상 접수된 투표'}].map(m=><section key={m.label}><h3>{m.label}</h3><p><strong>{m.value}</strong><span>{m.unit}</span></p><small>{m.help}</small></section>)}</div>
 <MonitoringChart key={period+'views'} title="페이지 조회수" description="페이지가 열린 횟수입니다. 순방문자 수와는 다르며, 차단된 계측 요청은 제외될 수 있습니다." points={data.points} period={period} series={traffic}/>
 <MonitoringChart key={period+'submissions'} title="응모 현황" stageStatus={statusNames[data.stageStatus.submission]} description="응모 접수 완료 시각을 기준으로 집계합니다." points={data.points} period={period} series={submissions}/>
 <MonitoringChart key={period+'votes'} title="투표 현황" stageStatus={statusNames[data.stageStatus.voting]} description="투표 접수 완료 시각을 기준으로 집계합니다." points={data.points} period={period} series={votes}/>
 <details className="monitor-table"><summary>수치로 보기</summary><div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>기간</th><th>조회수</th><th>응모</th><th>투표</th></tr></thead><tbody>{data.points.map(p=><tr key={p.at}><td>{monitoringLabel(p.at,period,true)}</td><td>{p.views===null?'미수집':number(p.views)}</td><td>{number(p.submissions)}</td><td>{number(p.votes)}</td></tr>)}</tbody></table></div></details>
 <div className="monitor-footnote"><p>갱신: {date(data.generatedAt)} · 현재 시간대는 집계 중입니다.</p><p>{data.trackingStartedAt===null?'페이지 조회수 수집 전입니다.':`페이지 조회수 수집 시작: ${date(data.trackingStartedAt)}. 이전 조회수는 제공되지 않습니다.`} 서버 요금제 사용량과는 별도입니다.</p><p>급증 안내: 최근 완료된 15분 조회수 100회 이상이며, 이전 15분 대비 3배 이상일 때 표시합니다. 비교 구간이 0회이면 배율 안내를 표시하지 않습니다.</p></div>
 </>}
 </div>;
}
