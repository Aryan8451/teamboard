import * as fs from 'fs';
import * as path from 'path';

export type Status = 'backlog' | 'todo' | 'inprogress' | 'review' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  points: number;
  assignee: string | null; // email
  labels: string[];
  sprintId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  doneAt?: string;
}

export interface Sprint {
  id: string;
  name: string;
  start: string; // yyyy-mm-dd
  end: string;
  goal: string;
}

export interface Member {
  name: string;
  email: string;
  role?: string;
}

export interface ActivityEntry {
  id: string;
  type: 'commit' | 'external' | 'event';
  date: string;
  author: string;
  email: string;
  taskId?: string;
  hash?: string;
  message: string;
  category?: string;
  hours?: number;
  /** commit entries: explicitly "not for any task" (overrides a [T-XXXX] tag) */
  unlinked?: boolean;
}

export interface BoardConfig {
  project: string;
  sprints: Sprint[];
  activeSprintId: string | null;
  categories: string[];
}

export const DATA_DIR = '.commitboard';

export const DEFAULT_CATEGORIES =['Marketing', 'Design', 'Meeting', 'Research', 'Support', 'Docs', 'Planning', 'Other'];

const README = `# CommitBoard data

This folder is managed by the **CommitBoard** VS Code extension.
Commit it to git so your whole team shares the same board — no server needed.

- \`config.json\`   project name, sprints, work categories
- \`members.json\`  people added manually (e.g. marketing, design)
- \`tasks/\`        one file per task (keeps merge conflicts rare)
- \`activity/\`     one file per contributor: commit links, external work, task events
`;

export function newId(prefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${s}`;
}

function slug(email: string): string {
  return (email || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/** Where a board lives: local files in the repo, or the CommitBoard cloud. Methods are sync; cloud keeps a cache. */
export interface BoardStore {
  readonly kind: 'local' | 'cloud';
  isInitialized(): boolean;
  loadConfig(): BoardConfig;
  saveConfig(c: BoardConfig): void;
  loadTasks(): Task[];
  saveTask(t: Task): void;
  deleteTask(id: string): void;
  loadMembers(): Member[];
  saveMembers(m: Member[]): void;
  loadActivity(): ActivityEntry[];
  appendActivity(entry: ActivityEntry): void;
  removeCommitLinks(email: string, hash: string): void;
  removeActivity(email: string, id: string): void;
}

export class Store implements BoardStore {
  readonly kind = 'local' as const;

  constructor(public readonly root: string) {
    this.migrateLegacyDir();
  }

  /** Boards made before the rename lived in .teamboard/; move them so nobody loses data. */
  private migrateLegacyDir(): void {
    const legacy = path.join(this.root, '.teamboard');
    try {
      if (fs.existsSync(path.join(legacy, 'config.json')) && !fs.existsSync(this.dir)) {
        fs.renameSync(legacy, this.dir);
      }
    } catch {
      // read-only folder or locked file: leave the old board where it is
    }
  }

  get dir(): string {
    return path.join(this.root, DATA_DIR);
  }

  isInitialized(): boolean {
    return fs.existsSync(path.join(this.dir, 'config.json'));
  }

  private ensure(): void {
    if (this.isInitialized()) {
      return;
    }
    fs.mkdirSync(path.join(this.dir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(this.dir, 'activity'), { recursive: true });
    this.write('config.json', this.loadConfig());
    if (!fs.existsSync(path.join(this.dir, 'members.json'))) {
      this.write('members.json', []);
    }
    fs.writeFileSync(path.join(this.dir, 'README.md'), README);
  }

  private read<T>(rel: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, rel), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  private write(rel: string, data: unknown): void {
    const file = path.join(this.dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  }

  private readDir<T>(rel: string): T[] {
    const dir = path.join(this.dir, rel);
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.read<T | null>(path.join(rel, f), null))
      .filter((x): x is T => x !== null);
  }

  loadConfig(): BoardConfig {
    const c = this.read<Partial<BoardConfig>>('config.json', {});
    return {
      project: c.project || path.basename(this.root),
      sprints: c.sprints || [],
      activeSprintId: c.activeSprintId ?? null,
      categories: c.categories?.length ? c.categories : DEFAULT_CATEGORIES,
    };
  }

  saveConfig(c: BoardConfig): void {
    this.ensure();
    this.write('config.json', c);
  }

  loadTasks(): Task[] {
    return this.readDir<Task>('tasks');
  }

  saveTask(t: Task): void {
    this.ensure();
    this.write(path.join('tasks', `${t.id}.json`), t);
  }

  deleteTask(id: string): void {
    const file = path.join(this.dir, 'tasks', `${id}.json`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }

  loadMembers(): Member[] {
    return this.read<Member[]>('members.json', []);
  }

  saveMembers(m: Member[]): void {
    this.ensure();
    this.write('members.json', m);
  }

  loadActivity(): ActivityEntry[] {
    return this.readDir<ActivityEntry[]>('activity').flat();
  }

  appendActivity(entry: ActivityEntry): void {
    this.ensure();
    const rel = path.join('activity', `${slug(entry.email)}.json`);
    const list = this.read<ActivityEntry[]>(rel, []);
    list.push(entry);
    this.write(rel, list);
  }

  /** Drop this person's earlier link(s) for a commit, so a re-link replaces them. */
  removeCommitLinks(email: string, hash: string): void {
    const rel = path.join('activity', `${slug(email)}.json`);
    const list = this.read<ActivityEntry[]>(rel, []);
    const kept = list.filter((e) => !(e.type === 'commit' && e.hash === hash));
    if (kept.length !== list.length) {
      this.write(rel, kept);
    }
  }

  removeActivity(email: string, id: string): void {
    const rel = path.join('activity', `${slug(email)}.json`);
    const list = this.read<ActivityEntry[]>(rel, []);
    this.write(rel, list.filter((e) => e.id !== id));
  }
}
