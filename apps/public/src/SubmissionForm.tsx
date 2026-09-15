import { useMemo, useRef, useState } from 'react';
import {
  DomainError,
  checkContact,
  checkMessage,
  countGraphemes,
  type Campaign,
  type FieldError,
  type Policy,
} from '@first-seat/domain';
import { blockItems, blockText } from '@first-seat/content';
import { ApiError, startSession, submitEntry } from './api.js';
import { TurnstileError, getTurnstileToken } from './turnstile.js';
import { ConsentModal } from './ConsentModal.js';
import { exclusionParagraphs } from './exclusion-copy.js';

interface SubmissionFormProps {
  readonly campaign: Campaign;
  readonly onAccepted: () => void;
  readonly onConfigChanged: () => void;
}

type FormFields = 'message' | 'name' | 'phone' | 'email' | 'consents';
type ErrorMap = Partial<Record<FormFields, string>>;

/** 동의 checkbox에 붙일 콘텐츠 label. 정책 kind와 CMS block을 짝지어 문안 원문을 유지한다. */
const CONSENT_LABEL_BLOCK: Readonly<Record<string, string>> = {
  PRIVACY: 'privacy_label',
  WORK_LICENSE: 'license_label',
  OVERSEAS: 'overseas_label',
};

function collectFieldErrors(run: () => void): FieldError[] {
  try {
    run();
    return [];
  } catch (error) {
    if (error instanceof DomainError) return [...error.fieldErrors];
    throw error;
  }
}

