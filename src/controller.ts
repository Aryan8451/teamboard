import * as vscode from 'vscode';
import * as path from 'path';
import { ActivityEntry, BoardConfig, BoardStore, DATA_DIR, Member, newId, Status, Store, Task } from './store';
import { CommitStat, Git, GitAPI, GitRepository, getGitApi } from './git';
import { CloudBoardMeta, CloudBoardSummary, CloudClient, CloudError, CloudStore, CloudUser, LiveStatus, Realtime } from './cloud';

export const TAG_RE = /\[?#?(T-[A-Z0-9]{4})\]?/i;

const STATUS_LABEL: Record<Status, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  inprogress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

export interface BoardState {
  ready: boolean;
  initialized: boolean;
  me: Member;
  config: BoardConfig;
  tasks: Task[];
  members: Member[];
  activity: ActivityEntry[];
  commits: CommitStat[];
  currentTaskId: string | null;
  statsLoading: boolean;
  cloud: CloudState;
}

export interface CloudState {
  available: boolean; // server URL configured
  signedIn: boolean;
  user?: CloudUser;
  mode: 'local' | 'cloud';
  live: LiveStatus;
  board?: CloudBoardMeta;
  repoKey: string;
  repoBoards: CloudBoardSummary[];
  myBoards: CloudBoardSummary[];
  busy: boolean;
  error?: string;
  localHasData: boolean;
}

type Listener = (s: BoardState) => void;

interface LinkItem extends vscode.QuickPickItem {
  taskId?: string;
  note?: boolean;
  skip?: boolean;
  unlink?: boolean;
}

export class Controller implements vscode.Disposable {
  private store?: BoardStore; // the active board: local files or cloud
  private localStore?: Store;
  private cloudStore?: CloudStore;
  private cloud: CloudClient;
  private live: Realtime;
  private repoKey = '';
  private repoBoards: CloudBoardSummary[] = [];
  private myBoards: CloudBoardSummary[] = [];
  private cloudBusy = false;
  private cloudError?: string;
  private liveTimer?: NodeJS.Timeout;
  private git?: Git;
  private gitApi?: GitAPI;
  private me: Member = { name: 'You', email: '' };
  private commits: CommitStat[] = [];
  private statsLoading = false;
  private listeners = new Set<Listener>();
  private disposables: vscode.Disposable[] = [];
  private statsTimer?: NodeJS.Timeout;
  private fsTimer?: NodeJS.Timeout;
  private status: vscode.StatusBarItem;
  private prompting = false;

  constructor(private ctx: vscode.ExtensionContext) {
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.status.command = 'commitboard.setCurrentTask';
    // Cloud is optional: with it switched off, CommitBoard never talks to any server.
    this.cloud = new CloudClient(ctx, () => (this.cfg('cloud.enabled', true) ? this.cfg('serverUrl', '').trim() : ''));
    this.live = new Realtime(this.cloud, {
      onChanged: () => {
        // Coalesce bursts of edits into one re-fetch.
        clearTimeout(this.liveTimer);
        this.liveTimer = setTimeout(() => this.cloudStore?.refresh().then(() => this.cacheCloud()).catch(() => undefined), 300);
      },
      onMembership: () => this.onMembershipChanged(),
      onStatus: () => this.broadcast(),
    });
    this.disposables.push(this.status, this.live);
  }

  // ---------------------------------------------------------------- setup

  async init(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.renderStatus();
      return;
    }
    this.gitApi = await getGitApi().catch(() => undefined);
    const bin = this.gitApi?.git.path || 'git';
    const probe = new Git(folder.uri.fsPath, bin);
    const root = (await probe.topLevel()) || folder.uri.fsPath;
    this.git = new Git(root, bin);
    this.localStore = new Store(root);
    this.store = this.localStore;

    const id = await this.git.identity();
    this.me = { name: id.name || 'You', email: id.email || 'me@local' };
    this.repoKey = await this.git.remoteUrl();

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, `${DATA_DIR}/**`)
    );
    const onFs = () => {
      if (this.store?.kind !== 'local') {
        return;
      }
      clearTimeout(this.fsTimer);
      this.fsTimer = setTimeout(() => this.broadcast(), 250);
    };
    watcher.onDidChange(onFs);
    watcher.onDidCreate(onFs);
    watcher.onDidDelete(onFs);
    this.disposables.push(watcher);

    if (this.gitApi) {
      this.gitApi.repositories.forEach((r) => this.watchRepo(r));
      this.disposables.push(this.gitApi.onDidOpenRepository((r) => this.watchRepo(r)));
    }

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('commitboard')) {
          this.refreshStats();
        }
      })
    );

    await this.cloud.restore();
    await this.restoreCloudBoard();

    this.renderStatus();
    this.applyCommitTag();
    await this.refreshStats();
  }

  dispose(): void {
    clearTimeout(this.liveTimer);
    this.disposables.forEach((d) => d.dispose());
  }

  // ---------------------------------------------------------------- cloud boards

  private get wsBoardId(): string | undefined {
    return this.ctx.workspaceState.get<string>('cloudBoardId');
  }

  /** On startup: reopen the cloud board this workspace was using (cached copy first, so it works offline). */
  private async restoreCloudBoard(): Promise<void> {
    if (!this.cloud.configured || !this.cloud.signedIn) {
      return;
    }
    this.live.connect();
    const boardId = this.wsBoardId;
    if (boardId) {
      await this.openCloudBoard(boardId, true);
    }
    this.discoverBoards().catch(() => undefined);
  }

  private async openCloudBoard(boardId: string, quiet = false): Promise<boolean> {
    const store = new CloudStore(
      this.cloud,
      boardId,
      () => this.broadcast(),
      (msg) => {
        this.cloudError = msg;
        vscode.window.showWarningMessage(`CommitBoard: ${msg}`);
      }
    );
    const cached = this.ctx.workspaceState.get<Parameters<CloudStore['apply']>[0]>('cloudCache');
    if (cached && cached.board?.id === boardId) {
      store.apply(cached);
    }
    this.cloudStore = store;
    this.store = store;
    this.live.subscribe(boardId);
    await this.ctx.workspaceState.update('cloudBoardId', boardId);
    try {
      await store.refresh();
      this.cacheCloud();
      this.cloudError = undefined;
    } catch (e) {
      const err = e as CloudError;
      if (err.status === 403 || err.status === 404) {
        // Removed from the board, or it was deleted.
        await this.leaveCloudMode();
        if (!quiet) {
          vscode.window.showWarningMessage(`CommitBoard: ${err.message}`);
        }
        return false;
      }
      this.cloudError = err.message; // offline: keep the cached copy
    }
    this.broadcast();
    return true;
  }

  private cacheCloud(): void {
    const s = this.cloudStore;
    if (s?.meta) {
      this.ctx.workspaceState.update('cloudCache', {
        board: s.meta,
        config: s.loadConfig(),
        extraMembers: s.loadMembers(),
        tasks: s.loadTasks(),
        activity: s.loadActivity(),
      });
    }
  }

  private async leaveCloudMode(): Promise<void> {
    this.cloudStore = undefined;
    this.store = this.localStore;
    this.live.subscribe(undefined);
    await this.ctx.workspaceState.update('cloudBoardId', undefined);
    await this.ctx.workspaceState.update('cloudCache', undefined);
    this.broadcast();
  }

  private async discoverBoards(): Promise<void> {
    if (!this.cloud.signedIn) {
      return;
    }
    const res = await this.cloud.request<{ repoBoards: CloudBoardSummary[]; myBoards: CloudBoardSummary[] }>(
      'GET',
      `/api/boards?repo=${encodeURIComponent(this.repoKey)}`
    );
    this.repoBoards = res.repoBoards;
    this.myBoards = res.myBoards;
    this.broadcast();
  }

  private async onMembershipChanged(): Promise<void> {
    const wasPending = new Set(this.repoBoards.filter((b) => b.pending).map((b) => b.id));
    await this.discoverBoards().catch(() => undefined);
    const current = this.cloudStore?.boardId;
    if (current && !this.myBoards.some((b) => b.id === current)) {
      await this.leaveCloudMode();
      vscode.window.showWarningMessage('CommitBoard: you no longer have access to that team board.');
      return;
    }
    if (current) {
      await this.cloudStore?.refresh().catch(() => undefined);
      return;
    }
    const approved = this.repoBoards.find((b) => wasPending.has(b.id) && b.role);
    if (approved) {
      await this.openCloudBoard(approved.id);
      vscode.window.showInformationMessage(`🎉 You were accepted to the team board "${approved.name}".`);
    }
  }

  /** Runs a cloud action with a busy flag and friendly errors. */
  private async cloudAction(fn: () => Promise<void>): Promise<void> {
    this.cloudBusy = true;
    this.cloudError = undefined;
    this.broadcast();
    try {
      await fn();
    } catch (e) {
      this.cloudError = (e as Error).message;
      vscode.window.showErrorMessage(`CommitBoard: ${this.cloudError}`);
    } finally {
      this.cloudBusy = false;
      this.broadcast();
    }
  }

  async cloudSignIn(): Promise<void> {
    await this.cloudAction(async () => {
      if (!(await this.cloud.signIn(this.me.email, true))) {
        throw new Error('GitHub sign-in was cancelled');
      }
      this.live.connect();
      await this.discoverBoards();
    });
  }

  async cloudSignOut(): Promise<void> {
    this.live.close();
    await this.leaveCloudMode();
    await this.cloud.signOut();
    this.repoBoards = [];
    this.myBoards = [];
    this.broadcast();
  }

  private boardPath(sub = ''): string {
    return `/api/boards/${this.cloudStore?.boardId}${sub}`;
  }

  private async applyBoardPayload(p: Parameters<CloudStore['apply']>[0]): Promise<void> {
    this.cloudStore?.apply(p);
    this.cacheCloud();
    this.broadcast();
  }

  async handleCloudMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'cloudSignIn':
        return this.cloudSignIn();
      case 'cloudSignOut':
        return this.cloudSignOut();
      case 'cloudRefresh':
        return this.cloudAction(async () => {
          await this.discoverBoards();
          await this.cloudStore?.refresh();
        });
      case 'cloudCreate':
        return this.cloudAction(async () => {
          const local = this.localStore;
          const importLocal = !!msg.importLocal && !!local?.isInitialized();
          const p = await this.cloud.request<Parameters<CloudStore['apply']>[0]>('POST', '/api/boards', {
            name: String(msg.name || local?.loadConfig().project || 'Team board'),
            repo: this.repoKey,
            import: importLocal
              ? { config: local!.loadConfig(), tasks: local!.loadTasks(), activity: local!.loadActivity(), extraMembers: local!.loadMembers() }
              : undefined,
          });
          await this.ctx.workspaceState.update('cloudCache', p);
          await this.openCloudBoard(p.board.id);
          await this.discoverBoards();
          vscode.window.showInformationMessage(`CommitBoard: team board "${p.board.name}" created. Teammates who open this repo can now ask to join.`);
        });
      case 'cloudOpen':
        return this.cloudAction(async () => {
          await this.openCloudBoard(String(msg.boardId));
        });
      case 'cloudRequestJoin':
        return this.cloudAction(async () => {
          await this.cloud.request('POST', `/api/boards/${msg.boardId}/requests`);
          await this.discoverBoards();
        });
      case 'cloudCancelRequest':
        return this.cloudAction(async () => {
          await this.cloud.request('DELETE', `/api/boards/${msg.boardId}/requests/me`);
          await this.discoverBoards();
        });
      case 'cloudJoinCode': {
        const code = await vscode.window.showInputBox({ title: 'Join a team board', prompt: 'Enter the invite code from the board owner', placeHolder: 'ABCD-EFGH', ignoreFocusOut: true });
        if (!code) {
          return;
        }
        return this.cloudAction(async () => {
          const res = await this.cloud.request<{ status: string; boardId: string }>('POST', '/api/boards/join', { code });
          await this.discoverBoards();
          if (res.status === 'member') {
            await this.openCloudBoard(res.boardId);
          } else {
            vscode.window.showInformationMessage('CommitBoard: request sent. You will get access as soon as the owner approves.');
          }
        });
      }
      case 'cloudDecide':
        return this.cloudAction(async () => {
          await this.applyBoardPayload(await this.cloud.request('POST', this.boardPath(`/requests/${msg.userId}/${msg.approve ? 'approve' : 'reject'}`)));
        });
      case 'cloudSetRole':
        return this.cloudAction(async () => {
          await this.applyBoardPayload(await this.cloud.request('PATCH', this.boardPath(`/members/${msg.userId}`), { role: msg.role }));
        });
      case 'cloudRemoveMember': {
        const ok = await vscode.window.showWarningMessage(`Remove ${msg.name || 'this person'} from the team board?`, { modal: true }, 'Remove');
        if (ok) {
          return this.cloudAction(async () => {
            await this.cloud.request('DELETE', this.boardPath(`/members/${msg.userId}`));
            await this.cloudStore?.refresh();
          });
        }
        return;
      }
      case 'cloudSettings':
        return this.cloudAction(async () => {
          await this.applyBoardPayload(await this.cloud.request('PATCH', this.boardPath('/settings'), msg.settings));
        });
      case 'cloudLeave': {
        const ok = await vscode.window.showWarningMessage('Leave this team board? You will need to ask to join again.', { modal: true }, 'Leave');
        if (ok) {
          return this.cloudAction(async () => {
            await this.cloud.request('DELETE', this.boardPath('/members/me'));
            await this.leaveCloudMode();
            await this.discoverBoards();
          });
        }
        return;
      }
      case 'cloudDelete': {
        const ok = await vscode.window.showWarningMessage('Delete this team board for everyone? All tasks and activity will be lost.', { modal: true }, 'Delete board');
        if (ok) {
          return this.cloudAction(async () => {
            await this.cloud.request('DELETE', this.boardPath());
            await this.leaveCloudMode();
            await this.discoverBoards();
          });
        }
        return;
      }
      case 'useLocal':
        return this.leaveCloudMode();
      case 'copy':
        await vscode.env.clipboard.writeText(String(msg.text || ''));
        vscode.window.setStatusBarMessage('$(check) Copied', 2000);
        return;
    }
  }

  onState(fn: Listener): vscode.Disposable {
    this.listeners.add(fn);
    fn(this.getState());
    return new vscode.Disposable(() => this.listeners.delete(fn));
  }

  private cfg<T>(key: string, def: T): T {
    return vscode.workspace.getConfiguration('commitboard').get<T>(key, def);
  }

  // ---------------------------------------------------------------- state

  get currentTaskId(): string | null {
    return this.ctx.workspaceState.get<string | null>('currentTaskId', null);
  }

  getState(): BoardState {
    const s = this.store;
    const tasks = s ? s.loadTasks() : [];
    let current = this.currentTaskId;
    if (current && !tasks.some((t) => t.id === current)) {
      current = null;
    }
    const meta = this.cloudStore && s === this.cloudStore ? this.cloudStore.meta : undefined;
    // Cloud members (signed-in teammates) are people too: they can be assigned and ranked.
    const cloudPeople: Member[] = (meta?.members || []).map((m) => ({
      name: m.name || m.login,
      email: (m.gitEmail || m.email || `${m.login}@users.noreply.github.com`).toLowerCase(),
      role: m.role === 'member' ? undefined : m.role,
    }));
    return {
      ready: !!s,
      initialized: !!s?.isInitialized(),
      me: this.me,
      config: s ? s.loadConfig() : { project: 'No folder open', sprints: [], activeSprintId: null, categories: [] },
      tasks,
      members: s ? [...cloudPeople, ...s.loadMembers()] : [],
      activity: s ? s.loadActivity() : [],
      commits: this.commits,
      currentTaskId: current,
      statsLoading: this.statsLoading,
      cloud: {
        available: this.cloud.configured,
        signedIn: this.cloud.signedIn,
        user: this.cloud.user,
        mode: s?.kind === 'cloud' ? 'cloud' : 'local',
        live: this.live.status,
        board: meta,
        repoKey: this.repoKey,
        repoBoards: this.repoBoards,
        myBoards: this.myBoards,
        busy: this.cloudBusy,
        error: this.cloudError,
        localHasData: !!this.localStore?.isInitialized(),
      },
    };
  }

  broadcast(): void {
    const st = this.getState();
    this.listeners.forEach((l) => l(st));
    this.renderStatus(st);
  }

  scheduleStatsRefresh(): void {
    clearTimeout(this.statsTimer);
    this.statsTimer = setTimeout(() => this.refreshStats(), 1500);
  }

  async refreshStats(): Promise<void> {
    if (!this.git) {
      return;
    }
    this.statsLoading = true;
    this.broadcast();
    try {
      this.commits = await this.git.commitStats(
        this.cfg('maxCommits', 5000),
        this.cfg<string[]>('excludeFromLineStats', [])
      );
    } finally {
      this.statsLoading = false;
      this.broadcast();
    }
  }

  /** CommitBoard only acts in projects that have a board (.commitboard/ exists). */
  private get boardActive(): boolean {
    return !!this.store?.isInitialized();
  }

  private renderStatus(st = this.getState()): void {
    if (!st.ready || !st.initialized) {
      this.status.hide();
      return;
    }
    const t = st.tasks.find((x) => x.id === st.currentTaskId);
    if (t) {
      this.status.text = `$(target) ${t.id}: ${t.title.length > 32 ? t.title.slice(0, 31) + '…' : t.title}`;
      this.status.tooltip = `CommitBoard — current task (${STATUS_LABEL[t.status]})\nClick to change`;
    } else {
      this.status.text = '$(target) Pick a task';
      this.status.tooltip = 'CommitBoard — no current task. Click to choose one.';
    }
    this.status.show();
  }

  // ---------------------------------------------------------------- tasks

  private requireStore(): BoardStore {
    if (!this.store) {
      throw new Error('Open a folder to use CommitBoard.');
    }
    return this.store;
  }

  private findTask(id: string): Task | undefined {
    return this.store?.loadTasks().find((t) => t.id === id);
  }

  private uniqueTaskId(): string {
    const taken = new Set(this.store?.loadTasks().map((t) => t.id));
    let id = newId('T');
    while (taken.has(id)) {
      id = newId('T');
    }
    return id;
  }

  private logEvent(taskId: string, message: string): void {
    this.requireStore().appendActivity({
      id: newId('A'),
      type: 'event',
      date: new Date().toISOString(),
      author: this.me.name,
      email: this.me.email,
      taskId,
      message,
    });
  }

  saveTask(input: Partial<Task>): Task {
    const store = this.requireStore();
    const now = new Date().toISOString();
    const existing = input.id ? this.findTask(input.id) : undefined;
    const task: Task = {
      id: existing?.id || this.uniqueTaskId(),
      title: (input.title ?? existing?.title ?? 'Untitled').trim() || 'Untitled',
      description: input.description ?? existing?.description ?? '',
      status: input.status ?? existing?.status ?? 'todo',
      priority: input.priority ?? existing?.priority ?? 'medium',
      points: Number(input.points ?? existing?.points ?? 1) || 0,
      assignee: input.assignee !== undefined ? input.assignee || null : existing?.assignee ?? null,
      labels: input.labels ?? existing?.labels ?? [],
      sprintId: input.sprintId !== undefined ? input.sprintId || null : existing?.sprintId ?? null,
      createdBy: existing?.createdBy || this.me.email,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      doneAt: existing?.doneAt,
    };
    if (task.status === 'done' && existing?.status !== 'done') {
      task.doneAt = now;
    } else if (task.status !== 'done') {
      task.doneAt = undefined;
    }
    store.saveTask(task);
    if (!existing) {
      this.logEvent(task.id, `created “${task.title}”`);
    } else if (existing.status !== task.status) {
      this.logEvent(task.id, `moved to ${STATUS_LABEL[task.status]}`);
    }
    if (existing && existing.assignee !== task.assignee && task.assignee) {
      this.logEvent(task.id, `assigned to ${task.assignee === this.me.email ? 'themselves' : task.assignee}`);
    }
    this.broadcast();
    return task;
  }

  moveTask(id: string, status: Status): void {
    const t = this.findTask(id);
    if (t && t.status !== status) {
      this.saveTask({ id, status });
      if (status === 'done' && this.currentTaskId === id) {
        this.setCurrentTask(null);
      }
    }
  }

  deleteTask(id: string): void {
    this.requireStore().deleteTask(id);
    if (this.currentTaskId === id) {
      this.setCurrentTask(null);
    }
    this.broadcast();
  }

  pickTask(id: string): void {
    const t = this.findTask(id);
    if (!t) {
      return;
    }
    this.saveTask({
      id,
      assignee: this.me.email,
      status: t.status === 'backlog' || t.status === 'todo' ? 'inprogress' : t.status,
    });
    this.setCurrentTask(id);
    vscode.window.showInformationMessage(`🎯 You picked up ${t.id}: ${t.title}. New commits will be linked to it.`);
  }

  setCurrentTask(id: string | null): void {
    this.ctx.workspaceState.update('currentTaskId', id).then(() => {
      this.applyCommitTag();
      this.broadcast();
    });
  }

  /** Pre-fill the SCM commit box with the current task tag. */
  private applyCommitTag(): void {
    if (!this.cfg('autoTagCommitMessage', true) || !this.gitApi || !this.boardActive) {
      return;
    }
    const id = this.currentTaskId;
    for (const repo of this.gitApi.repositories) {
      const v = repo.inputBox.value;
      const stripped = v.replace(/^\[T-[A-Z0-9]{4}\]\s*/i, '');
      repo.inputBox.value = id ? `[${id}] ${stripped}` : stripped;
    }
  }

  // ---------------------------------------------------------------- sprints & members

  saveSprint(sp: { id?: string; name: string; start: string; end: string; goal: string; makeActive?: boolean }): void {
    const store = this.requireStore();
    const cfg = store.loadConfig();
    const id = sp.id || newId('S');
    const sprint = { id, name: sp.name.trim() || 'Sprint', start: sp.start, end: sp.end, goal: sp.goal || '' };
    const i = cfg.sprints.findIndex((s) => s.id === id);
    if (i >= 0) {
      cfg.sprints[i] = sprint;
    } else {
      cfg.sprints.push(sprint);
    }
    if (sp.makeActive || !cfg.activeSprintId) {
      cfg.activeSprintId = id;
    }
    store.saveConfig(cfg);
    this.broadcast();
  }

  setActiveSprint(id: string | null): void {
    const store = this.requireStore();
    const cfg = store.loadConfig();
    cfg.activeSprintId = id;
    store.saveConfig(cfg);
    this.broadcast();
  }

  deleteSprint(id: string): void {
    const store = this.requireStore();
    const cfg = store.loadConfig();
    cfg.sprints = cfg.sprints.filter((s) => s.id !== id);
    if (cfg.activeSprintId === id) {
      cfg.activeSprintId = cfg.sprints[0]?.id ?? null;
    }
    store.saveConfig(cfg);
    for (const t of store.loadTasks().filter((t) => t.sprintId === id)) {
      store.saveTask({ ...t, sprintId: null });
    }
    this.broadcast();
  }

  saveMember(m: Member): void {
    const store = this.requireStore();
    const list = store.loadMembers();
    const email = m.email.trim().toLowerCase();
    if (!email) {
      return;
    }
    const i = list.findIndex((x) => x.email === email);
    const member = { name: m.name.trim() || email, email, role: m.role?.trim() || undefined };
    if (i >= 0) {
      list[i] = member;
    } else {
      list.push(member);
    }
    store.saveMembers(list);
    this.broadcast();
  }

  removeMember(email: string): void {
    const store = this.requireStore();
    store.saveMembers(store.loadMembers().filter((m) => m.email !== email));
    this.broadcast();
  }

  renameProject(name: string): void {
    const store = this.requireStore();
    const cfg = store.loadConfig();
    cfg.project = name.trim() || cfg.project;
    store.saveConfig(cfg);
    this.broadcast();
  }

  // ---------------------------------------------------------------- activity

  logWork(e: { message: string; category?: string; hours?: number; taskId?: string; date?: string }): void {
    this.requireStore().appendActivity({
      id: newId('A'),
      type: 'external',
      date: e.date ? new Date(e.date).toISOString() : new Date().toISOString(),
      author: this.me.name,
      email: this.me.email,
      message: e.message.trim(),
      category: e.category || 'Other',
      hours: Number(e.hours) || 0,
      taskId: e.taskId || undefined,
    });
    this.broadcast();
  }

  deleteActivity(email: string, id: string): void {
    if (email !== this.me.email) {
      return; // only edit your own log
    }
    this.requireStore().removeActivity(email, id);
    this.broadcast();
  }

  private linkedHashes(): Set<string> {
    return new Set(
      (this.store?.loadActivity() || []).filter((a) => a.type === 'commit' && a.hash).map((a) => a.hash as string)
    );
  }

  private recordCommit(hash: string, subject: string, taskId?: string, note?: string, category?: string, unlinked?: boolean): void {
    const store = this.requireStore();
    store.removeCommitLinks(this.me.email, hash);
    store.appendActivity({
      id: newId('A'),
      type: 'commit',
      date: new Date().toISOString(),
      author: this.me.name,
      email: this.me.email,
      hash,
      taskId,
      message: note || subject,
      category,
      unlinked: unlinked || undefined,
    });
    this.broadcast();
  }

  /** Latest link wins, whoever made it (so mistakes can be fixed by re-linking). */
  private currentLink(hash: string): ActivityEntry | undefined {
    return (this.store?.loadActivity() || [])
      .filter((a) => a.type === 'commit' && a.hash === hash)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
  }

  // ---------------------------------------------------------------- commit / push detection

  private watchRepo(repo: GitRepository): void {
    if (this.git && path.resolve(repo.rootUri.fsPath).toLowerCase() !== path.resolve(this.git.cwd).toLowerCase()) {
      return;
    }
    let lastHead = repo.state.HEAD?.commit;
    let lastAhead = repo.state.HEAD?.ahead ?? 0;
    this.disposables.push(
      repo.state.onDidChange(() => {
        const head = repo.state.HEAD?.commit;
        const ahead = repo.state.HEAD?.ahead ?? 0;
        if (head && head !== lastHead) {
          const prev = lastHead;
          lastHead = head;
          if (prev) {
            this.onHeadMoved(repo, head, prev);
          }
          this.scheduleStatsRefresh();
        } else if (head && lastAhead > 0 && ahead === 0 && (repo.state.HEAD?.behind ?? 0) === 0) {
          this.onPushed(lastAhead);
        }
        lastAhead = ahead;
      })
    );
  }

  private async onHeadMoved(repo: GitRepository, head: string, prev: string): Promise<void> {
    let c;
    try {
      c = await repo.getCommit(head);
    } catch {
      return;
    }
    const fresh = c.authorDate ? Date.now() - c.authorDate.getTime() < 5 * 60_000 : true;
    const mine = !c.authorEmail || c.authorEmail.toLowerCase() === this.me.email;
    if (!fresh || !mine || c.parents[0] !== prev) {
      return; // checkout, pull, rebase… not a fresh commit of ours
    }
    // The SCM box is cleared after a commit: re-apply the tag for the next one.
    setTimeout(() => this.applyCommitTag(), 300);
    await this.handleNewCommit(head, c.message.split('\n')[0]);
  }

  private async handleNewCommit(hash: string, subject: string): Promise<void> {
    if (!this.boardActive || this.linkedHashes().has(hash)) {
      return;
    }
    const tag = TAG_RE.exec(subject)?.[1]?.toUpperCase();
    const tagged = tag ? this.findTask(tag) : undefined;
    if (tagged) {
      this.recordCommit(hash, subject, tagged.id);
      this.offerStatusMove(tagged, hash, subject);
      return;
    }
    if (this.cfg('commitPrompt', 'always') === 'always') {
      await this.promptLink(hash, subject);
    }
  }

  private async onPushed(count: number): Promise<void> {
    if (!this.cfg('promptOnPush', true) || !this.git || this.prompting || !this.boardActive) {
      return;
    }
    const linked = this.linkedHashes();
    const recent = await this.git.recentCommits(Math.min(count, 20)).catch(() => []);
    const unlinked = recent.filter((c) => c.email === this.me.email && !linked.has(c.hash) && !TAG_RE.test(c.subject));
    if (!unlinked.length) {
      vscode.window.setStatusBarMessage(`$(check) CommitBoard: pushed ${count} commit(s), all linked`, 4000);
      return;
    }
    const pick = await vscode.window.showInformationMessage(
      `🚀 Pushed ${count} commit(s). ${unlinked.length} aren't linked to a task yet. What were they for?`,
      'Link now',
      'Later'
    );
    if (pick === 'Link now') {
      for (const c of unlinked) {
        const ok = await this.promptLink(c.hash, c.subject, false);
        if (!ok) {
          break;
        }
      }
    }
  }

  async linkLastCommit(hash?: string): Promise<void> {
    if (!this.git) {
      return;
    }
    let target = hash ? (await this.git.recentCommits(500)).find((c) => c.hash === hash) : undefined;
    if (!target) {
      target = (await this.git.recentCommits(1).catch(() => []))[0];
    }
    if (!target) {
      vscode.window.showWarningMessage('CommitBoard: no commits found in this repository yet.');
      return;
    }
    await this.promptLink(target.hash, target.subject, true);
  }

  /** The "What was this commit for?" window. Resolves false if dismissed. */
  async promptLink(hash: string, subject: string, relink = false): Promise<boolean> {
    if (this.prompting) {
      return false;
    }
    this.prompting = true;
    try {
      return await this.showLinkPicker(hash, subject, relink);
    } finally {
      this.prompting = false;
    }
  }

  private showLinkPicker(hash: string, subject: string, relink: boolean): Promise<boolean> {
    const tasks = this.store?.loadTasks() || [];
    const existing = relink ? this.currentLink(hash) : undefined;
    const tag = TAG_RE.exec(subject)?.[1]?.toUpperCase();
    const linkedTo = existing ? existing.taskId : tag;
    const current = tasks.find((t) => t.id === this.currentTaskId);
    const open = tasks.filter((t) => t.status !== 'done' && t.id !== current?.id);
    const mine = open.filter((t) => t.assignee === this.me.email);
    const others = open.filter((t) => t.assignee !== this.me.email);
    const toItem = (t: Task, icon: string): LinkItem => ({
      label: `$(${icon}) ${t.id}  ${t.title}`,
      description: `${STATUS_LABEL[t.status]} · ${t.priority}${t.assignee && t.assignee !== this.me.email ? ' · ' + t.assignee : ''}`,
      taskId: t.id,
    });
    const sep = (label: string): LinkItem => ({ label, kind: vscode.QuickPickItemKind.Separator });

    const base: LinkItem[] = [];
    if (current) {
      base.push(sep('Current task'), { ...toItem(current, 'target'), detail: '★ Press Enter to link to your current task', picked: true });
    }
    if (mine.length) {
      base.push(sep('My tasks'), ...mine.map((t) => toItem(t, 'person')));
    }
    if (others.length) {
      base.push(sep('Team tasks'), ...others.map((t) => toItem(t, 'circle-outline')));
    }
    base.push(
      sep('Other'),
      { label: '$(add) Create a new task from this commit', taskId: '__new__', alwaysShow: true },
      { label: '$(note) Not a task — just type a note above (e.g. "Marketing: landing copy")', note: true, alwaysShow: true }
    );
    if (relink && linkedTo) {
      base.push({ label: '$(debug-disconnect) Remove link (not for any task)', unlink: true, alwaysShow: true });
    }
    base.push({ label: relink ? '$(close) Cancel — keep as is' : '$(close) Skip', skip: true, alwaysShow: true });

    return new Promise((resolve) => {
      const qp = vscode.window.createQuickPick<LinkItem>();
      qp.title = relink
        ? `CommitBoard · Change task for commit ${hash.slice(0, 7)}${linkedTo ? ` (currently ${linkedTo})` : ''}`
        : `CommitBoard · What was commit ${hash.slice(0, 7)} for?`;
      qp.placeholder = `“${subject}” — pick a task, or type a note and press Enter`;
      qp.ignoreFocusOut = true;
      qp.matchOnDescription = true;
      qp.items = base;
      let done = false;

      qp.onDidChangeValue((v) => {
        const note = v.trim();
        qp.items = note
          ? [{ label: `$(edit) Save note: “${note}”`, description: 'for external / non-task work', note: true, alwaysShow: true }, ...base]
          : base;
      });

      qp.onDidAccept(async () => {
        const sel = qp.selectedItems[0] || qp.activeItems[0];
        const typed = qp.value.trim();
        done = true;
        qp.hide();
        if (!sel || sel.skip) {
          resolve(true);
          return;
        }
        if (sel.unlink) {
          this.recordCommit(hash, subject, undefined, undefined, undefined, true);
          vscode.window.setStatusBarMessage(`$(debug-disconnect) CommitBoard: ${hash.slice(0, 7)} unlinked`, 4000);
          resolve(true);
          return;
        }
        if (sel.note) {
          const note = typed || (await vscode.window.showInputBox({ title: 'What was this commit for?', prompt: 'e.g. Marketing: update pricing page copy', ignoreFocusOut: true }));
          if (note) {
            const category = await vscode.window.showQuickPick(this.store?.loadConfig().categories || [], {
              title: 'Category (optional)',
              placeHolder: 'Pick a category or press Esc to skip',
            });
            this.recordCommit(hash, subject, undefined, note, category);
            vscode.window.setStatusBarMessage(`$(note) CommitBoard: note saved for ${hash.slice(0, 7)}`, 4000);
          }
          resolve(true);
          return;
        }
        let task = sel.taskId === '__new__' ? undefined : tasks.find((t) => t.id === sel.taskId);
        if (sel.taskId === '__new__') {
          const title = await vscode.window.showInputBox({ title: 'New task title', value: subject, ignoreFocusOut: true });
          if (!title) {
            resolve(true);
            return;
          }
          task = this.saveTask({ title, status: 'inprogress', assignee: this.me.email });
        }
        if (task) {
          this.recordCommit(hash, subject, task.id);
          if (!this.currentTaskId) {
            this.setCurrentTask(task.id);
          }
          this.offerStatusMove(task, hash, subject);
        }
        resolve(true);
      });

      qp.onDidHide(() => {
        qp.dispose();
        if (!done) {
          resolve(false);
        }
      });
      qp.show();
      if (current) {
        const first = qp.items.find((i) => i.taskId === current.id);
        if (first) {
          qp.activeItems = [first];
        }
      }
    });
  }

  private async offerStatusMove(task: Task, hash: string, subject: string): Promise<void> {
    const CHANGE = 'Wrong task? Change';
    const actions = task.status === 'done' ? [] : task.status === 'review' ? ['Mark Done'] : ['Move to Review', 'Mark Done'];
    const pick = await vscode.window.showInformationMessage(`🔗 Commit ${hash.slice(0, 7)} linked to ${task.id}: ${task.title}`, ...actions, CHANGE);
    if (pick === 'Move to Review') {
      this.moveTask(task.id, 'review');
    } else if (pick === 'Mark Done') {
      this.moveTask(task.id, 'done');
    } else if (pick === CHANGE) {
      await this.promptLink(hash, subject, true);
    }
  }

  // ---------------------------------------------------------------- command helpers

  async quickPickCurrentTask(): Promise<void> {
    const st = this.getState();
    const open = st.tasks.filter((t) => t.status !== 'done');
    type Item = vscode.QuickPickItem & { id?: string | null };
    const items: Item[] = [
      ...open
        .sort((a, b) => Number(b.assignee === st.me.email) - Number(a.assignee === st.me.email))
        .map((t) => ({
          label: `${t.id === st.currentTaskId ? '$(target)' : t.assignee === st.me.email ? '$(person)' : '$(circle-outline)'} ${t.id}  ${t.title}`,
          description: `${STATUS_LABEL[t.status]}${t.assignee ? ' · ' + (t.assignee === st.me.email ? 'you' : t.assignee) : ' · unassigned'}`,
          id: t.id,
        })),
      { label: '$(add) New task…', id: '__new__' },
      { label: '$(circle-slash) Clear current task', id: null },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: 'CommitBoard · What are you working on?', matchOnDescription: true });
    if (!pick) {
      return;
    }
    if (pick.id === '__new__') {
      await this.quickNewTask(true);
    } else if (pick.id) {
      const t = open.find((x) => x.id === pick.id);
      if (t && t.assignee !== st.me.email) {
        this.pickTask(t.id);
      } else {
        this.setCurrentTask(pick.id);
      }
    } else {
      this.setCurrentTask(null);
    }
  }

  async quickNewTask(pickUp = false): Promise<void> {
    const title = await vscode.window.showInputBox({ title: 'CommitBoard · New task', prompt: 'Task title', ignoreFocusOut: true });
    if (!title) {
      return;
    }
    const t = this.saveTask({ title, status: 'todo' });
    if (pickUp) {
      this.pickTask(t.id);
    }
  }

  async quickLogWork(): Promise<void> {
    const st = this.getState();
    type Item = vscode.QuickPickItem & { id?: string };
    const open = st.tasks.filter((t) => t.status !== 'done');
    const items: Item[] = [
      { label: '$(circle-slash) No specific task', id: '' },
      ...open
        .sort((a, b) => Number(b.id === st.currentTaskId) - Number(a.id === st.currentTaskId) || Number(b.assignee === st.me.email) - Number(a.assignee === st.me.email))
        .map((t) => ({ label: `${t.id === st.currentTaskId ? '$(target)' : '$(circle-outline)'} ${t.id}  ${t.title}`, description: STATUS_LABEL[t.status], id: t.id })),
    ];
    const target = await vscode.window.showQuickPick(items, { title: 'CommitBoard · Add update — which task is it for?', matchOnDescription: true });
    if (!target) {
      return;
    }
    const message = await vscode.window.showInputBox({
      title: 'CommitBoard · Add update',
      prompt: 'What did you do? (e.g. "Wrote launch blog post", "Client call") — no commit needed',
      ignoreFocusOut: true,
    });
    if (!message) {
      return;
    }
    const category = await vscode.window.showQuickPick(st.config.categories, { title: 'Category' });
    const hours = await vscode.window.showInputBox({ title: 'Hours spent (optional)', value: '1', validateInput: (v) => (v && isNaN(Number(v)) ? 'Enter a number' : undefined) });
    this.logWork({ message, category: category || 'Other', hours: Number(hours) || 0, taskId: target.id || undefined });
    const task = open.find((t) => t.id === target.id);
    if (task) {
      const pick = await vscode.window.showInformationMessage(`✅ Update posted on ${task.id}. Is the task finished?`, 'Mark Done', 'Send to Review', 'Still working');
      if (pick === 'Mark Done') {
        this.moveTask(task.id, 'done');
      } else if (pick === 'Send to Review') {
        this.moveTask(task.id, 'review');
      }
    } else {
      vscode.window.setStatusBarMessage('$(check) CommitBoard: update posted', 3000);
    }
  }

  // ---------------------------------------------------------------- webview messages

  async handleMessage(msg: any, openBoard: (tab?: string, taskId?: string) => void): Promise<void> {
    try {
      switch (msg.type) {
        case 'saveTask': {
          const t = this.saveTask(msg.task);
          if (msg.setCurrent) {
            this.setCurrentTask(t.id);
          }
          return;
        }
        case 'moveTask': return this.moveTask(msg.id, msg.status);
        case 'deleteTask': {
          const ok = await vscode.window.showWarningMessage(`Delete task ${msg.id}?`, { modal: true }, 'Delete');
          if (ok) {
            this.deleteTask(msg.id);
          }
          return;
        }
        case 'pickTask': return this.pickTask(msg.id);
        case 'setCurrent': return this.setCurrentTask(msg.id);
        case 'logWork': return this.logWork(msg.entry);
        case 'deleteActivity': return this.deleteActivity(msg.email, msg.id);
        case 'saveSprint': return this.saveSprint(msg.sprint);
        case 'setActiveSprint': return this.setActiveSprint(msg.id);
        case 'deleteSprint': return this.deleteSprint(msg.id);
        case 'saveMember': return this.saveMember(msg.member);
        case 'removeMember': return this.removeMember(msg.email);
        case 'renameProject': return this.renameProject(msg.name);
        case 'linkCommit': return void this.linkLastCommit(msg.hash);
        case 'refresh': return void this.refreshStats();
        case 'openBoard': return openBoard(msg.tab, msg.taskId);
        case 'command': return void vscode.commands.executeCommand(msg.command);
        default:
          if (typeof msg.type === 'string' && (msg.type.startsWith('cloud') || msg.type === 'useLocal' || msg.type === 'copy')) {
            return this.handleCloudMessage(msg);
          }
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`CommitBoard: ${e?.message || e}`);
    }
  }
}
