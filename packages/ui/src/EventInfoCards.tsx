import {RichText} from './RichText';
import type {InfoCard} from '../../event-builder/src/model';
import './event-schedule.css';
export function EventInfoCards({items}:{items:InfoCard[]}) {
 return <div className="event-schedule event-info-cards">{items.map(item=><article className="event-container" key={item.id}>
 {item.title&&<h3>{item.title}</h3>}
 {item.text&&<p className="event-schedule-date"><RichText text={item.text} marks={item.textMarks} size={item.textSize}/></p>}
 {item.description&&<p className="event-schedule-description"><RichText text={item.description} marks={item.descriptionMarks} size={item.descriptionSize}/></p>}
 </article>)}</div>;
}
