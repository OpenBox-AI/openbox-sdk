import React from 'react';

interface OpenBoxCopilotKitReactBindings {
    useHumanInTheLoop: (definition: Record<string, unknown>) => void;
    useDefaultRenderTool: (definition: Record<string, unknown>) => void;
    useRenderTool?: (definition: Record<string, unknown>) => void;
}
type OpenBoxToolStatus = 'inProgress' | 'executing' | 'complete' | string;
type OpenBoxUiVerdict = 'reviewing' | 'allow' | 'block' | 'halt' | 'approval' | 'rejected' | 'constrain' | 'error';
interface OpenBoxScenarioDefinition {
    action: string;
    title: string;
    reason: string;
    capability: string;
    verdict?: Exclude<OpenBoxUiVerdict, 'reviewing'>;
}
interface OpenBoxChoiceOption {
    id: string;
    title: string;
    description: string;
    destination: string;
    audience?: string;
    fields: string[];
    sensitivity?: string;
    previewRows?: Array<Record<string, unknown>>;
}
interface OpenBoxRendererTheme {
    logoSrc?: string;
    accentColor?: string;
    radius?: number | string;
    density?: 'compact' | 'comfortable';
    mode?: 'light' | 'dark' | 'auto';
}
interface OpenBoxApprovalClient {
    decide(request: {
        governanceEventId: string;
        decision: 'approve' | 'reject';
    }): Promise<unknown>;
}
type OpenBoxArtifactRenderer = (props: {
    artifact: Record<string, unknown>;
    result: Record<string, unknown>;
    theme: OpenBoxRendererTheme;
}) => React.ReactNode;
interface OpenBoxDefaultRenderOptions {
    theme?: OpenBoxRendererTheme;
    logoSrc?: string;
    approvalEndpoint?: string;
    approvalClient?: OpenBoxApprovalClient;
    onSessionHalted?: (haltedAt?: unknown) => void;
    scenarios?: OpenBoxScenarioDefinition[];
    choiceOptions?: OpenBoxChoiceOption[];
    artifactRenderers?: Record<string, OpenBoxArtifactRenderer>;
}
interface UseOpenBoxCopilotKitOptions extends OpenBoxDefaultRenderOptions {
    bindings?: OpenBoxCopilotKitReactBindings;
    approvalParameters?: unknown;
    interactiveParameters?: unknown;
    renderApprovalReview?: (props: Record<string, unknown>) => unknown;
    renderInteractiveReview?: (props: Record<string, unknown>) => unknown;
    renderGovernedTool?: (props: Record<string, unknown>) => unknown;
    renderGovernanceDecision?: (props: Record<string, unknown>) => unknown;
    renderActionResult?: (props: Record<string, unknown>) => unknown;
}
interface UseOpenBoxCopilotKitResult {
    governedToolNames: string[];
    approvalToolName: string;
    interactiveToolName: string;
}

declare function createOpenBoxApprovalClient(config?: {
    endpoint?: string;
    fetcher?: typeof fetch;
}): OpenBoxApprovalClient;

interface OpenBoxCustomMessageRenderer {
    agentId?: string;
    render: React.ComponentType<any> | null;
}
interface OpenBoxCustomMessageRendererOptions extends OpenBoxDefaultRenderOptions {
    agentId?: string;
    renderGovernanceDecision?: (props: Record<string, unknown>) => unknown;
    renderActionResult?: (props: Record<string, unknown>) => unknown;
}
declare function createOpenBoxCustomMessageRenderer(options?: OpenBoxCustomMessageRendererOptions): OpenBoxCustomMessageRenderer;

declare function useOpenBoxCopilotKit(options?: UseOpenBoxCopilotKitOptions): UseOpenBoxCopilotKitResult;

interface OpenBoxGovernanceDecisionProps extends OpenBoxDefaultRenderOptions {
    status: OpenBoxToolStatus;
    parameters?: Record<string, unknown>;
    result?: unknown;
}
interface OpenBoxActionResultProps extends OpenBoxDefaultRenderOptions {
    result?: unknown;
}
interface OpenBoxApprovalReviewProps extends OpenBoxDefaultRenderOptions {
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
interface OpenBoxInteractiveReviewProps extends OpenBoxDefaultRenderOptions {
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

declare function OpenBoxActionResult({ result, logoSrc, theme, artifactRenderers, }: OpenBoxActionResultProps): React.FunctionComponentElement<React.FragmentProps> | null;

declare function OpenBoxApprovalReview({ status, respond, action, request, destination, amountUsd, riskReason, workflowId, runId, activityId, approvalId, governanceEventId, expiresAt, approvalEndpoint, approvalClient, logoSrc, theme, }: OpenBoxApprovalReviewProps): React.DetailedReactHTMLElement<{
    className: string;
    style: React.CSSProperties;
}, HTMLElement> | null;

declare function OpenBoxGovernanceDecision({ status, parameters, result, logoSrc, theme, onSessionHalted, scenarios, }: OpenBoxGovernanceDecisionProps): React.DetailedReactHTMLElement<{
    className: string;
    style: React.CSSProperties;
}, HTMLElement> | null;

declare function OpenBoxInteractiveReview({ status, respond, mode, title, request, action, destination, fields, manualInput, sensitivity, choiceId, choiceOptions, logoSrc, theme, }: OpenBoxInteractiveReviewProps): React.DetailedReactHTMLElement<{
    className: string;
    style: React.CSSProperties;
}, HTMLElement>;

export { OpenBoxActionResult, type OpenBoxApprovalClient, OpenBoxApprovalReview, type OpenBoxArtifactRenderer, type OpenBoxChoiceOption, type OpenBoxCopilotKitReactBindings, type OpenBoxCustomMessageRenderer, type OpenBoxCustomMessageRendererOptions, type OpenBoxDefaultRenderOptions, OpenBoxGovernanceDecision, OpenBoxInteractiveReview, type OpenBoxRendererTheme, type OpenBoxScenarioDefinition, type OpenBoxToolStatus, type OpenBoxUiVerdict, type UseOpenBoxCopilotKitOptions, type UseOpenBoxCopilotKitResult, createOpenBoxApprovalClient, createOpenBoxCustomMessageRenderer, useOpenBoxCopilotKit };
