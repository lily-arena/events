import type { CampaignState } from '@first-seat/domain';

export interface CampaignRow {
  id: string;
  slug: string;
  state: CampaignState;
  paused: number;
  revision: number;
  max_message_length: number;
  submission_start: number | null;
  submission_end: number | null;
  voting_start: number | null;
  voting_end: number | null;
  voting_epoch: number;
  launch_approved: number;
}

export interface PublishedContentRow {
  content_version_id: string;
  page: string;
  locale: string;
  body_json: string;
  version: number;
}

export interface PolicyRow {
  id: string;
  kind: string;
  version: number;
  body: string;
  required: number;
}

export interface IdempotencyRow {
  request_hmac: string;
  resource_id: string;
  http_status: number;
}
