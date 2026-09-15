export function newId(): string {
  return crypto.randomUUID();
}

/** Legacy r2_key column stores a D1 event locator for new records. No object is uploaded. */
export function auditRecordKey(_occurredAt: number, eventId: string): string {
  return `d1://audit_events/${eventId}`;
}
