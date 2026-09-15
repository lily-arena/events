import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SubmissionForm } from '../../apps/public/src/SubmissionForm.js';
import type { Campaign } from '../../packages/domain/src/index.js';

function render(policies: Campaign['policies']) {
  const campaign = { maxMessageLength: 30, content: { blocks: [] }, policies } as unknown as Campaign;
  return renderToStaticMarkup(createElement(SubmissionForm, {
    campaign, onAccepted() {}, onConfigChanged() {},
  }));
}
describe('required submission consents', () => {
  it('keeps both labels visible and blocks submission when policies are absent', () => {
    const html = render([]);
    expect(html).toContain('(필수) 개인정보 수집 및 이용에 동의합니다.');
    expect(html).toContain('(필수) 응모작에 대한 저작권 및 활용');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('class="submit" disabled=""');
  });
  it('enables actual policy checkboxes once both documents are available', () => {
    const html = render(['PRIVACY', 'WORK_LICENSE'].map((kind) => ({
      id: kind, kind, required: true, version: 1, body: 'Published policy document',
    })) as Campaign['policies']);
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('동의문을 준비 중입니다');
  });
  it('does not allow a partial or empty document to enable submission', () => {
    expect(render([{ id: 'p', kind: 'PRIVACY', required: true, version: 1, body: 'Privacy document' }])).toContain('class="submit" disabled=""');
  });
});
