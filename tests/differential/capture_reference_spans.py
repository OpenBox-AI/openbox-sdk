"""Capture REAL span_data from the canonical langgraph-py reference: real OTel SDK,
real instrumentation, real operations. Only the governance GATE is monkeypatched
(in this harness, not the ref source) to capture span_data instead of calling Core.
Emits {meta, spans} so the TS side can run identical inputs."""
import json, os, tempfile
# Real OpenTelemetry SDK so span.set_attribute actually records (NoOp drops them).
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
trace.set_tracer_provider(TracerProvider())

import openbox_langgraph.hook_governance as hg
CAPTURED = []
def _cap_sync(span, identifier=None, span_data=None, **kw):
    if span_data is not None: CAPTURED.append(dict(span_data))
async def _cap_async(span, identifier=None, span_data=None, **kw):
    if span_data is not None: CAPTURED.append(dict(span_data))
hg.is_configured = lambda: True
hg.evaluate_sync = _cap_sync
hg.evaluate_async = _cap_async

from openbox_langgraph.file_governance_hooks import setup_file_io_instrumentation
setup_file_io_instrumentation()
fpath = tempfile.mktemp(suffix=".txt")
with open(fpath, "w") as f: f.write("hello")
with open(fpath, "r") as f: _ = f.read()
os.remove(fpath)

from openbox_langgraph.tracing import traced
@traced
def process(x, y=2): return "ok"
process(1, y=3)

# ── http_request: real httpx OTel instrumentor + body-capture send patch + MockTransport ──
import openbox_langgraph.otel_setup as _otel_setup
_otel_setup._span_processor = object()  # config guard only (enables the request hook)
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from openbox_langgraph.http_governance_hooks import (
    _httpx_request_hook, _httpx_response_hook, setup_httpx_body_capture,
)
HTTPXClientInstrumentor().instrument(request_hook=_httpx_request_hook, response_hook=_httpx_response_hook)
setup_httpx_body_capture(_otel_setup._span_processor)
import httpx
def _handler(request):
    return httpx.Response(200, headers={"content-type": "application/json"}, json={"ok": True})
_client = httpx.Client(transport=httpx.MockTransport(_handler))
_client.post("https://api.example.test/v1/data",
             headers={"authorization": "Bearer sk-x", "content-type": "application/json"},
             json={"x": 1})




VOL = ("span_id","trace_id","parent_span_id","start_time","end_time","duration_ns")
norm = lambda d: {k: ("<vol>" if k in VOL else v) for k, v in d.items()}
print(json.dumps({"meta": {"file_path": fpath, "fn_module": process.__module__,
                           "fn_args_positional": [1], "fn_args_kwargs": {"y": 3}},
                  "spans": [norm(s) for s in CAPTURED]}, indent=2, default=str))
