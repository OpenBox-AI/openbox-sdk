import type { ICredentialType, INodeProperties } from 'n8n-workflow';
import { getOpenBoxN8nCredentialSpec } from './generated/openbox-n8n-spec';

function requiredCredentialSpec() {
  const generated = getOpenBoxN8nCredentialSpec('openboxCredentials');
  if (!generated) throw new Error('Missing generated OpenBox n8n credential spec');
  return generated;
}

const spec = requiredCredentialSpec();

const propertyNames = new Set(spec.properties);

function property(
  name: string,
  displayName: string,
  description: string,
  options: Partial<INodeProperties> = {},
): INodeProperties | null {
  if (!propertyNames.has(name)) return null;
  return {
    displayName,
    name,
    type: 'string',
    default: '',
    description,
    ...options,
  } as INodeProperties;
}

export class OpenBoxCredentials implements ICredentialType {
  name = spec.id;
  displayName = spec.name;
  documentationUrl = 'https://github.com/OpenBox-AI/openbox-sdk';
  properties = [
    property('coreUrl', 'Core URL', 'OpenBox Core governance URL.', {
      default: '={{ $env.OPENBOX_CORE_URL || $env.OPENBOX_API_URL || "http://host.docker.internal:8086" }}',
    }),
    property('apiKey', 'Core API Key', 'OpenBox Core API key used for governance events.', {
      typeOptions: { password: true },
      default: '={{ $env.OPENBOX_API_KEY }}',
    }),
    property('apiUrl', 'Backend API URL', 'Optional OpenBox backend API URL for approval and dashboard workflows.', {
      default: '={{ $env.OPENBOX_API_URL || "" }}',
    }),
    property('backendApiKey', 'Backend API Key', 'Optional backend API key for approval and dashboard workflows.', {
      typeOptions: { password: true },
      default: '={{ $env.OPENBOX_BACKEND_API_KEY || "" }}',
    }),
    property('agentId', 'Agent ID', 'Optional OpenBox agent identifier to attribute n8n events.', {
      default: '={{ $env.OPENBOX_AGENT_ID || "" }}',
    }),
  ].filter((entry): entry is INodeProperties => entry !== null);
}
