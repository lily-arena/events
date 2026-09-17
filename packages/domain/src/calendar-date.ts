/** A calendar date without timezone conversion; impossible dates are rejected. */
export function validCalendarDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0001-01-01'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function koreaToday(){return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);}
