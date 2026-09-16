/** Only a completion marker is stored; contact details never enter browser storage. */
export function voteCompletionKey(eventId:string,stageId:string,round:number){return `arena-vote-complete:${eventId}:${stageId}:${round}`;}
export function hasCompletedVote(key:string){try{return localStorage.getItem(key)==='1';}catch{return false;}}
export function rememberCompletedVote(key:string){try{localStorage.setItem(key,'1');}catch{/* Server identity checks still apply if storage is unavailable. */}}
