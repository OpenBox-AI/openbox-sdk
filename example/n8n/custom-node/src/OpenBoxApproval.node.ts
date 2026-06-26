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

const spec = requiredNodeSpec('openboxApproval');

export class OpenBoxApproval implements INodeType {
  description: INodeTypeDescription = specNodeDescription(spec, {
    icon: 'file:OB_logomark.png',
    group: ['transform'],
    version: 1,
    defaults: { name: spec.name },
    inputs: ['main'] as any,
    outputs: ['main'] as any,
    credentials: openBoxCredentials,
    properties: [
      ...commonGovernanceProperties,
      {
        displayName: 'Approval Reason',
        name: 'approvalReason',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '={{ $json.approvalReason || "Human approval requested by n8n workflow." }}',
        description: 'Reason to include in the OpenBox approval activity input.',
      },
    ],
  });

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executePreExecuteNode(this, spec, 'approval', (_item, index) => ({
      approval_reason: this.getNodeParameter('approvalReason', index, ''),
    }));
  }
}
