import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import {
  commonTextProperties,
  executeLlmCompletionNode,
  openBoxCredentials,
  requiredNodeSpec,
  specNodeDescription,
} from './openboxRuntime';

const spec = requiredNodeSpec('openboxGuardrails');

export class OpenBoxGuardrails implements INodeType {
  description: INodeTypeDescription = specNodeDescription(spec, {
    icon: 'file:OB_logomark.png',
    group: ['transform'],
    version: 1,
    defaults: { name: spec.name },
    inputs: ['main'] as any,
    outputs: ['main'] as any,
    credentials: openBoxCredentials,
    properties: [...commonTextProperties],
  });

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeLlmCompletionNode(this, spec, 'guardrails');
  }
}
