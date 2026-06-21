import { createServer, type IncomingMessage, type Server } from 'node:http';

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function guardrailProviderResult(body: any) {
  const text = String(
      body?.logs?.text ??
      body?.logs?.input?.[0]?.text ??
      body?.logs?.input?.text ??
      body?.logs?.output?.text ??
      body?.input?.text ??
      body?.payload?.text ??
      body?.activity_input?.[0]?.text ??
      body?.activityInput?.[0]?.text ??
      body?.text ??
      '',
  );
  const guardrailType = String(body?.guardrail_type ?? 'pii_detection');
  const field = 'logs.text';

  if (text.includes('BLOCK_ME')) {
    const fieldResults = [{
      field,
      status: 'blocked',
      reason: 'Matched banned token BLOCK_ME',
    }];
    return {
      validation_passed: false,
      field_results: fieldResults,
      results: [{ guardrail_type: guardrailType, results: fieldResults }],
      raw_logs: body.logs ?? {},
      raw_params: body.params ?? {},
      raw_settings: body.settings ?? {},
    };
  }

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
    const redactedInput = {
      ...(body.logs ?? {}),
      text: text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[redacted-email]'),
    };
    const fieldResults = [{
      field,
      status: 'redacted',
      reason: 'Redacted email address',
    }];
    return {
      validation_passed: true,
      redacted_input: redactedInput,
      field_results: fieldResults,
      results: [{ guardrail_type: guardrailType, results: fieldResults }],
      raw_logs: body.logs ?? {},
      raw_params: body.params ?? {},
      raw_settings: body.settings ?? {},
    };
  }

  if (text.includes('TRANSFORM_ME')) {
    const transformedInput = {
      ...(body.logs ?? {}),
      text: text.replace('TRANSFORM_ME', 'transformed-value'),
    };
    const fieldResults = [{
      field,
      status: 'transformed',
      reason: 'Transformed provider-specific token',
    }];
    return {
      validation_passed: true,
      redacted_input: transformedInput,
      field_results: fieldResults,
      results: [{ guardrail_type: guardrailType, results: fieldResults }],
      raw_logs: body.logs ?? {},
      raw_params: body.params ?? {},
      raw_settings: body.settings ?? {},
    };
  }

  if (text.includes('SKIP_ME')) {
    const fieldResults = [{
      field,
      status: 'skipped',
      reason: 'Field is out of scope for this guardrail',
    }];
    return {
      validation_passed: true,
      field_results: fieldResults,
      results: [{ guardrail_type: guardrailType, results: fieldResults }],
      raw_logs: body.logs ?? {},
      raw_params: body.params ?? {},
      raw_settings: body.settings ?? {},
    };
  }

  const fieldResults = [{
    field,
    status: 'allowed',
  }];
  return {
    validation_passed: true,
    field_results: fieldResults,
    results: [{ guardrail_type: guardrailType, results: fieldResults }],
    raw_logs: body.logs ?? {},
    raw_params: body.params ?? {},
    raw_settings: body.settings ?? {},
  };
}

function coreGuardrailProviderResult(body: any) {
  const backendResult = guardrailProviderResult(body);
  const fieldResults = backendResult.field_results ?? [];
  const status = String(fieldResults[0]?.status ?? 'allowed');
  const rawLogs = body?.logs ?? {};
  const redactedInput = backendResult.redacted_input;
  const validatedLogs = { ...rawLogs };
  if (redactedInput) {
    if (rawLogs.output !== undefined && rawLogs.output !== null) {
      validatedLogs.output = redactedInput;
    } else if (Array.isArray(rawLogs.input)) {
      validatedLogs.input = [redactedInput];
    } else if (rawLogs.input !== undefined && rawLogs.input !== null) {
      validatedLogs.input = redactedInput;
    }
  }

  return {
    token: body?.token ?? '',
    action: status === 'blocked'
      ? 'block'
      : status === 'redacted' || status === 'transformed'
        ? 'constrain'
        : 'continue',
    raw_logs: rawLogs,
    validated_logs: validatedLogs,
    guardrail_results: (backendResult.results ?? []).map((entry: any) => ({
      ...entry,
      guardrail_type: body?.guardrail_type ?? '1',
    })),
  };
}

export async function startGuardrailProviderStub(options: {
  port?: number;
  paths?: string[];
} = {}): Promise<Server> {
  const port = options.port ?? 8000;
  const paths = new Set(options.paths ?? ['/guardrails/run-test']);
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !paths.has(req.url ?? '')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'not found' }));
      return;
    }

    const rawBody = await readRequestBody(req);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const payload = JSON.stringify(
      req.url === '/api/v1/guardrails/evaluate'
        ? coreGuardrailProviderResult(body)
        : guardrailProviderResult(body),
    );
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}
