import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import {
  commonGovernanceProperties,
  executePreExecuteNode,
  openBoxCredentials,
  requiredNodeSpec,
  requiredWorkflowTemplateSpec,
  specNodeDescription,
} from './openboxRuntime';

const spec = requiredNodeSpec('openboxGovernedAiAgent');
const template = requiredWorkflowTemplateSpec('openbox-governed-ai-agent');

export class OpenBoxGovernedAiAgent implements INodeType {
  description: INodeTypeDescription = specNodeDescription(spec, {
    icon: 'file:OB_logomark.png',
    group: ['transform'],
    version: 1,
    defaults: { name: spec.name },
    inputs: ['main'] as any,
    outputs: ['main'] as any,
    credentials: openBoxCredentials,
    properties: [...commonGovernanceProperties],
  });

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executePreExecuteNode(this, spec, 'governed_ai_agent', () => ({
      workflow_template_id: template.id,
      workflow_template_nodes: [...template.nodes],
      workflow_template_description: template.description,
    }));
  }
}
