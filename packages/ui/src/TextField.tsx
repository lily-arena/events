import {useId, type InputHTMLAttributes} from 'react';
import './text-field.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label: string;
  helper?: string;
  error?: string;
  success?: boolean;
  onClear?: () => void;
};
/** Success is explicit: a non-empty value alone never implies validation. */
export function TextField({label, helper, error, success, onClear, id, className = '', ...props}: Props) {
  const generated = useId();
  const fieldId = id || generated;
  const message = error || helper;
  return <div className={`text-field ${className}`} data-state={error ? 'error' : success ? 'success' : undefined}>
    <label htmlFor={fieldId}>{label}</label>
    <div className="text-field-control">
      <input {...props} id={fieldId} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={[props['aria-describedby'], message ? `${fieldId}-help` : undefined].filter(Boolean).join(' ') || undefined}/>
      {error ? <span className="text-field-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><path d="M10 5v6m0 3v1"/></svg></span> : success ? <span className="text-field-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m3 10 4 4L17 4"/></svg></span> : onClear && props.value && !props.disabled && !props.readOnly ? <button className="text-field-clear" type="button" aria-label={`${label} 지우기`} onClick={() => {onClear(); document.getElementById(fieldId)?.focus();}}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="m7 7 6 6m0-6-6 6"/></svg></button> : null}
    </div>
    {message && <small id={`${fieldId}-help`}>{message}</small>}
    {success && <span className="text-field-sr">입력 확인 완료</span>}
  </div>;
}
