import * as vscode from 'vscode';
import WebSocket from 'ws';
import { ActivityEntry, BoardConfig, BoardStore, DEFAULT_CATEGORIES, Member, Task } from './store';

export interface CloudUser {
  id: string;
  login: string;
  name: string;
  email: string;
  gitEmail?: string;
  avatarUrl?: string;
}

export type CloudRole = 'owner' | 'admin' | 'member';

export interface CloudBoardMeta {
  id: string;
  name: string;
  repoKey: string;
  role: CloudRole;
  joinPolicy: 'approve' | 'code';
  inviteCode?: string;
  revision: number;
  members: (CloudUser & { role: CloudRole })[];
  requests: (CloudUser & { at: string })[];
}

export interface CloudBoardSummary {
  id: string;
  name: string;
  repoKey: string;
  owner?: CloudUser;
  role: CloudRole | null;
  pending: boolean;
  memberCount: number;
}

interface BoardPayload {
  board: CloudBoardMeta;
  config: BoardConfig;
  extraMembers: Member[];
  tasks: Task[];
  activity: ActivityEntry[];
}

export class CloudError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

const TOKEN_KEY = 'commitboard.cloudToken';
const USER_KEY = 'commitboard.cloudUser';
const GITHUB_SCOPES = ['read:user', 'user:email'];

/** HTTP client + session for the CommitBoard API. Sign-in uses VS Code's built-in GitHub account. */
export class CloudClient {
  private token?: string;
  user?: CloudUser;

  constructor(private ctx: vscode.ExtensionContext, private baseUrl: () => string) {}

  get configured(): boolean {
    return !!this.baseUrl();
  }

  get signedIn(): boolean {
    return !!this.token;
  }

  get sessionToken(): string | undefined {
    return this.token;
  }

  get wsUrl(): string {
    return this.baseUrl().replace(/\/+$/, '').replace(/^http/, 'ws') + '/ws';
  }

  async restore(): Promise<void> {
    this.token = (await this.ctx.secrets.get(TOKEN_KEY)) || undefined;
    this.user = this.ctx.globalState.get<CloudUser>(USER_KEY);
  }

  /** Interactive: shows VS Code's "Sign in with GitHub" consent. Silent: only reuses an existing GitHub session. */
  async signIn(gitEmail: string, interactive: boolean): Promise<boolean> {
    const session = await vscode.authentication.getSession(
      'github',
      GITHUB_SCOPES,
      interactive ? { createIfNone: true } : { silent: true }
    );
    if (!session) {
      return false;
    }
    const res = await this.request<{ token: string; user: CloudUser }>('POST', '/api/auth/github', { accessToken: session.accessToken, gitEmail }, false);
    this.token = res.token;
    this.user = res.user;
    await this.ctx.secrets.store(TOKEN_KEY, res.token);
    await this.ctx.globalState.update(USER_KEY, res.user);
    return true;
  }

  async signOut(): Promise<void> {
    this.token = undefined;
    this.user = undefined;
    await this.ctx.secrets.delete(TOKEN_KEY);
    await this.ctx.globalState.update(USER_KEY, undefined);
  }

  async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    if (!this.configured) {
      throw new CloudError('Cloud sync is not configured (commitboard.serverUrl is empty)', 0);
    }
    let res: Response;
    try {
      res = await fetch(this.baseUrl().replace(/\/+$/, '') + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(auth && this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new CloudError('Cannot reach the CommitBoard server. Check your internet connection.', 0);
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      if (res.status === 401 && auth) {
        await this.signOut();
      }
      throw new CloudError(data.error || `Server error (${res.status})`, res.status);
    }
    return data as T;
  }
}

/**
 * Cloud-backed board. Reads come from an in-memory copy so the UI stays instant;
 * writes are applied locally and sent to the server one at a time, in order.
 */
export class CloudStore implements BoardStore {
  readonly kind = 'cloud' as const;
  meta?: CloudBoardMeta;
  private config: BoardConfig = { project: '', sprints: [], activeSprintId: null, categories: [] };
  private tasks: Task[] = [];
  private extraMembers: Member[] = [];
  private activity: ActivityEntry[] = [];
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private refreshWanted = false;

  constructor(
    private client: CloudClient,
    readonly boardId: string,
    private onChange: () => void,
    private onError: (message: string) => void
  ) {}

