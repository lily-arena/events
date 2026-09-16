import {useId, type SelectHTMLAttributes} from 'react';
import './text-field.css';
type Props = SelectHTMLAttributes<HTMLSelectElement> & {label: string; helper?: string;};
/** Native select preserves keyboard navigation and the mobile selection picker. */
export function SelectField({label, helper, id, className='', children, ...props}: Props) {
  const generated = useId();
  const fieldId=id || generated;
  const message=helper;
  return <div className={`text-field text-field-select ${className}`}>
    <label htmlFor={fieldId}>{label}</label>
    <div className="text-field-control">
      <select {...props} id={fieldId} aria-invalid={props['aria-invalid']} aria-describedby={[props['aria-describedby'],message?`${fieldId}-help`:undefined].filter(Boolean).join(' ')||undefined}>{children}</select>
      <svg className="select-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6"/></svg>

    </div>
    {message&&<small id={`${fieldId}-help`}>{message}</small>}
  </div>;
}
