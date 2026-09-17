export interface PublicState {revision:number;id:string;kind:string;round:number;accepting:number;starts_at:number|null;ends_at:number|null}
export const nextRefreshDelay=()=>60000+Math.floor(Math.random()*5000);
export function readBootstrap<T extends {event:{slug:string};stage:unknown;revision:number}>(slug:string):T|null {
 try{const value=JSON.parse(document.getElementById('event-bootstrap')?.textContent??'null');return value?.event?.slug===slug&&value.stage&&typeof value.revision==='number'?value:null;}catch{return null;}
}
