import type {
  OpenBoxDefaultRenderOptions,
  OpenBoxToolStatus,
} from './react-types.js';

export interface OpenBoxGovernanceDecisionProps extends OpenBoxDefaultRenderOptions {
  status: OpenBoxToolStatus;
  parameters?: Record<string, unknown>;
  result?: unknown;
}

export interface OpenBoxActionResultProps extends OpenBoxDefaultRenderOptions {
  result?: unknown;
}

export interface OpenBoxApprovalReviewProps extends OpenBoxDefaultRenderOptions {
  status: OpenBoxToolStatus;
  respond?: (response: string) => void | Promise<void>;
  action?: string;
  request?: string;
  destination?: string;
  amountUsd?: number;
  riskReason?: string;
  workflowId?: string;
  runId?: string;
  activityId?: string;
  approvalId?: string;
  governanceEventId?: string;
  expiresAt?: string;
}

export interface OpenBoxInteractiveReviewProps extends OpenBoxDefaultRenderOptions {
  status: OpenBoxToolStatus;
  respond?: (response: string) => void | Promise<void>;
  mode?: 'choice' | 'manual';
  title?: string;
  request?: string;
  action?: string;
  destination?: string;
  fields?: string[];
  audience?: string;
  manualInput?: string;
  sensitivity?: string;
  choiceId?: string;
}
