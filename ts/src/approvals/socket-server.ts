// Unix-domain-socket server side of the OpenBox approval IPC. Hook
// subprocesses connect through `approvals/socket-client.ts` and push
// `pending` messages. The server hands each message to a consumer
// callback (typically the IDE extension's approval store) and
// exposes `writeDecision()` for sending an approve or reject reply
// back down the same connection.
//
// Wire format:
//
//   hook   -> server  {"type":"pending", governance_event_id,
//                       agent_id, hook_event_name, source, summary,
//                       reason, expires_at}
//   server -> hook    {"type":"decision", governance_event_id,
//                       decision}
//
// The server is platform-agnostic. The VS Code / Cursor extension
// layers its `vscode.Disposable` and `OutputChannel` glue on top of
// this class by instantiating it and providing an `onPending`
// callback that maps incoming messages into the extension's
// approval store. Any other host integration follows the same
// pattern.

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const RUN_DIR = path.join(os.homedir(), '.openbox', 'run');
const SOCKET_PATH = path.join(RUN_DIR, 'openbox.sock');

export interface ApprovalPendingMessage {
  type: 'pending';
  governance_event_id: string;
  agent_id: string;
  hook_event_name: string;
  source: 'cursor' | 'claude-code' | string;
  summary: string;
  reason: string;
  expires_at: string;
}

export interface ApprovalServerConnection {
  /** Pushes a `decision` message back to the hook subprocess on
   *  this connection. Safe to call multiple times; writes that
   *  arrive after the socket closes are dropped silently. */
  writeDecision(geid: string, decision: 'approve' | 'reject'): void;
  /** Governance event ids this connection currently holds. The
   *  server drops these from the consumer's resolver map when the
   *  connection closes (for example after a hook subprocess crash
   *  or exit). */
  readonly geids: ReadonlySet<string>;
}

export interface ApprovalSocketServerOptions {
  /** Override socket path. Defaults to
   *  `~/.openbox/run/openbox.sock`. */
  socketPath?: string;
  /** Diagnostic logger for non-fatal I/O errors. */
  log?: (line: string) => void;
}

export interface ApprovalSocketServerHandlers {
  /** Invoked when a pending message lands. The handler typically
   *  builds a host-side state record, attaches `conn.writeDecision`
   *  as the resolver, and stores the record. */
  onPending(msg: ApprovalPendingMessage, conn: ApprovalServerConnection): void;
  /** Invoked when a connection closes. The handler should release
   *  any resolver or state tied to the connection's governance
   *  event ids. */
  onConnectionClosed(conn: ApprovalServerConnection): void;
}

interface ConnState {
  socket: net.Socket;
  geids: Set<string>;
  iface: ApprovalServerConnection;
}

export class ApprovalSocketServer {
  private server: net.Server | undefined;
  private readonly conns = new Set<ConnState>();
  private readonly socketPath: string;
  private readonly log: (line: string) => void;

  constructor(
    private readonly handlers: ApprovalSocketServerHandlers,
    options: ApprovalSocketServerOptions = {},
  ) {
    this.socketPath = options.socketPath ?? SOCKET_PATH;
    this.log = options.log ?? (() => undefined);
  }

  /** Path the server is (or will be) listening on. */
  get path(): string {
    return this.socketPath;
  }

  start(): void {
    const runDir = path.dirname(this.socketPath);
    try {
      fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      this.log(`[socket] mkdir failed: ${String(err)}`);
    }
    // Stale socket from a previous crash blocks listen(); unlink first.
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      /* ENOENT is fine */
    }

    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.on('error', (err) => {
      this.log(`[socket] server error: ${String(err)}`);
    });
    this.server.listen(this.socketPath, () => {
      try {
        fs.chmodSync(this.socketPath, 0o600);
      } catch {
        /* ignore */
      }
      this.log(`[socket] listening at ${this.socketPath}`);
    });
  }

  private onConnection(socket: net.Socket): void {
    const geids = new Set<string>();
    const iface: ApprovalServerConnection = {
      geids,
      writeDecision: (geid, decision) => {
        try {
          socket.write(
            JSON.stringify({
              type: 'decision',
              governance_event_id: geid,
              decision,
            }) + '\n',
          );
        } catch {
          /* socket may be mid-close */
        }
      },
    };
    const conn: ConnState = { socket, geids, iface };
    this.conns.add(conn);

    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          const msg = JSON.parse(line) as ApprovalPendingMessage;
          if (msg.type !== 'pending') continue;
          if (!msg.governance_event_id) continue;
          geids.add(msg.governance_event_id);
          this.handlers.onPending(msg, iface);
        } catch (err) {
          this.log(`[socket] bad line: ${String(err)}`);
        }
      }
    });

    socket.on('error', () => undefined);
    socket.on('close', () => {
      this.conns.delete(conn);
      this.handlers.onConnectionClosed(iface);
    });
  }

  stop(): void {
    for (const conn of this.conns) {
      try {
        conn.socket.destroy();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    this.server?.close();
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      /* ignore */
    }
  }
}
