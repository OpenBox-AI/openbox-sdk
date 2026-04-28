import fs from 'node:fs';
import path from 'node:path';

export class SessionStore {
  private dir: string;

  constructor(sessionDir: string) {
    this.dir = sessionDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(conversationId: string): string {
    const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  save(conversationId: string, session: Record<string, unknown>): void {
    fs.writeFileSync(this.filePath(conversationId), JSON.stringify(session), 'utf-8');
  }

  load(conversationId: string): Record<string, unknown> | null {
    const fp = this.filePath(conversationId);
    if (!fs.existsSync(fp)) return null;
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  delete(conversationId: string): void {
    const fp = this.filePath(conversationId);
    try { fs.unlinkSync(fp); } catch { /* ignore */ }
  }

  cleanup(maxAgeMs = 86_400_000): void {
    try {
      const now = Date.now();
      for (const f of fs.readdirSync(this.dir)) {
        const fp = path.join(this.dir, f);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fp);
        }
      }
    } catch { /* ignore */ }
  }
}
