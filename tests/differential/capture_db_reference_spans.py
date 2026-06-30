from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
trace.set_tracer_provider(TracerProvider())
import openbox_langgraph.hook_governance as hg
CAP=[]
hg.is_configured=lambda:True
def _cap(span, identifier=None, span_data=None, **k):
    if span_data is not None: CAP.append(dict(span_data))
hg.evaluate_sync=_cap
from opentelemetry.instrumentation.psycopg2 import Psycopg2Instrumentor
Psycopg2Instrumentor().instrument()
from openbox_langgraph.db_governance_hooks import install_cursor_tracer_hooks
print("install:", install_cursor_tracer_hooks())
import psycopg2
conn = psycopg2.connect(host="localhost", port=5432, dbname="diff", user="postgres", password="pw")
cur = conn.cursor()
cur.execute("CREATE TABLE IF NOT EXISTS t (id int, name text)")
cur.execute("INSERT INTO t VALUES (1, 'a')")
cur.execute("SELECT * FROM t")
cur.fetchall()
conn.commit(); conn.close()
print("captured db spans:", len(CAP))
import json
VOL=("span_id","trace_id","parent_span_id","start_time","end_time","duration_ns")
norm=lambda d:{k:("<vol>" if k in VOL else v) for k,v in d.items()}
sel=[s for s in CAP if s.get("db_operation")=="SELECT" and s.get("stage")=="completed"]
if sel: print(json.dumps(norm(sel[0]), indent=1, default=str))
