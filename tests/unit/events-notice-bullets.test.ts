import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BulletText} from '../../packages/ui/src/BulletText';
import {validateDraft} from '../../packages/event-builder/src/validation';
import {firstSeat} from '../../packages/event-builder/src/model';
it('preserves indentation when saving and renders nested semantic lists safely',()=>{const draft=structuredClone(firstSeat);draft.pages.submission.find(m=>m.type==='notices')!.body='수집 항목\n\t성명\n\t이메일\n수집 방법\n\t<script>alert(1)</script>';const saved=validateDraft(draft,'id').pages.submission.find(m=>m.type==='notices')!;const html=renderToStaticMarkup(createElement(BulletText,{text:saved.body,allLines:true}));expect(html).toContain('수집 항목<ul><li>성명</li><li>이메일</li></ul>');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');});
