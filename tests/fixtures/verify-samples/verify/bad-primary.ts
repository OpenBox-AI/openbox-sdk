// Regression fixture - triggers the 9 primary verify rules.
// Tracks: activity_input-must-be-array, invented-verdict, stage-both-silent-noop,
// missing-x-openbox-client-header, invented-activity-type,
// raw-approval-response-verdict, hardcoded-uuid, missing-finally-workflow-complete,
// activity-started-without-completed.

import { fetch } from 'node-fetch';

const AGENT_ID = 'fdf0718b-b3e8-4c68-b33a-136f6da1d156';
const TEAM_ID = 'a1b2c3d4-5555-6666-7777-888899990000';

export async function governTool(toolName: string, args: any) {
  const res = await fetch('https://api.openbox.ai/agent/' + AGENT_ID, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ...' },
    body: JSON.stringify({
      event_type: 'ActivityStarted',
      activity_type: 'LLMCompletion',
      activity_input: { prompt: 'hello' },
      workflow_id: 'wf-1',
      run_id: 'run-1',
    }),
  });
  const data = await res.json() as any;
  switch (data.verdict) {
    case 'allow': return args;
    case 'deny': throw new Error('blocked');
    case 'ask': return { pending: true };
    case 'constrain': return data.constrainedArgs;
  }
}

export async function pollApproval(workflowId: string, runId: string, activityId: string) {
  const res = await fetch('https://api.openbox.ai/api/v1/governance/approval', {
    method: 'POST',
    body: JSON.stringify({ workflow_id: workflowId, run_id: runId, activity_id: activityId }),
  });
  const data = await res.json() as any;
  if (data.verdict === 'allow') return true;
  return false;
}

const CLI_CMD = 'openbox guardrail create $AGENT_ID -n "bad" --type pii --stage both';

export async function startAndEmit() {
  await fetch('/evaluate', {
    method: 'POST',
    body: JSON.stringify({ event_type: 'WorkflowStarted', workflow_id: 'x', run_id: 'y' }),
  });
  console.log('done');
}

export async function halfActivity() {
  await fetch('/evaluate', {
    method: 'POST',
    body: JSON.stringify({ event_type: 'ActivityStarted', activity_id: 'a', activity_type: 'FileRead' }),
  });
  console.log('file read');
}
