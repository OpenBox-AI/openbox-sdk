// Socket client for hook subprocesses. Connects to the OpenBox
// extension's approval socket, sends a pending notification, and
// optionally awaits a decision pushed back over the same connection.
//
// Designed to race the SDK's pollApproval loop: whichever resolves
// first wins. Socket wins for in-extension clicks (sub-millisecond
// round-trip); pollApproval wins for dashboard / programmatic
// decisions and for the case where the extension isn't running
// (socket connect fails immediately).

import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';

export const APPROVAL_SOCKET_PATH = path.join(
  os.homedir(),
  '.openbox',
  'run',
  'openbox.sock',
);

export interface PendingNotification {
  governance_event_id: string;
  agent_id: string;
  hook_event_name: string;
  /** Source runtime ("cursor", "claude-code", ...). Drives extension
   *  notification copy. */
  source: 'cursor' | 'claude-code';
  /** One-line summary the extension shows (file path, command, etc). */
  summary: string;
  /** Backend reject_message verbatim; extension sanitizes for display. */
  reason: string;
  /** ISO-8601 deadline; the extension reaps past this. */
  expires_at: string;
}

export type SocketResult =
  | { kind: 'decision'; decision: 'approve' | 'reject' }
  | { kind: 'timeout' }
  | { kind: 'unreachable' }
  | { kind: 'closed' };

interface ActiveConnection {
  socket: net.Socket;
  /** Push a "pending" notification (idempotent if reconnecting). */
  notifyPending: (p: PendingNotification) => void;
  /** Wait for a decision matching the given governance_event_id, or
   *  resolve to a non-decision outcome on timeout / disconnect. */
  awaitDecision: (geid: string, deadlineMs: number) => Promise<SocketResult>;
  close: () => void;
}

/**
 * Connect to the extension's approval socket. Resolves to a handle
 * that can send pendings and await decisions. If the extension
 * isn't running (no socket file, ECONNREFUSED, etc.) resolves to
 * `null` so the caller can fall back to pollApproval-only.
 */
export function connectApprovalSocket(
  socketPath: string = APPROVAL_SOCKET_PATH,
): Promise<ActiveConnection | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ path: socketPath });
    let settled = false;
    const onConnect = () => {
      if (settled) return;
      settled = true;
      resolve(buildHandle(socket));
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(null);
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
    // 200ms ceiling: if the socket isn't there in 200ms it isn't there.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(null);
    }, 200);
  });
}

function buildHandle(socket: net.Socket): ActiveConnection {
  let buffer = '';
  type DecisionListener = (r: SocketResult) => void;
  const listenersByGeid = new Map<string, DecisionListener[]>();

  const dispatch = (geid: string, r: SocketResult) => {
    const list = listenersByGeid.get(geid);
    if (!list) return;
    listenersByGeid.delete(geid);
    for (const l of list) {
      try {
        l(r);
      } catch {
        /* ignore */
      }
    }
  };

  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      try {
        const msg = JSON.parse(line) as {
          type?: string;
          governance_event_id?: string;
          decision?: string;
        };
        if (
          msg.type === 'decision' &&
          typeof msg.governance_event_id === 'string' &&
          (msg.decision === 'approve' || msg.decision === 'reject')
        ) {
          dispatch(msg.governance_event_id, {
            kind: 'decision',
            decision: msg.decision,
          });
        }
      } catch {
        /* ignore malformed line */
      }
    }
  });

  const drainAll = (r: SocketResult) => {
    for (const [geid] of [...listenersByGeid]) dispatch(geid, r);
  };
  socket.once('close', () => drainAll({ kind: 'closed' }));
  socket.once('error', () => drainAll({ kind: 'closed' }));

  return {
    socket,
    notifyPending: (p) => {
      try {
        socket.write(JSON.stringify({ type: 'pending', ...p }) + '\n');
      } catch {
        /* socket may be closing; the closed/timeout path will fire */
      }
    },
    awaitDecision: (geid, deadlineMs) =>
      new Promise<SocketResult>((resolve) => {
        const list = listenersByGeid.get(geid) ?? [];
        list.push(resolve);
        listenersByGeid.set(geid, list);
        if (deadlineMs > 0) {
          setTimeout(() => {
            const cur = listenersByGeid.get(geid);
            if (!cur) return;
            const idx = cur.indexOf(resolve);
            if (idx === -1) return;
            cur.splice(idx, 1);
            if (cur.length === 0) listenersByGeid.delete(geid);
            resolve({ kind: 'timeout' });
          }, deadlineMs);
        }
      }),
    close: () => {
      try {
        socket.end();
      } catch {
        /* ignore */
      }
    },
  };
}
