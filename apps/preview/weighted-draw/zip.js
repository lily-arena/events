// Preview-only ZIP reader: stored/deflated entries, with bounded extraction.
export async function followerFiles(file) {
  if (!/\.zip$/i.test(file.name) || file.size > 50 * 1024 * 1024) throw Error('50MB 이하의 ZIP 파일을 선택해주세요.');
  const buffer = await file.arrayBuffer(), view = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === buffer.byteLength) { end = i; break; }
  }
  if (end < 0) throw Error('올바른 ZIP 파일이 아닙니다.');
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count === 65535 || count > 10000) throw Error('이 ZIP 형식은 시안에서 지원하지 않습니다.');
  let cursor = view.getUint32(end + 16, true), total = 0;
  const output = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw Error('ZIP 목록이 손상되었습니다.');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
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
    const reader = stream.getReader(), chunks = []; let actual = 0;
    while (true) { const {value,done} = await reader.read(); if (done) break; actual += value.length; if (actual > size) { await reader.cancel(); throw Error('ZIP 크기 정보가 올바르지 않습니다.'); } chunks.push(value); }
    if (actual !== size) throw Error('ZIP 파일 크기가 일치하지 않습니다.');
    output.push({name,text:await new Blob(chunks).text()});
  }
  if (!output.length) throw Error('팔로워 JSON 파일이 없습니다. 내보내기 형식을 JSON으로 선택해주세요.');
  return output;
}
