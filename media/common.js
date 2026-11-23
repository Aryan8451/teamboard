// Shared helpers for the CommitBoard webviews (board + sidebar).
/* eslint-disable no-unused-vars */
const vscodeApi = acquireVsCodeApi();

const TB = (() => {
  const post = (type, data = {}) => vscodeApi.postMessage({ type, ...data });

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATUSES = [
    { id: 'backlog', label: 'Backlog', color: '#8b90a5', hint: 'Ideas & later' },
    { id: 'todo', label: 'To Do', color: '#4f8ef7', hint: 'Ready \u2014 anyone can take these' },
    { id: 'inprogress', label: 'In Progress', color: '#f5a524', hint: 'Someone is working on it' },
    { id: 'review', label: 'Review', color: '#a46bf5', hint: 'Waiting for a check' },
    { id: 'done', label: 'Done', color: '#2fbf71', hint: 'Finished' },
  ];
  const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];
  const PRIORITIES = [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'urgent', label: 'Urgent' },
  ];
  const POINTS = [0, 1, 2, 3, 5, 8, 13, 21];
  const CATEGORY_COLORS = {
    Marketing: '#e85d9e', Design: '#a46bf5', Meeting: '#4f8ef7', Research: '#22b8cf',
    Support: '#f5a524', Docs: '#2fbf71', Planning: '#f27a54', Other: '#8b90a5',
  };

  const hash = (s) => {
    let h = 0;
    for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  };
  const PALETTE = ['#4f7cff', '#9b5cf6', '#e85d9e', '#f27a54', '#f5a524', '#2fbf71', '#14b8a6', '#22b8cf', '#6366f1', '#d946ef', '#84cc16', '#ef4444'];
  const color = (key) => PALETTE[hash(String(key).toLowerCase()) % PALETTE.length];
  const catColor = (c) => CATEGORY_COLORS[c] || color(c || 'x');

  const initials = (name) => {
    const parts = String(name || '?').replace(/[<>@.].*$/, '').trim().split(/[\s._-]+/).filter(Boolean);
    return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] || '')).toUpperCase();
  };

  const avatar = (p, cls = '') =>
    p
      ? `<span class="av ${cls}" style="--c:${color(p.email)}" title="${esc(p.name)} \u00B7 ${esc(p.email)}">${esc(initials(p.name))}</span>`
      : `<span class="av empty ${cls}" title="Unassigned">?</span>`;

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v12"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    lines: '<path d="M4 6h16M4 12h10M4 18h13"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    play: '<path d="m6 4 14 8-14 8z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    cloud: '<path d="M17.5 19H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 11.5a3.8 3.8 0 0 1-2.5 7.5z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    github: '<path d="M9 19c-4 1.5-4-2-6-2.5m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;

  const DAY = 864e5;
  const timeAgo = (d) => {
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(d).toLocaleDateString();
  };
  const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : Number(n || 0).toLocaleString());
  const TAG_RE = /\[?#?(T-[A-Z0-9]{4})\]?/i;

  /** Everyone associated with the project: git authors, manual members, assignees, loggers. */
  function people(st) {
    const map = new Map();
    const add = (email, name, extra = {}) => {
      if (!email) return;
      const key = email.toLowerCase();
      const cur = map.get(key) || { email: key, name: name || key, sources: new Set() };
      if (extra.manual && name) cur.name = name; // manual names win
      else if (!cur.name || cur.name === key) cur.name = name || cur.name;
      if (extra.role) cur.role = extra.role;
      if (extra.source) cur.sources.add(extra.source);
      map.set(key, cur);
    };
    // Commits are newest-first; keep the latest name per email.
    for (const c of st.commits) if (!map.has(c.email)) add(c.email, c.name, { source: 'git' });
    for (const c of st.commits) map.get(c.email)?.sources.add('git');
    for (const m of st.members) add(m.email, m.name, { manual: true, role: m.role, source: 'manual' });
    for (const a of st.activity) add(a.email, a.author, { source: 'board' });
    for (const t of st.tasks) if (t.assignee) add(t.assignee, '', { source: 'board' });
    if (st.me?.email) add(st.me.email, st.me.name, { source: 'me' });
    return [...map.values()].map((p) => ({ ...p, git: p.sources.has('git'), manual: p.sources.has('manual') }));
  }
  const byEmail = (st) => {
    const m = new Map(people(st).map((p) => [p.email, p]));
    return (email) => (email ? m.get(email.toLowerCase()) || { email, name: email } : null);
  };

  const SCORE = { commit: 3, task: 10, point: 5, hour: 4, lines: 50 };
  /** Per-person stats for a time range (days; 0 = all time). */
  function stats(st, days) {
    const since = days ? Date.now() - days * DAY : 0;
    const now = Date.now();
    const rows = new Map(
      people(st).map((p) => [p.email, { ...p, commits: 0, add: 0, del: 0, files: 0, tasksDone: 0, points: 0, hours: 0, external: 0, weeks: new Array(12).fill(0), score: 0 }])
    );
    for (const c of st.commits) {
      const r = rows.get(c.email);
      if (!r) continue;
      const t = c.time * 1000;
      const wk = Math.floor((now - t) / (7 * DAY));
      if (wk < 12) r.weeks[11 - wk]++;
      if (t < since) continue;
      r.commits++; r.add += c.add; r.del += c.del; r.files += c.files;
    }
    for (const t of st.tasks) {
      if (t.status !== 'done' || !t.assignee) continue;
      if (new Date(t.doneAt || t.updatedAt).getTime() < since) continue;
      const r = rows.get(t.assignee.toLowerCase());
      if (r) { r.tasksDone++; r.points += Number(t.points) || 0; }
    }
    for (const a of st.activity) {
      if (a.type !== 'external' || new Date(a.date).getTime() < since) continue;
      const r = rows.get(a.email.toLowerCase());
      if (r) { r.external++; r.hours += Number(a.hours) || 0; }
    }
    for (const r of rows.values()) {
      r.score = Math.round(r.commits * SCORE.commit + r.tasksDone * SCORE.task + r.points * SCORE.point + r.hours * SCORE.hour + (r.add + r.del) / SCORE.lines);
    }
    return [...rows.values()];
  }
  const SCORE_HELP = `Impact score = commits\u00D7${SCORE.commit} + tasks done\u00D7${SCORE.task} + story points\u00D7${SCORE.point} + external hours\u00D7${SCORE.hour} + lines changed\u00F7${SCORE.lines}`;

  /** hash -> latest link entry. The newest choice wins, so a wrong link can be fixed by re-linking. */
  function commitLinks(st) {
    const m = new Map();
    for (const a of st.activity) {
      if (a.type !== 'commit' || !a.hash) continue;
      const prev = m.get(a.hash);
      if (!prev || a.date > prev.date) m.set(a.hash, a);
    }
    return m;
  }
  /** Task a commit belongs to: explicit link first, then a [T-XXXX] tag in the message. */
  function commitTask(c, links) {
    const l = links.get(c.hash);
    if (l) return l.taskId || null;
    return TAG_RE.exec(c.subject)?.[1]?.toUpperCase() || null;
  }
  function taskCommits(st, taskId) {
    const links = commitLinks(st);
    return st.commits.filter((c) => commitTask(c, links) === taskId);
  }
  function commitCounts(st) {
    const links = commitLinks(st);
    const counts = {};
    for (const c of st.commits) {
      const id = commitTask(c, links);
      if (id) counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }
  function updateCounts(st) {
    const counts = {};
    for (const a of st.activity) if (a.type === 'external' && a.taskId) counts[a.taskId] = (counts[a.taskId] || 0) + 1;
    return counts;
  }
  const firstName = (name) => String(name || '').split(/[\s@]/)[0];

  function sparkline(values, w = 84, h = 22, c = 'var(--accent)') {
    const max = Math.max(1, ...values);
    const step = w / (values.length - 1);
    const pts = values.map((v, i) => [i * step, h - 2 - (v / max) * (h - 4)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const id = 'g' + Math.random().toString(36).slice(2, 8);
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs><path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function toast(msg) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function on(root, event, handler) {
    root.addEventListener(event, (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || !root.contains(el)) return;
      if (el.dataset.action === 'cloud') {
        // Cloud buttons carry their message as JSON: data-msg='{"type":"cloudOpen","boardId":"..."}'
        e.stopPropagation();
        const msg = JSON.parse(el.dataset.msg || '{}');
        if (msg.importFrom) msg.importLocal = !!document.getElementById(msg.importFrom)?.checked;
        vscodeApi.postMessage(msg);
        return;
      }
      handler(el.dataset.action, el, e);
    });
  }

  // ------------------------------------------------------------------ cloud (live team boards)

  const cloudBtn = (msg, label, cls = 'btn sm') => `<button class="${cls}" data-action="cloud" data-msg="${esc(JSON.stringify(msg))}">${label}</button>`;

  function liveChip(st) {
    const c = st.cloud;
    if (!c || !st.initialized) return '';
    if (c.mode === 'local') return `<span class="live-chip local" title="Stored in .commitboard/ in this repo. Teammates see changes after git pull.">${icon('file', 'sm')} Local board</span>`;
    const map = { online: ['on', 'Live'], connecting: ['wait', 'Connecting'], offline: ['off', 'Offline'] };
    const [cls, label] = map[c.live] || map.offline;
    return `<span class="live-chip ${cls}" title="${c.live === 'online' ? 'Changes sync instantly with your team' : 'Changes will sync when the connection is back'}"><i></i>${label}</span>`;
  }

  /** Shown when this project has no board yet: choose a live team board or a local git board. */
  function setupView(st, compact) {
    const c = st.cloud || {};
    const busy = c.busy ? ' disabled' : '';
    const localCard = `
      <div class="setup-card featured">
        <div class="setup-title">${icon('board')} Free board <span class="pill" style="color:var(--green)">No sign-up</span></div>
        <p>Saved as files in <span class="mono">.commitboard/</span> in this repo, and nothing is sent anywhere. Commit &amp; push that folder to share it; teammates see changes after <span class="mono">git pull</span>.</p>
        ${c.localHasData
          ? cloudBtn({ type: 'useLocal' }, `${icon('board', 'sm')} Open free board`, 'btn sm primary')
          : `<button class="btn sm primary" data-action="cmd" data-command="commitboard.newTask">${icon('plus', 'sm')} Start free board</button>`}
      </div>`;
    if (!c.available) {
      return `<div class="setup">
        <div class="setup-head"><b>CommitBoard is off for this project</b><span>Your commits here won't trigger any popups. Create the first task to start a board.</span></div>
        ${localCard}</div>`;
    }
    let teamBody;
    if (!c.signedIn) {
      teamBody = `<p>Everyone sees changes instantly, with no push or pull. You decide who can join. Needs a GitHub sign-in; the board is stored on the CommitBoard server.</p>
        ${cloudBtn({ type: 'cloudSignIn' }, `${icon('github', 'sm')} Sign in with GitHub`, 'btn sm' + busy)}`;
    } else {
      const boards = (c.repoBoards || []).map((b) => {
        const owner = b.owner ? ` &middot; by ${esc(b.owner.name || b.owner.login)}` : '';
        const action = b.role
          ? cloudBtn({ type: 'cloudOpen', boardId: b.id }, 'Open', 'btn sm primary' + busy)
          : b.pending
            ? `<span class="pill" style="color:var(--amber)">Waiting for approval</span>${cloudBtn({ type: 'cloudCancelRequest', boardId: b.id }, 'Cancel', 'btn sm ghost' + busy)}`
            : cloudBtn({ type: 'cloudRequestJoin', boardId: b.id }, 'Ask to join', 'btn sm primary' + busy);
        return `<div class="board-row"><div class="grow"><b>${esc(b.name)}</b><div class="muted" style="font-size:11px">${b.memberCount} member${b.memberCount === 1 ? '' : 's'}${owner}</div></div>${action}</div>`;
      }).join('');
      teamBody = `
        <div class="signed-in">${icon('github', 'sm')} ${esc(c.user?.login || c.user?.name || 'Signed in')} ${cloudBtn({ type: 'cloudSignOut' }, 'Sign out', 'link-btn')}</div>
        ${boards ? `<div class="muted" style="font-size:11px;margin:8px 0 4px">Team boards for this repo</div>${boards}` : `<p>No team board for this repo yet. Create one; teammates who open this repo can then ask to join.</p>`}
        <div class="setup-actions">
          ${cloudBtn({ type: 'cloudCreate', importFrom: 'cb-import' }, `${icon('plus', 'sm')} Create team board`, 'btn sm' + (boards ? '' : ' primary') + busy)}
          ${cloudBtn({ type: 'cloudJoinCode' }, 'Join with invite code', 'btn sm ghost' + busy)}
        </div>
        ${c.localHasData ? `<label class="check" style="font-size:11.5px"><input type="checkbox" id="cb-import" checked> Copy my local board's tasks into it</label>` : ''}`;
    }
    return `<div class="setup ${compact ? 'compact' : ''}">
      <div class="setup-head"><b>Set up a board for this project</b><span>Until you do, commits here won't trigger any popups.</span></div>
      ${c.error ? `<div class="setup-error">${icon('x', 'sm')} ${esc(c.error)} ${cloudBtn({ type: 'cloudRefresh' }, 'Retry', 'link-btn')}</div>` : ''}
      ${localCard}
      <div class="setup-card">
        <div class="setup-title">${icon('cloud')} CommitBoard Cloud <span class="pill">Optional</span></div>
        ${teamBody}
      </div>
    </div>`;
  }

  /** Team tab section: who has access, join requests, invite code (cloud), or an upgrade offer (local). */
  function accessView(st) {
    const c = st.cloud || {};
    if (!c.available) return '';
    if (c.mode === 'local') {
      return `<div class="access upgrade">
        <div class="grow"><b>${icon('cloud', 'sm')} Optional: CommitBoard Cloud</b><div class="muted" style="font-size:12px">Want changes to sync instantly, without git pull, and to approve who joins? Move this board to the cloud. Your tasks are copied over. Your free board keeps working either way.</div></div>
        ${c.signedIn
          ? cloudBtn({ type: 'cloudCreate', importLocal: true }, `${icon('cloud', 'sm')} Move to Cloud`, 'btn')
          : cloudBtn({ type: 'cloudSignIn' }, `${icon('github', 'sm')} Sign in with GitHub`, 'btn')}
      </div>`;
    }
    const b = c.board;
    if (!b) return '';
    const admin = b.role === 'owner' || b.role === 'admin';
    const myId = c.user?.id;
    const requests = admin && b.requests.length
      ? `<div class="access-block"><div class="access-label">${icon('users', 'sm')} Join requests <span class="badge">${b.requests.length}</span></div>
          ${b.requests.map((r) => `<div class="person-row">${avatar({ name: r.name || r.login, email: r.gitEmail || r.email || r.login })}<div class="grow"><b>${esc(r.name || r.login)}</b><div class="muted" style="font-size:11px">@${esc(r.login)} &middot; asked ${timeAgo(r.at)}</div></div>
            ${cloudBtn({ type: 'cloudDecide', userId: r.id, approve: true }, `${icon('check', 'sm')} Accept`, 'btn sm primary')}${cloudBtn({ type: 'cloudDecide', userId: r.id, approve: false }, 'Reject', 'btn sm ghost')}</div>`).join('')}</div>`
      : '';
    const members = b.members.map((m) => {
      const actions = [];
      if (b.role === 'owner' && m.role !== 'owner') {
        actions.push(cloudBtn({ type: 'cloudSetRole', userId: m.id, role: m.role === 'admin' ? 'member' : 'admin' }, m.role === 'admin' ? 'Make member' : 'Make admin', 'btn sm ghost'));
      }
      if (admin && m.id !== myId && m.role !== 'owner' && !(b.role === 'admin' && m.role === 'admin')) {
        actions.push(cloudBtn({ type: 'cloudRemoveMember', userId: m.id, name: m.name || m.login }, 'Remove', 'btn sm ghost danger-text'));
      }
      return `<div class="person-row">${avatar({ name: m.name || m.login, email: m.gitEmail || m.email || m.login })}<div class="grow"><b>${esc(m.name || m.login)}</b>${m.id === myId ? ' <span class="tag">you</span>' : ''}<div class="muted" style="font-size:11px">@${esc(m.login)}</div></div><span class="role role-${m.role}">${m.role}</span>${actions.join('')}</div>`;
    }).join('');
    const invite = admin
      ? `<div class="access-block"><div class="access-label">${icon('link', 'sm')} Invite</div>
          <div class="invite"><span class="mono code">${esc(b.inviteCode || '')}</span>${cloudBtn({ type: 'copy', text: b.inviteCode }, `${icon('copy', 'sm')} Copy`, 'btn sm')}${cloudBtn({ type: 'cloudSettings', settings: { regenerateCode: true } }, 'New code', 'btn sm ghost')}</div>
          <div class="seg" style="margin-top:8px">
            ${cloudBtn({ type: 'cloudSettings', settings: { joinPolicy: 'approve' } }, 'I approve everyone', b.joinPolicy === 'approve' ? 'on' : '')}
            ${cloudBtn({ type: 'cloudSettings', settings: { joinPolicy: 'code' } }, 'Invite code joins instantly', b.joinPolicy === 'code' ? 'on' : '')}
          </div>
          <div class="muted" style="font-size:11px;margin-top:6px">Teammates who open this repo can also find the board and ask to join.</div></div>`
      : '';
    return `<div class="access">
      <div class="access-head"><div class="grow"><b>${icon('shield', 'sm')} ${esc(b.name)}</b> ${liveChip(st)}<div class="muted" style="font-size:12px">CommitBoard Cloud &middot; you are ${{ owner: 'the owner', admin: 'an admin', member: 'a member' }[b.role]}</div></div>
        ${b.role === 'owner' ? cloudBtn({ type: 'cloudDelete' }, 'Delete board', 'btn sm ghost danger-text') : cloudBtn({ type: 'cloudLeave' }, 'Leave board', 'btn sm ghost')}
        ${cloudBtn({ type: 'cloudSignOut' }, `${icon('logout', 'sm')} Sign out`, 'btn sm ghost')}
      </div>
      ${requests}
      <div class="access-block"><div class="access-label">${icon('users', 'sm')} Members <span class="badge">${b.members.length}</span></div>${members}</div>
      ${invite}
    </div>`;
  }

  return { post, esc, STATUSES, statusOf, PRIORITIES, POINTS, color, catColor, initials, avatar, icon, timeAgo, fmt, DAY, TAG_RE, people, byEmail, stats, SCORE_HELP, commitLinks, commitTask, taskCommits, commitCounts, updateCounts, firstName, sparkline, toast, on, liveChip, setupView, accessView };
})();
