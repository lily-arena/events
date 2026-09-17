/** A calendar date without timezone conversion; impossible dates are rejected. */
export function validCalendarDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0001-01-01'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function koreaToday(){return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);}
export function ageOnDate(birthDate:string,today=koreaToday()){if(!validCalendarDate(birthDate)||!validCalendarDate(today))return -1;const years=Number(today.slice(0,4))-Number(birthDate.slice(0,4));return years-(today.slice(5)<birthDate.slice(5)?1:0);}
export function minimumAgeMessage(age:number){return `만 ${age}세 이상만 참여할 수 있습니다.`;}