  async refresh(): Promise<void> {
    if (this.pending > 0) {
      this.refreshWanted = true; // wait until our own writes land, or we'd flash old data
      return;
    }
    const p = await this.client.request<BoardPayload>('GET', `/api/boards/${this.boardId}/state`);
    this.apply(p);
    this.onChange();
  }

  apply(p: BoardPayload): void {
    this.meta = p.board;
    this.config = p.config;
    this.tasks = p.tasks;
    this.extraMembers = p.extraMembers;
    this.activity = p.activity;
    this.loaded = true;
  }

  private send(method: string, sub: string, body?: unknown): void {
    this.pending++;
    this.queue = this.queue
      .then(() => this.client.request(method, `/api/boards/${this.boardId}${sub}`, body))
      .catch((err: Error) => {
        this.onError(err.message);
        this.refreshWanted = true;
      })
      .finally(() => {
        this.pending--;
        if (this.pending === 0 && this.refreshWanted) {
          this.refreshWanted = false;
          this.refresh().catch(() => undefined);
        }
      });
  }

  isInitialized(): boolean {
    return this.loaded;
  }

  loadConfig(): BoardConfig {
    return { ...this.config, categories: this.config.categories?.length ? this.config.categories : DEFAULT_CATEGORIES };
  }

  saveConfig(c: BoardConfig): void {
    this.config = c;
    this.send('PUT', '/config', { config: c });
  }

  loadTasks(): Task[] {
    return this.tasks;
  }

  saveTask(t: Task): void {
    this.tasks = [...this.tasks.filter((x) => x.id !== t.id), t];
    this.send('PUT', `/tasks/${t.id}`, { task: t });
  }

  deleteTask(id: string): void {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.send('DELETE', `/tasks/${id}`);
  }

  loadMembers(): Member[] {
    return this.extraMembers;
  }

  saveMembers(m: Member[]): void {
    this.extraMembers = m;
    this.send('PUT', '/extra-members', { members: m });
  }

  loadActivity(): ActivityEntry[] {
    return this.activity;
  }

  appendActivity(entry: ActivityEntry): void {
    this.activity = [...this.activity, entry];
    this.send('POST', '/activity', { entry });
  }

  removeCommitLinks(email: string, hash: string): void {
    this.activity = this.activity.filter((a) => !(a.type === 'commit' && a.hash === hash && a.email === email));
    this.send('POST', '/commit-links/remove', { hash });
  }

  removeActivity(_email: string, id: string): void {
    this.activity = this.activity.filter((a) => a.id !== id);
    this.send('DELETE', `/activity/${encodeURIComponent(id)}`);
  }
}

export type LiveStatus = 'online' | 'connecting' | 'offline';

/** Live connection: the server pings "changed" when anyone edits the board. Reconnects with backoff. */
export class Realtime implements vscode.Disposable {
  status: LiveStatus = 'offline';
  private ws?: WebSocket;
  private boardId?: string;
  private retry?: NodeJS.Timeout;
  private backoff = 1000;
  private disposed = false;

  constructor(
    private client: CloudClient,
    private handlers: { onChanged(): void; onMembership(): void; onStatus(): void }
  ) {}

  connect(): void {
    if (this.disposed || !this.client.configured || !this.client.signedIn || this.ws) {
      return;
    }
    this.setStatus('connecting');
    const ws = new WebSocket(this.client.wsUrl);
    this.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: this.client.sessionToken })));
    ws.on('message', (raw) => {
      let msg: { type?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        this.backoff = 1000;
        this.setStatus('online');
        if (this.boardId) {
          ws.send(JSON.stringify({ type: 'subscribe', boardId: this.boardId }));
        }
      } else if (msg.type === 'changed') {
        this.handlers.onChanged();
      } else if (msg.type === 'membership') {
        this.handlers.onMembership();
      }
    });
    ws.on('close', () => {
      if (this.ws === ws) {
        this.ws = undefined;
      }
      this.setStatus('offline');
      if (!this.disposed && this.client.signedIn) {
        this.retry = setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
    });
    ws.on('error', () => undefined); // 'close' follows and schedules the retry
  }

  subscribe(boardId: string | undefined): void {
    this.boardId = boardId;
    if (boardId && this.ws?.readyState === WebSocket.OPEN && this.status === 'online') {
      this.ws.send(JSON.stringify({ type: 'subscribe', boardId }));
    }
  }

  close(): void {
    clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.setStatus('offline');
  }

  dispose(): void {
    this.disposed = true;
    this.close();
  }

  private setStatus(s: LiveStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.handlers.onStatus();
    }
  }
}
