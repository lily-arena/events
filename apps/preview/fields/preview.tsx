import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import '../../../packages/ui/src/tokens.css';
import '../../../packages/ui/src/event-theme.css';
import {TextField} from '../../../packages/ui/src/TextField';
import {SelectField} from '../../../packages/ui/src/SelectField';
import './preview.css';
function States({theme,title}:{theme:string;title:string}) {
 const [value,setValue]=useState('입력 중인 문구');
 return <section className={theme}><h2>{title}</h2>
 <article><h3>기본</h3><TextField label="레이블" placeholder="플레이스 홀더"/></article>
 <article><h3>마우스 올림</h3><div data-demo="hover"><TextField label="레이블" placeholder="플레이스 홀더"/></div></article>
 <article><h3>포커스</h3><div data-demo="focus"><TextField label="레이블" placeholder="플레이스 홀더" helper="도움말 텍스트"/></div></article>
 <article><h3>입력 중</h3><div data-demo="focus"><TextField label="레이블" value={value} onChange={e=>setValue(e.target.value)} onClear={()=>setValue('')} helper="도움말 텍스트"/></div></article>
 <article><h3>입력 완료</h3><TextField label="레이블" defaultValue="입력한 정보" helper="도움말 텍스트"/></article>
 <article><h3>오류</h3><TextField label="이메일" defaultValue="email@" error="이메일 형식을 확인해주세요."/></article>
 <article><h3>비활성</h3><TextField label="레이블" placeholder="플레이스 홀더 또는 입력한 정보" disabled/></article>
 <article><h3>성공</h3><TextField label="이메일" defaultValue="example@seoularena.net" success/></article>
 <h2>드롭다운</h2>
 {['기본','마우스 올림','포커스','선택 완료','비활성'].map((state,index)=><article key={state}><h3>{state}</h3><div data-demo={index===1?'hover':index===2?'focus':undefined}><SelectField label="상태" defaultValue={index===0||index===1||index===2?'':'pending'} disabled={index===4} helper={index===2?'상태를 선택해주세요.':undefined}><option value="" disabled>선택해주세요</option><option value="pending">검토 대기</option><option value="approved">승인</option><option value="candidate">후보</option></SelectField></div></article>)}
 </section>;
}
createRoot(document.getElementById('root')!).render(<main><h1>입력 필드</h1><p>필드를 눌러 입력하거나 지우기 버튼을 사용할 수 있습니다.</p><div className="themes"><States theme="" title="백오피스"/><States theme="field-theme-light" title="공개 · 밝은 배경"/><States theme="event-theme-dark" title="공개 · 어두운 배경"/></div></main>);
