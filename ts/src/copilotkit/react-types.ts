import type React from 'react';

export interface OpenBoxCopilotKitReactBindings {
  useHumanInTheLoop: (definition: Record<string, unknown>) => void;
  useDefaultRenderTool: (definition: Record<string, unknown>) => void;
  useRenderTool?: (definition: Record<string, unknown>) => void;
  // Host-driven (langgraph interrupt) approval rendering. The deterministic
  // governance approval is surfaced as an `on_interrupt` event, not a
  // model-emitted tool call, so it is rendered via useInterrupt rather than
  // useHumanInTheLoop.
  useInterrupt?: (config: {
    enabled?: (event: Record<string, unknown>) => boolean;
    render: (props: {
      event: Record<string, unknown>;
      resolve: (response: unknown) => void;
    }) => unknown;
  }) => void;
}

export type OpenBoxToolStatus =
  | 'inProgress'
  | 'executing'
  | 'complete'
  | string;

export type OpenBoxUiVerdict =
  | 'reviewing'
  | 'allow'
  | 'block'
  | 'halt'
  | 'approval'
  | 'rejected'
  | 'constrain'
  | 'error';

export interface OpenBoxScenarioDefinition {
  action: string;
  title: string;
  reason?: string;
  capability?: string;
}

export interface OpenBoxChoiceOption {
  id: string;
  title: string;
  description: string;
  destination: string;
  audience?: string;
  fields: string[];
  sensitivity?: string;
  previewRows?: Array<Record<string, unknown>>;
}

export interface OpenBoxRendererTheme {
  logoSrc?: string;
  accentColor?: string;
  radius?: number | string;
  density?: 'compact' | 'comfortable';
  mode?: 'light' | 'dark' | 'auto';
}

export interface OpenBoxApprovalClient {
  decide(request: {
    governanceEventId: string;
    decision: 'approve' | 'reject';
  }): Promise<unknown>;
}

export type OpenBoxArtifactRenderer = (props: {
  artifact: Record<string, unknown>;
  result: Record<string, unknown>;
  theme: OpenBoxRendererTheme;
}) => React.ReactNode;

export interface OpenBoxDefaultRenderOptions {
  theme?: OpenBoxRendererTheme;
  logoSrc?: string;
  approvalEndpoint?: string;
  approvalClient?: OpenBoxApprovalClient;
  onSessionHalted?: (haltedAt?: unknown) => void;
  scenarios?: OpenBoxScenarioDefinition[];
  choiceOptions?: OpenBoxChoiceOption[];
  artifactRenderers?: Record<string, OpenBoxArtifactRenderer>;
}

export interface UseOpenBoxCopilotKitOptions extends OpenBoxDefaultRenderOptions {
  bindings?: OpenBoxCopilotKitReactBindings;
  approvalParameters?: unknown;
  interactiveParameters?: unknown;
  renderApprovalReview?: (props: Record<string, unknown>) => unknown;
  renderInteractiveReview?: (props: Record<string, unknown>) => unknown;
  renderGovernedTool?: (props: Record<string, unknown>) => unknown;
  renderGovernanceDecision?: (props: Record<string, unknown>) => unknown;
  renderActionResult?: (props: Record<string, unknown>) => unknown;
}

export interface UseOpenBoxCopilotKitResult {
  governedToolNames: string[];
  approvalToolName: string;
  interactiveToolName: string;
}
