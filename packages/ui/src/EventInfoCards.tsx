import type {InfoCard} from '../../event-builder/src/model';
import './event-schedule.css';
export function EventInfoCards({items}:{items:InfoCard[]}) {
 return <div className="event-schedule event-info-cards">{items.map(item=><article className="event-container" key={item.id}>
 {item.title&&<h3>{item.title}</h3>}
 {item.text&&<p className="event-schedule-date">{item.text}</p>}
 {item.description&&<p className="event-schedule-description">{item.description}</p>}
 </article>)}</div>;
}
