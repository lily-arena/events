/** 저장용 마스킹. Admin 목록에는 이 값만 전달하고 원문은 별도 reveal 절차로만 반환한다. */

export function maskName(name: string): string {
  const chars = [...name];
  if (chars.length <= 1) return '*';
  if (chars.length === 2) return `${chars[0]!}*`;
  return `${chars[0]!}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]!}`;
}

export function maskPhone(phone: string): string {
  const tail = phone.slice(-4);
  const headLength = Math.max(phone.length - 4, 0);
  return `${phone.slice(0, Math.min(3, headLength))}${'*'.repeat(Math.max(headLength - 3, 0))}${tail}`;
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '*';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const maskedLocal = local.length <= 1 ? '*' : `${local[0]!}${'*'.repeat(local.length - 1)}`;
  const dot = domain.indexOf('.');
  const maskedDomain =
    dot <= 0 ? '*' : `${domain[0]!}${'*'.repeat(Math.max(dot - 1, 0))}${domain.slice(dot)}`;
  return `${maskedLocal}@${maskedDomain}`;
}
