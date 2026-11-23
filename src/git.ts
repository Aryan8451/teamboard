import { execFile } from 'child_process';
import * as vscode from 'vscode';

/** Minimal typings for the built-in vscode.git extension API (v1). */
export interface GitCommit {
  hash: string;
  message: string;
  parents: string[];
  authorDate?: Date;
  authorName?: string;
  authorEmail?: string;
}

export interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
  state: {
    HEAD?: { name?: string; commit?: string; ahead?: number; behind?: number };
    onDidChange: vscode.Event<void>;
  };
  getCommit(ref: string): Promise<GitCommit>;
}

export interface GitAPI {
  git: { path: string };
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
}

export interface CommitStat {
  hash: string;
  name: string;
  email: string;
  time: number; // unix seconds
  subject: string;
  add: number;
  del: number;
  files: number;
}

export async function getGitApi(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) {
    return undefined;
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports?.getAPI?.(1);
}

export class Git {
  constructor(public cwd: string, public bin = 'git') {}

  run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.bin, args, { cwd: this.cwd, maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  async topLevel(): Promise<string | undefined> {
    try {
      return (await this.run(['rev-parse', '--show-toplevel'])).trim();
    } catch {
      return undefined;
    }
  }

  async remoteUrl(): Promise<string> {
    try {
      return (await this.run(['remote', 'get-url', 'origin'])).trim();
    } catch {
      return '';
    }
  }

  async identity(): Promise<{ name: string; email: string }> {
    const get = async (key: string) => {
      try {
        return (await this.run(['config', key])).trim();
      } catch {
        return '';
      }
    };
    return { name: await get('user.name'), email: (await get('user.email')).toLowerCase() };
  }

  async commitStats(max: number, exclude: string[]): Promise<CommitStat[]> {
    let out: string;
    try {
      out = await this.run([
        'log',
        '--no-merges',
        '--numstat',
        `--max-count=${max}`,
        '--format=%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%s',
      ]);
    } catch {
      return []; // no commits yet, or not a repo
    }
    const excluded = exclude.map(globToRegExp);
    const commits: CommitStat[] = [];
    for (const chunk of out.split('\x1e')) {
      if (!chunk.trim()) {
        continue;
      }
      const lines = chunk.split('\n');
      const [hash, name, email, at, subject] = lines[0].split('\x1f');
      const c: CommitStat = { hash, name, email: email.toLowerCase(), time: Number(at), subject, add: 0, del: 0, files: 0 };
      for (const line of lines.slice(1)) {
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
        if (!m) {
          continue;
        }
        c.files++;
        const file = m[3].replace(/\\/g, '/');
        if (m[1] === '-' || excluded.some((r) => r.test(file))) {
          continue; // binary or excluded file
        }
        c.add += Number(m[1]);
        c.del += Number(m[2]);
      }
      commits.push(c);
    }
    return commits;
  }

  async recentCommits(n: number): Promise<{ hash: string; email: string; subject: string }[]> {
    const out = await this.run(['log', `-n${n}`, '--format=%H%x1f%ae%x1f%s']);
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, email, subject] = l.split('\x1f');
        return { hash, email: email.toLowerCase(), subject };
      });
  }
}

/** Tiny glob matcher: supports * and **; patterns match at any directory depth. */
function globToRegExp(glob: string): RegExp {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`(^|/)${esc}$`);
}
