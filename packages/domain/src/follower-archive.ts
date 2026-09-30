import {normalizeInstagram} from './follower-draw';
// Read only follower JSON entries; never extract archive paths to disk.
async function followerFiles(file:File) {
  if (!/\.zip$/i.test(file.name) || file.size > 50 * 1024 * 1024) throw Error('50MB 이하의 ZIP 파일을 선택해주세요.');
  const buffer = await file.arrayBuffer(), view = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === buffer.byteLength) { end = i; break; }
  }
  if (end < 0) throw Error('올바른 ZIP 파일이 아닙니다.');
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count === 65535 || count > 10000) throw Error('이 ZIP 형식은 지원하지 않습니다.');
  let cursor = view.getUint32(end + 16, true), total = 0;
  const output:{name:string;text:string}[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw Error('ZIP 목록이 손상되었습니다.');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true), crc = view.getUint32(cursor + 16, true);
    const name = new TextDecoder().decode(buffer.slice(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extra + comment;
    if (!/(^|\/)followers(?:_\d+)?\.json$/i.test(name) || name.startsWith('__MACOSX/')) continue;
    total += size;
    if (flags & 1 || ![0,8].includes(method) || size > 20*1024*1024 || total > 50*1024*1024) throw Error('암호화되었거나 처리 가능한 크기를 초과한 ZIP입니다.');
    if (view.getUint32(offset, true) !== 0x04034b50) throw Error('ZIP 파일이 손상되었습니다.');
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (start + compressed > buffer.byteLength) throw Error('ZIP 파일이 잘렸습니다.');
    let stream = new Blob([buffer.slice(start, start + compressed)]).stream();
    if (method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader(), chunks:Uint8Array<ArrayBuffer>[] = []; let actual = 0;
    while (true) { const {value,done} = await reader.read(); if (done) break; actual += value.length; if (actual > size) { await reader.cancel(); throw Error('ZIP 크기 정보가 올바르지 않습니다.'); } chunks.push(value); }
    if (actual !== size) throw Error('ZIP 파일 크기가 일치하지 않습니다.');
    const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());
    if(crc32(bytes)!==crc)throw Error('ZIP 파일이 손상되었습니다. 다시 다운로드해주세요.');
    output.push({name,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});
  }
  if (!output.length) throw Error('팔로워 JSON 파일이 없습니다. 내보내기 형식을 JSON으로 선택해주세요.');
  return output;
}

function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export interface FollowerArchive {usernames:string[];exportDate:string|null;parts:number;files:number}
export async function parseFollowerArchives(files:File[]):Promise<FollowerArchive>{
 if(!files.length||files.length>100||files.reduce((n,f)=>n+f.size,0)>50*1024*1024)throw Error('전체 ZIP 크기는 50MB 이하로 선택해주세요.');
 const ids=new Set<string>();let parts=0,total=0;
 for(const file of files){for(const item of await followerFiles(file)){
  total+=item.text.length;if(total>50*1024*1024)throw Error('팔로워 자료 크기가 너무 큽니다.');
  parts++;const data:unknown=JSON.parse(item.text);
  if(!Array.isArray(data))throw Error('팔로워 목록 형식을 확인해주세요.');
  for(const row of data){ids.add(normalizeInstagram(row?.string_list_data?.[0]?.value||row?.title));if(ids.size>100000)throw Error('팔로워 자료는 최대 100,000개 계정까지 지원합니다.');}
 }}
 const dates=files.map(f=>/^instagram-.+-(\d{4}-\d{2}-\d{2})-[^.]+[.]zip$/i.exec(f.name)?.[1]);
 const d=dates[0];const exportDate=d&&dates.every(v=>v===d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d?d:null;
 return {usernames:[...ids],exportDate,parts,files:files.length};
}