export function SubmissionForm({ campaign, onAccepted, onConfigChanged }: SubmissionFormProps): JSX.Element {
  const blocks = campaign.content.blocks;
  const maxLength = campaign.maxMessageLength;

  // PII·문구는 이 컴포넌트의 메모리에만 둔다. 저장소·URL에 넣지 않는다.
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [accepted, setAccepted] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<ErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openPolicy, setOpenPolicy] = useState<Policy | null>(null);
  const composingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const csrfRef = useRef<string | null>(null);

  const messageRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  const requiredPolicies = useMemo(() => campaign.policies.filter((p) => p.required), [campaign.policies]);
  const consentReady = ['PRIVACY', 'WORK_LICENSE'].every((kind) =>
    requiredPolicies.some((policy) => policy.kind === kind && policy.body.trim().length > 0),
  );
  const displayedPolicies: readonly Policy[] = [
    ...(['PRIVACY', 'WORK_LICENSE'] as const).map((kind) =>
      requiredPolicies.find((policy) => policy.kind === kind) ??
      { id: `unavailable-${kind}`, kind, version: 0, body: '', required: true },
    ),
    ...requiredPolicies.filter((policy) => policy.kind !== 'PRIVACY' && policy.kind !== 'WORK_LICENSE'),
  ];
  // 조합 중에도 자르지 않고 grapheme 기준으로 세기만 한다.
  const graphemeCount = useMemo(() => countGraphemes(message.trim()), [message]);
  const over = graphemeCount > maxLength;

  function validateAll(): ErrorMap {
    const next: ErrorMap = {};
    for (const fieldError of collectFieldErrors(() => checkMessage(message, maxLength))) {
      next.message = fieldError.message;
    }
    for (const fieldError of collectFieldErrors(() => checkContact({ name, phone, email }))) {
      next[fieldError.field as 'name' | 'phone' | 'email'] = fieldError.message;
    }
    const missing = requiredPolicies.filter((p) => !accepted.includes(p.id));
    if (!consentReady) next.consents = '동의문을 준비 중입니다. 잠시 후 다시 방문해주세요.';
    else if (missing.length > 0) next.consents = '필수 동의 항목에 모두 동의해주세요.';
    return next;
  }

  function focusFirstError(map: ErrorMap): void {
    const order: [FormFields, HTMLElement | null][] = [
      ['message', messageRef.current],
      ['name', nameRef.current],
      ['phone', phoneRef.current],
      ['email', emailRef.current],
      ['consents', consentRef.current],
    ];
    for (const [field, element] of order) {
      if (map[field] !== undefined && element !== null) {
        element.focus();
        return;
      }
    }
  }

  function validateOne(field: 'message' | 'name' | 'phone' | 'email'): void {
    const map = validateAll();
    setErrors((prev) => ({ ...prev, [field]: map[field] }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const map = validateAll();
    setErrors(map);
    if (Object.values(map).some((v) => v !== undefined)) {
      focusFirstError(map);
      return;
    }

    setSubmitting(true);
    try {
      if (csrfRef.current === null) {
        csrfRef.current = (await startSession()).csrfToken;
      }
      if (idempotencyKeyRef.current === null) {
        idempotencyKeyRef.current = crypto.randomUUID();
      }
      // 입력이 유효하고 사용자가 제출할 때만 보안 확인을 실행한다. token은 매번 새로 받는다.
      const turnstileToken = await getTurnstileToken(campaign.turnstileSiteKey, 'submission');

      await submitEntry(
        {
          message: message.trim(),
          name,
          phone,
          email,
          configRevision: campaign.revision,
          contentVersionId: campaign.content.versionId,
          consents: accepted.map((policyId) => ({ policyId, accepted: true as const })),
          turnstileToken,
        },
        csrfRef.current,
        idempotencyKeyRef.current,
      );

      // 성공 후 메모리에서 입력값을 지운다.
      setMessage('');
      setName('');
      setPhone('');
      setEmail('');
      setAccepted([]);
      idempotencyKeyRef.current = null;
      onAccepted();
    } catch (error) {
      if (error instanceof ApiError) {
        // 내용이 바뀌었으므로 같은 key로 재시도하지 않는다.
        idempotencyKeyRef.current = null;
        if (error.body.code === 'CONFIG_CHANGED') {
          setAccepted([]);
          setFormError('내용이 변경되었습니다. 변경된 내용을 확인한 뒤 다시 제출해주세요.');
          onConfigChanged();
        } else if (error.body.fieldErrors !== undefined && error.body.fieldErrors.length > 0) {
          const next: ErrorMap = {};
          for (const fieldError of error.body.fieldErrors) {
            next[fieldError.field as FormFields] = fieldError.message;
          }
          setErrors(next);
          focusFirstError(next);
        } else {
          if (error.body.code === 'CSRF_FAILED' || error.body.code === 'UNAUTHENTICATED') {
            csrfRef.current = null;
          }
          setFormError(error.body.message);
        }
      } else if (error instanceof TurnstileError) {
        // 보안 확인이 실패·만료된 경우다. 입력은 그대로 두고 다시 시도하게 한다.
        setFormError(error.message);
      } else {
        // 네트워크 오류는 입력을 유지하고 같은 key로 다시 시도할 수 있게 둔다.
        setFormError('네트워크 상태를 확인한 뒤 다시 시도해주세요.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <section>
          <div className={`field${errors.message === undefined ? '' : ' has-error'}`}>
            <label className="field-label" htmlFor="message">
              {blockText(blocks, 'message_label')}
            </label>
            <textarea
              id="message"
              ref={messageRef}
              value={message}
              rows={3}
              inputMode="text"
              aria-describedby={`message-helper${errors.message === undefined ? '' : ' message-error'}`}
              aria-invalid={errors.message !== undefined}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                setMessage(event.currentTarget.value);
              }}
              onChange={(event) => setMessage(event.target.value)}
              onBlur={() => validateOne('message')}
            />
            <div className="counter-row">
              <span className="helper" id="message-helper">
                {blockText(blocks, 'message_helper')}
              </span>
              <span className={`counter${over ? ' over' : ''}`} aria-live="polite">
                {graphemeCount} / {maxLength}
              </span>
            </div>
            {errors.message !== undefined && (
              <span className="field-error-text" id="message-error" role="alert">
                {errors.message}
              </span>
            )}
          </div>
        </section>

        <section aria-labelledby="entrant-heading">
          <h2 id="entrant-heading">{blockText(blocks, 'entrant_heading')}</h2>
          <p className="helper" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
            {blockText(blocks, 'entrant_helper')}
          </p>

          <div className={`field${errors.name === undefined ? '' : ' has-error'}`}>
            <label className="field-label" htmlFor="name">
              이름
            </label>
            <input
              id="name"
              ref={nameRef}
              type="text"
              autoComplete="name"
              value={name}
              aria-invalid={errors.name !== undefined}
              aria-describedby={errors.name === undefined ? undefined : 'name-error'}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => validateOne('name')}
            />
            {errors.name !== undefined && (
              <span className="field-error-text" id="name-error" role="alert">
                {errors.name}
              </span>
            )}
          </div>

          <div className={`field${errors.phone === undefined ? '' : ' has-error'}`}>
            <label className="field-label" htmlFor="phone">
              연락처
            </label>
            <input
              id="phone"
              ref={phoneRef}
              type="tel"
              inputMode="numeric"
              placeholder="010-0000-0000"
              autoComplete="tel"
              value={phone}
              aria-invalid={errors.phone !== undefined}
              aria-describedby={errors.phone === undefined ? undefined : 'phone-error'}
              onChange={(event) => {
                const raw = event.target.value;
                if (/[^0-9-]/u.test(raw)) {
                  setErrors((prev) => ({ ...prev, phone: '잘못된 형식입니다.' }));
                  return;
                }
                const digits = raw.replace(/-/gu, '');
                const prefix = digits.startsWith('02') ? 2 : 3;
                const middle = digits.startsWith('010') || digits.length > prefix + 7 ? 4 : 3;
                const formatted = digits.length <= prefix ? digits
                  : digits.length <= prefix + middle ? digits.slice(0, prefix) + '-' + digits.slice(prefix)
                  : digits.slice(0, prefix) + '-' + digits.slice(prefix, prefix + middle) + '-' + digits.slice(prefix + middle);
                setPhone(formatted);
                const issue = collectFieldErrors(() => checkContact({ name, phone: formatted, email })).find((e) => e.field === 'phone');
                setErrors((prev) => ({ ...prev, phone: issue?.message }));
              }}
              onBlur={() => validateOne('phone')}
            />
            {errors.phone !== undefined && (
              <span className="field-error-text" id="phone-error" role="alert">
                {errors.phone}
              </span>
            )}
          </div>

          <div className={`field${errors.email === undefined ? '' : ' has-error'}`}>
            <label className="field-label" htmlFor="email">
              이메일
            </label>
            <input
              id="email"
              ref={emailRef}
              type="email"
              inputMode="email"
              placeholder="user@example.com"
              autoComplete="email"
              value={email}
              aria-invalid={errors.email !== undefined}
              aria-describedby={errors.email === undefined ? undefined : 'email-error'}
              onChange={(event) => {
                const value = event.target.value;
                setEmail(value);
                if (errors.email !== undefined) {
                  const issue = collectFieldErrors(() => checkContact({ name, phone, email: value })).find((e) => e.field === 'email');
                  setErrors((prev) => ({ ...prev, email: issue?.message }));
                }
              }}
              onBlur={() => validateOne('email')}
            />
            {errors.email !== undefined && (
              <span className="field-error-text" id="email-error" role="alert">
                {errors.email}
              </span>
            )}
          </div>
        </section>

        <section aria-label="동의 항목">
          {displayedPolicies.map((policy, index) => {
            const labelKey = CONSENT_LABEL_BLOCK[policy.kind] ?? '';
            const label = blockText(blocks, labelKey);
            const checkboxId = `consent-${policy.id}`;
            return (
              <div className="consent" key={policy.id}>
                <input
                  id={checkboxId}
                  type="checkbox"
                  disabled={policy.body.trim().length === 0}
                  ref={index === 0 ? consentRef : undefined}
                  checked={accepted.includes(policy.id)}
                  aria-describedby={errors.consents === undefined ? undefined : 'consents-error'}
                  onChange={(event) =>
                    setAccepted((prev) =>
                      event.target.checked ? [...prev, policy.id] : prev.filter((id) => id !== policy.id),
                    )
                  }
                />
                <label className="consent-label" htmlFor={checkboxId}>
                  {label.length > 0 ? label : policy.kind === 'PRIVACY' ? '(필수) 개인정보 수집 및 이용에 동의합니다.' : policy.kind === 'WORK_LICENSE' ? '(필수) 응모작에 대한 저작권 및 활용(제작·설치·SNS 게시 등)에 동의합니다.' : policy.kind}
                </label>
                <button type="button" className="link-button" disabled={policy.body.trim().length === 0} onClick={() => setOpenPolicy(policy)}>
                  자세히 보기
                </button>
              </div>
            );
          })}
          {!consentReady && <p role="status">동의문을 준비 중입니다. 준비가 완료되면 응모하실 수 있습니다.</p>}
          {errors.consents !== undefined && (
            <span className="field-error-text" id="consents-error" role="alert">
              {errors.consents}
            </span>
          )}
        </section>

        <section aria-labelledby="notices-heading">
          <h2 id="notices-heading">{blockText(blocks, 'notices_heading')}</h2>
          <div className="exclusion-notice">
            {exclusionParagraphs(blockItems(blocks, 'exclusions')).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <ul className="notice-list">
            {blockItems(blocks, 'notices').map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>

        <button type="submit" className="submit" disabled={submitting || !consentReady}>
          {submitting ? '보내는 중...' : blockText(blocks, 'submit')}
        </button>
        <div className="form-status" role="status" aria-live="polite">
          {formError}
        </div>
      </form>

      {openPolicy !== null && (
        <ConsentModal
          title={blockText(blocks, CONSENT_LABEL_BLOCK[openPolicy.kind] ?? '') || '동의 상세'}
          body={openPolicy.body}
          onClose={() => setOpenPolicy(null)}
        />
      )}
    </>
  );
}
