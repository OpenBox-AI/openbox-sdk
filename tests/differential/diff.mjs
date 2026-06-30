import { runWithSubOpCapture, capturedSubOpSpans, recordFileOperation, recordFunctionCall } from '../../ts/src/copilotkit/otel-capture.ts';
import { readFileSync } from 'node:fs';
const { meta, spans: ref } = JSON.parse(readFileSync(new URL('./reference-spans.json', import.meta.url)));
const VOL = new Set(['span_id','trace_id','parent_span_id','start_time','end_time','duration_ns']);
const norm = (o) => Object.fromEntries(Object.entries(o).map(([k,v]) => [k, VOL.has(k) ? '<vol>' : v]));
// Identical inputs to the reference run.
const ts = await runWithSubOpCapture({ activityId: 'a' }, async () => {
  recordFileOperation({ filePath: meta.file_path, operation: 'write', fileMode: 'w', data: 'hello', bytesWritten: 5, startMs: 1, endMs: 2 });
  recordFileOperation({ filePath: meta.file_path, operation: 'read', fileMode: 'r', data: 'hello', bytesRead: 5, startMs: 1, endMs: 2 });
  recordFileOperation({ filePath: meta.file_path, operation: 'open', fileMode: 'w', bytesRead: 0, bytesWritten: 5, operations: ['write'], startMs: 1, endMs: 2 });
  recordFunctionCall({ name: 'process', module: meta.fn_module, args: [1, 3], result: 'ok', startMs: 1, endMs: 2 });
  return capturedSubOpSpans();
});
const tsBy = (hook, op, stage) => ts.find(s => s.hook_type===hook && (s.file_operation===op||s.function===op) && s.stage===stage);
const refBy = (op, stage) => ref.find(s => (s.file_operation===op||s.function===op) && s.stage===stage);
let totalGaps=0;
function compare(label, r, t) {
  if (!r) { console.log(`## ${label} — reference has no such span`); return; }
  if (!t) { console.log(`## ${label} — ⚠️ NO TS counterpart`); totalGaps++; return; }
  const rn=norm(r), tn=norm(t); const keys=[...new Set([...Object.keys(rn),...Object.keys(tn)])].sort(); const rows=[];
  for (const k of keys){ const rv=JSON.stringify(rn[k]), tv=JSON.stringify(tn[k]); if(rv!==tv) rows.push(`    ${k}:  REF=${rv??'∅'}  TS=${tv??'∅'}`); }
  totalGaps+=rows.length;
  console.log(`## ${label}  ${rows.length?'— '+rows.length+' diff(s)':'— ✅ 1:1'}`); rows.forEach(x=>console.log(x));
}
compare('file.write completed', refBy('write','completed'), tsBy('file_operation','write','completed'));
compare('file.read completed',  refBy('read','completed'),  tsBy('file_operation','read','completed'));
compare('file.open started',    refBy('open','started'),    tsBy('file_operation','open','started'));
compare('file.close completed', refBy('close','completed'), tsBy('file_operation','close','completed'));
compare('function started',     refBy('process','started'), tsBy('function_call','process','started'));
compare('function completed',   refBy('process','completed'),tsBy('function_call','process','completed'));
console.log(`\nTOTAL field-level diffs: ${totalGaps}`);

// ── http_request ──
import { buildSpan } from '../../ts/src/governance/spans.ts';
const refHttp = ref.find(s => s.hook_type==='http_request' && s.stage==='completed');
if (refHttp) {
  const tsHttp = buildSpan('copilotkit','http',{
    method:'POST', url: refHttp.http_url,
    request_body: refHttp.request_body, response_body: refHttp.response_body,
    request_headers: refHttp.request_headers,
    response_headers: refHttp.response_headers,
    http_status_code: refHttp.http_status_code, stage:'completed',
  });
  compare('http completed', refHttp, tsHttp);
}

// ── db_query (real Postgres via psycopg2 + reference CursorTracer governance) ──
import { recordDatabaseQuery } from '../../ts/src/copilotkit/otel-capture.ts';
try {
  const dbref = JSON.parse(readFileSync(new URL('./db-reference-spans.json', import.meta.url)));
  const refDb = dbref.find(s => s.db_operation==='SELECT' && s.stage==='completed');
  if (refDb) {
    const tsDb = await runWithSubOpCapture({ activityId: 'a' }, async () => {
      recordDatabaseQuery({ statement: refDb.db_statement, operation: 'SELECT', system: refDb.db_system,
        dbName: refDb.db_name, serverAddress: refDb.server_address, serverPort: refDb.server_port,
        rowcount: refDb.rowcount, startMs: 1, endMs: 2 });
      return capturedSubOpSpans();
    });
    compare('db SELECT completed', refDb, tsDb.find(s => s.stage==='completed'));
  }
} catch (e) { console.log('## db — (no db-reference-spans.json)', e.message); }
