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
  specNodeDescription,
} from './openboxRuntime';

const spec = requiredNodeSpec('openboxGovernance');

export class OpenBoxGovernance implements INodeType {
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
    return executePreExecuteNode(this, spec, 'governance');
  }
}
