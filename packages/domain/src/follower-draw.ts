export type FollowStatus='unknown'|'following'|'not_following';
export function normalizeInstagram(value:unknown):string {
 if(typeof value!=='string')throw new Error('팔로워 계정명 형식을 확인해주세요.');
 const name=value.normalize('NFKC').trim().replace(/^@/,'').toLowerCase();
 if(!/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(name))throw new Error('팔로워 계정명 형식을 확인해주세요.');
 return name;
}
export function weightUnits(value:number):number {
 if(!Number.isFinite(value)||value<1||value>100||Math.abs(value*10-Math.round(value*10))>1e-8)throw new Error('가중치는 1~100배, 소수점 한 자리까지 입력해주세요.');
 return Math.round(value*10);
}
export function randomBelow(n:number):number {
 if(!Number.isSafeInteger(n)||n<1||n>4294967296)throw new Error('추첨 대상이 너무 많습니다.');
 const limit=4294967296-4294967296%n;let r:number;
 do{r=crypto.getRandomValues(new Uint32Array(1))[0]!;}while(r>=limit);
 return r%n;
}
/** Sequential weighted sampling without replacement; previous draws do not affect the pool. */
export function weightedDraw<T extends {follow_status?:string}>(rows:T[],count:number,multiplier:number,random=randomBelow):T[]{
 const units=weightUnits(multiplier);
 if(!Number.isSafeInteger(count)||count<1||count>100||count>rows.length)throw new Error('추첨 인원을 확인해주세요.');
 const pool=rows.map(row=>({row,weight:row.follow_status==='following'?units:10})),winners:T[]=[];
 let total=pool.reduce((n,p)=>n+p.weight,0);
 for(let i=0;i<count;i++){let target=random(total);for(let j=0;j<pool.length;j++){const item=pool[j]!;if(target<item.weight){winners.push(item.row);total-=item.weight;pool.splice(j,1);break;}target-=item.weight;}}
 return winners;
}
