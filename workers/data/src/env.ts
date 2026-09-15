export interface DataEnv {
  readonly DB: D1Database;
  readonly ENVIRONMENT: string;
  readonly AUDIT_SIGNING_SECRET: string;
}
