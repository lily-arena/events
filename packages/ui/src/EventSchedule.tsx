import type {ScheduleItem} from '../../event-builder/src/model';
import './event-schedule.css';
export function dateLabel(value:string){const date=new Date(`${value}T00:00:00Z`);return `${value.split('-').join('.')} (${'일월화수목금토'[date.getUTCDay()]})`;}
export function EventSchedule({items}:{items:ScheduleItem[]}) {
 return <ol className="event-schedule">{items.map(item=><li key={item.id}>
  <h3 className={item.titleSize?`card-title text-size-${item.titleSize}`:undefined}>{item.title}</h3>
  <p className="event-schedule-date">{item.start?<><time dateTime={item.start}>{dateLabel(item.start)}</time>{item.end&&item.end!==item.start&&<> – <time dateTime={item.end}>{dateLabel(item.end)}</time></>}</>:'추후 안내'}</p>
  {item.description&&<p className="event-schedule-description">{item.description}</p>}
 </li>)}</ol>;
}
