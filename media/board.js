// TeamBoard main panel: Kanban board, Team leaderboard, Activity timeline.
(() => {
  const { esc, icon, avatar, post } = TB;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');

  const saved = vscodeApi.getState() || {};
  const S = {
    st: null,
    tab: saved.tab || 'board',
    q: '',
    show: saved.show || 'all', // all | mine | open (unassigned)
    person: saved.person || '',
    sprint: saved.sprint || 'all',
    range: saved.range ?? 30,
    sort: saved.sort || 'score',
    act: saved.act || 'all',
    help: saved.help !== false,
    openTaskId: null, // task page currently open in the modal
    dragId: null,
  };
  const persist = () =>
    vscodeApi.setState({ tab: S.tab, show: S.show, person: S.person, sprint: S.sprint, range: S.range, sort: S.sort, act: S.act, help: S.help });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') {
      S.st = m.state;
      render();
      if (S.openTaskId) refreshTaskPage();
    } else if (m.type === 'navigate') {
      if (m.tab) S.tab = m.tab;
      persist();
      render();
      if (m.taskId) openTask(m.taskId);
    }
  });
  post('ready');

  // ------------------------------------------------------------------ helpers
  const who = () => TB.byEmail(S.st);
  const me = () => S.st.me.email;
  const task = (id) => S.st.tasks.find((t) => t.id === id);
  const activeSprint = () => S.st.config.sprints.find((s) => s.id === S.st.config.activeSprintId);
  const daysBetween = (a, b) => Math.ceil((new Date(b) - new Date(a)) / TB.DAY);
  const PRIO_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

  function filteredTasks() {
    const q = S.q.trim().toLowerCase();
    return S.st.tasks.filter((t) => {
      if (S.show === 'mine' && t.assignee !== me()) return false;
      if (S.show === 'open' && t.assignee) return false;
      if (S.person && t.assignee !== S.person) return false;
      if (S.sprint === 'active' && t.sprintId !== S.st.config.activeSprintId) return false;
      if (S.sprint === 'none' && t.sprintId) return false;
      if (!['all', 'active', 'none'].includes(S.sprint) && t.sprintId !== S.sprint) return false;
      if (q && !`${t.id} ${t.title} ${t.description} ${(t.labels || []).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  // ------------------------------------------------------------------ shell
  function render() {
    if (!S.st) return;
    const st = S.st;
    if (!st.ready) {
      app.innerHTML = `<div class="empty"><div class="big">\u{1F4C1}</div><h3>Open a folder to start</h3><p>TeamBoard stores your board inside the project, so open a git repository folder.</p></div>`;
      return;
    }
    const scrollY = window.scrollY;
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="logo">${icon('board')}</div>
          <div style="min-width:0">
            <div class="project" data-action="rename" title="Click to rename">${esc(st.config.project)}</div>
            <div class="sub">${st.tasks.filter((t) => t.status !== 'done').length} open tasks \u00B7 ${TB.people(st).length} people</div>
          </div>
        </div>
        <nav class="tabs">
          ${tabBtn('board', 'board', 'Board')}
          ${tabBtn('team', 'trophy', 'Team')}
          ${tabBtn('activity', 'activity', 'Activity')}
        </nav>
        <div class="actions">
          <button class="btn ghost icon" data-action="toggleHelp" title="How TeamBoard works">?</button>
          <button class="btn" data-action="logWork" title="Post progress on non-code work \u2014 no commit needed">${icon('note')} Add update</button>
          <button class="btn primary" data-action="newTask">${icon('plus')} New task</button>
        </div>
      </header>
      <div class="page">
        ${S.help ? helpCard() : ''}
        ${S.tab === 'board' ? boardView() : S.tab === 'team' ? teamView() : activityView()}
      </div>
      <footer class="foot">TeamBoard is free \u00B7 Made with <span class="heart">\u2665</span> by Aryan</footer>`;
    if (S.tab === 'board') renderColumns();
    window.scrollTo(0, scrollY);
  }

  const tabBtn = (id, ic, label) => `<button class="tab ${S.tab === id ? 'on' : ''}" data-action="tab" data-tab="${id}">${icon(ic)}<span>${label}</span></button>`;

  function helpCard() {
    return `
      <div class="help">
        <div class="help-head"><b>How TeamBoard works</b><button class="btn ghost icon sm" data-action="toggleHelp" title="Hide">${icon('x', 'sm')}</button></div>
        <div class="help-steps">
          <div class="help-step"><span class="num">1</span><div><b>Add tasks</b><p>Anyone can add work, code or not: features, bugs, marketing, design.</p></div></div>
          <div class="help-step"><span class="num">2</span><div><b>Take a task</b><p>Click <span class="kbd">Take it</span> on a card. It becomes <i>your current task</i> (shown in the status bar).</p></div></div>
          <div class="help-step"><span class="num">3</span><div><b>Show progress</b><p><b>Developers:</b> just commit, and you'll be asked which task it was for. <b>Everyone else:</b> open the task and post an update.</p></div></div>
          <div class="help-step"><span class="num">4</span><div><b>Finish</b><p>Move the task to <b>Done</b> by dragging it or using the status bar on the task. Picked the wrong task for a commit? Click <span class="kbd">Change</span> on it.</p></div></div>
        </div>
        ${!S.st.initialized ? `<div class="help-note">${icon('bolt', 'sm')} TeamBoard is <b>off</b> for this project until you create the first task, so you won't get commit popups here. The board is then saved in <span class="mono">.teamboard/</span> in this repo. Commit &amp; push it so your whole team shares it, free.</div>` : ''}
      </div>`;
  }

  // ------------------------------------------------------------------ board
  function boardView() {
    const st = S.st;
    const ppl = TB.people(st);
    const sp = activeSprint();
    let sprintHtml = '';
    if (sp) {
      const ts = st.tasks.filter((t) => t.sprintId === sp.id);
      const total = ts.reduce((a, t) => a + (Number(t.points) || 0), 0);
      const done = ts.filter((t) => t.status === 'done').reduce((a, t) => a + (Number(t.points) || 0), 0);
      const left = daysBetween(new Date().toISOString().slice(0, 10), sp.end);
      const pct = total ? Math.round((done / total) * 100) : 0;
      sprintHtml = `
        <div class="sprint">
          <span class="name">${icon('flag', 'sm')} ${esc(sp.name)}</span>
          ${sp.goal ? `<span class="goal" title="Sprint goal">${esc(sp.goal)}</span>` : ''}
          <div class="meter"><div class="bar"><span style="width:${pct}%;background:var(--green)"></span></div></div>
          <span class="muted">${pct}% \u00B7 ${done}/${total} pts</span>
          <span class="pill" style="${left < 0 ? 'color:var(--red)' : left <= 2 ? 'color:var(--amber)' : ''}">${left < 0 ? `${-left} days over` : `${left} days left`}</span>
          <button class="btn ghost sm" data-action="sprints">Manage</button>
        </div>`;
    }
    return `
      ${sprintHtml}
      <div class="toolbar">
        <div class="search">${icon('search', 'sm')}<input class="input" id="q" placeholder="Search tasks\u2026  ( / )" value="${esc(S.q)}"></div>
        <div class="seg">
          <button class="${S.show === 'all' ? 'on' : ''}" data-action="show" data-show="all">All tasks</button>
          <button class="${S.show === 'mine' ? 'on' : ''}" data-action="show" data-show="mine">My tasks</button>
          <button class="${S.show === 'open' ? 'on' : ''}" data-action="show" data-show="open">Unassigned</button>
        </div>
        ${S.show === 'all' ? `<select class="input compact" id="personFilter" title="Filter by person">
          <option value="">Everyone</option>
          ${ppl.map((p) => `<option value="${esc(p.email)}" ${S.person === p.email ? 'selected' : ''}>${esc(p.name)}${p.email === me() ? ' (you)' : ''}</option>`).join('')}
        </select>` : ''}
        <div class="grow"></div>
        ${st.config.sprints.length ? `<select class="input compact" id="sprintFilter" title="Filter by sprint">
          <option value="all" ${S.sprint === 'all' ? 'selected' : ''}>All sprints</option>
          <option value="active" ${S.sprint === 'active' ? 'selected' : ''}>Current sprint</option>
          <option value="none" ${S.sprint === 'none' ? 'selected' : ''}>No sprint</option>
          ${st.config.sprints.map((s) => `<option value="${esc(s.id)}" ${S.sprint === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>` : ''}
        ${!sp ? `<button class="btn ghost" data-action="sprints" title="Optional: group tasks into 1\u20132 week sprints">${icon('flag', 'sm')} Sprints</button>` : ''}
      </div>
      <div class="columns" id="columns"></div>`;
  }

  function renderColumns() {
    const el = document.getElementById('columns');
    if (!el) return;
    const tasks = filteredTasks();
    const commits = TB.commitCounts(S.st);
    const updates = TB.updateCounts(S.st);
    const w = who();
    el.innerHTML = TB.STATUSES.map((s) => {
      const list = tasks
        .filter((t) => t.status === s.id)
        .sort((a, b) => (s.id === 'done' ? (b.doneAt || b.updatedAt).localeCompare(a.doneAt || a.updatedAt) : PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] || a.createdAt.localeCompare(b.createdAt)));
      const shown = s.id === 'done' ? list.slice(0, 30) : list;
      return `
        <section class="col" data-status="${s.id}" style="--c:${s.color}">
          <div class="col-head">
            <div class="row"><span class="dot"></span><span class="t">${s.label}</span><span class="n">${list.length}</span></div>
            <div class="hint">${s.hint}</div>
          </div>
          <div class="col-body">
            ${shown.length ? shown.map((t) => card(t, commits[t.id] || 0, updates[t.id] || 0, w)).join('') : `<div class="col-empty">${s.id === 'done' ? 'Nothing finished yet' : 'Drag tasks here'}</div>`}
            ${list.length > shown.length ? `<div class="muted" style="font-size:11px;text-align:center">+${list.length - shown.length} older</div>` : ''}
          </div>
          ${s.id === 'backlog' || s.id === 'todo' ? `<button class="add-inline" data-action="newTask" data-status="${s.id}">${icon('plus', 'sm')} Add task</button>` : ''}
        </section>`;
    }).join('');
  }

  function card(t, commits, updates, w) {
    const isCurrent = t.id === S.st.currentTaskId;
    const a = w(t.assignee);
    const canTake = !t.assignee && t.status !== 'done';
    const prio = TB.PRIORITIES.find((p) => p.id === t.priority)?.label;
    return `
      <article class="card prio-${t.priority} ${isCurrent ? 'current' : ''} ${t.status === 'done' ? 'is-done' : ''}" draggable="true" data-id="${t.id}" data-action="openTask" title="Click to open \u00B7 drag to move">
        ${isCurrent ? `<div class="now">${icon('target', 'sm')} You're on this</div>` : ''}
        <div class="card-title">${esc(t.title)}</div>
        ${t.labels?.length ? `<div class="card-labels">${t.labels.map((l) => `<span class="label" style="--c:${TB.color(l)}">${esc(l)}</span>`).join('')}</div>` : ''}
        <div class="card-foot">
          <span class="tid">${t.id}</span>
          ${t.priority === 'urgent' || t.priority === 'high' ? `<span class="pill p-${t.priority}">${prio}</span>` : ''}
          ${commits ? `<span class="meta" title="${commits} linked commit(s)">${icon('commit', 'sm')}${commits}</span>` : ''}
          ${updates ? `<span class="meta" title="${updates} update(s)">${icon('note', 'sm')}${updates}</span>` : ''}
          <span class="right">
            ${canTake
              ? `<button class="pickup" data-action="pick" data-id="${t.id}" title="Assign to me and start">Take it</button>`
              : a ? `<span class="assignee">${avatar(a)}<span>${a.email === me() ? 'You' : esc(TB.firstName(a.name))}</span></span>` : ''}
          </span>
        </div>
      </article>`;
  }

  // ------------------------------------------------------------------ team
  function teamView() {
    const st = S.st;
    const rows = TB.stats(st, S.range);
    const key = S.sort;
    rows.sort((a, b) => b[key] - a[key] || b.score - a.score);
    const tot = rows.reduce((a, r) => ({ commits: a.commits + r.commits, add: a.add + r.add, del: a.del + r.del, tasks: a.tasks + r.tasksDone, hours: a.hours + r.hours }), { commits: 0, add: 0, del: 0, tasks: 0, hours: 0 });
    const active = rows.filter((r) => r.commits || r.tasksDone || r.external).length;
    const ranked = [...rows].sort((a, b) => b.score - a.score);
    const top = ranked.filter((r) => r.score > 0).slice(0, 3);
    const totalScore = ranked.reduce((a, r) => a + r.score, 0);
    const maxScore = Math.max(1, ...rows.map((r) => r.score));
    const rankOf = new Map(ranked.map((r, i) => [r.email, i + 1]));
    const rangeBtn = (v, l) => `<button class="${S.range === v ? 'on' : ''}" data-action="range" data-range="${v}">${l}</button>`;
    const th = (k, l, tip) => `<th class="num ${key === k ? 'on' : ''}" data-action="sort" data-sort="${k}" title="${tip}">${l}</th>`;

    const podium = top.length
      ? `<div class="podium">${[top[1], top[0], top[2]].map((r, i) => {
          if (!r) return '<div></div>';
          const place = [2, 1, 3][i];
          const mc = place === 1 ? 'var(--gold)' : place === 2 ? 'var(--silver)' : 'var(--bronze)';
          return `<div class="pod ${place === 1 ? 'first' : ''}" style="--mc:${mc}">
              <div class="medal">${place}</div>
              ${avatar(r, place === 1 ? 'xl' : 'lg')}
              <div class="nm">${esc(r.name)}${r.email === me() ? ' <span class="tag">you</span>' : ''}</div>
              <div class="sc">${TB.fmt(r.score)} <small>impact</small></div>
              <div class="st"><span title="Commits">${icon('commit', 'sm')} ${r.commits}</span><span title="Tasks done">${icon('check', 'sm')} ${r.tasksDone}</span>${r.hours ? `<span title="Hours of non-code work">${icon('clock', 'sm')} ${r.hours}h</span>` : `<span class="plus">+${TB.fmt(r.add)}</span>`}</div>
            </div>`;
        }).join('')}</div>`
      : '';

    return `
      <div class="toolbar">
        <div class="seg">${rangeBtn(7, '7 days')}${rangeBtn(30, '30 days')}${rangeBtn(90, '90 days')}${rangeBtn(0, 'All time')}</div>
        <span class="muted" title="${esc(TB.SCORE_HELP)}" style="cursor:help">${icon('bolt', 'sm')} How is impact scored?</span>
        <div class="grow"></div>
        <button class="btn ghost" data-action="refresh" title="Re-read git history">${st.statsLoading ? '<span class="spinner sm"></span>' : icon('refresh')}</button>
        <button class="btn" data-action="addMember" title="Add people who don't commit code, e.g. marketing">${icon('plus')} Add member</button>
      </div>
      <div class="kpis">
        ${kpi('users', 'var(--violet)', 'People', `${rows.length}<small>${active} active</small>`)}
        ${kpi('commit', 'var(--blue)', 'Commits', TB.fmt(tot.commits))}
        ${kpi('lines', 'var(--green)', 'Lines changed', `<span class="plus">+${TB.fmt(tot.add)}</span> <span class="minus" style="font-size:18px">\u2212${TB.fmt(tot.del)}</span>`)}
        ${kpi('check', 'var(--amber)', 'Tasks done', TB.fmt(tot.tasks))}
        ${kpi('clock', 'var(--red)', 'Non-code hours', TB.fmt(tot.hours))}
      </div>
      ${podium}
      ${totalScore ? `
        <div class="section-title">${icon('activity', 'sm')} Share of impact</div>
        <div class="share">${ranked.filter((r) => r.score).map((r) => `<span style="width:${(r.score / totalScore) * 100}%;background:${TB.color(r.email)}" title="${esc(r.name)}: ${Math.round((r.score / totalScore) * 100)}%"></span>`).join('')}</div>
        <div class="legend">${ranked.filter((r) => r.score).slice(0, 10).map((r) => `<span><i style="background:${TB.color(r.email)}"></i>${esc(r.name)} ${Math.round((r.score / totalScore) * 100)}%</span>`).join('')}</div>` : ''}
      <div class="section-title">${icon('trophy', 'sm')} Leaderboard <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">\u00B7 click a column to sort</span></div>
      <div class="table-wrap">
        <table class="lb">
          <thead><tr>
            <th style="width:44px">#</th><th>Person</th>
            ${th('commits', 'Commits', 'Commits in this period')}${th('add', 'Added', 'Lines added')}${th('del', 'Removed', 'Lines removed')}
            ${th('tasksDone', 'Tasks done', 'Tasks moved to Done')}${th('hours', 'Non-code hrs', 'Hours logged through updates')}
            <th>Last 12 weeks</th>${th('score', 'Impact', TB.SCORE_HELP)}<th></th>
          </tr></thead>
          <tbody>
            ${rows.map((r) => {
              const rk = rankOf.get(r.email);
              return `<tr class="${r.email === me() ? 'me' : ''}">
                <td><span class="rank ${r.score && rk <= 3 ? 'r' + rk : ''}">${rk}</span></td>
                <td><div class="who">${avatar(r, 'md')}<div><div class="n">${esc(r.name)}${r.email === me() ? '<span class="tag">you</span>' : ''}${r.role ? `<span class="tag">${esc(r.role)}</span>` : ''}</div><div class="e">${esc(r.email)}</div></div></div></td>
                <td class="num"><b>${TB.fmt(r.commits)}</b></td>
                <td class="num plus">+${TB.fmt(r.add)}</td>
                <td class="num minus">\u2212${TB.fmt(r.del)}</td>
                <td class="num">${r.tasksDone}</td>
                <td class="num">${r.hours ? r.hours : '\u2014'}</td>
                <td>${TB.sparkline(r.weeks, 84, 22, TB.color(r.email))}</td>
                <td class="num"><div class="scorebar"><div class="bar"><span style="width:${(r.score / maxScore) * 100}%;background:${TB.color(r.email)}"></span></div><b>${TB.fmt(r.score)}</b></div></td>
                <td><button class="x-btn" data-action="editMember" data-email="${esc(r.email)}" title="Edit name / role">${icon('edit', 'sm')}</button>${r.manual ? `<button class="x-btn" data-action="removeMember" data-email="${esc(r.email)}" title="Remove member">${icon('x', 'sm')}</button>` : ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${!rows.length ? `<div class="empty"><div class="big">\u{1F465}</div><h3>No one here yet</h3><p>Make a commit or add a member to get started.</p></div>` : ''}`;
  }

  const kpi = (ic, c, k, v) => `<div class="kpi" style="--c:${c}"><div class="k">${icon(ic, 'sm')} ${k}</div><div class="v">${v}</div></div>`;

  // ------------------------------------------------------------------ activity
  /** One feed item per commit / update / event. `onlyTask` limits it to one task. */
  function feedItems(onlyTask) {
    const st = S.st;
    const links = TB.commitLinks(st);
    const items = [];
    const want = (k) => onlyTask || S.act === 'all' || S.act === k;
    if (want('commit')) {
      const known = new Set();
      for (const c of st.commits.slice(0, onlyTask ? st.commits.length : 300)) {
        known.add(c.hash);
        const taskId = TB.commitTask(c, links);
        if (onlyTask && taskId !== onlyTask) continue;
        items.push({ kind: 'commit', date: new Date(c.time * 1000), email: c.email, c, taskId, link: links.get(c.hash) });
      }
      // linked commits that aren't in local history yet (teammate hasn't pushed / you haven't pulled)
      for (const l of links.values()) {
        if (known.has(l.hash) || (onlyTask && l.taskId !== onlyTask)) continue;
        items.push({ kind: 'commit', date: new Date(l.date), email: l.email, c: { hash: l.hash, subject: l.message, email: l.email, add: 0, del: 0, files: 0 }, taskId: l.taskId || null, link: l });
      }
    }
    for (const a of st.activity) {
      if (onlyTask && a.taskId !== onlyTask) continue;
      if (a.type === 'external' && want('external')) items.push({ kind: 'external', date: new Date(a.date), email: a.email, a });
      if (a.type === 'event' && want('event')) items.push({ kind: 'event', date: new Date(a.date), email: a.email, a });
    }
    return items.sort((a, b) => b.date - a.date);
  }

  function activityView() {
    const items = feedItems().slice(0, 400);
    let lastDay = '';
    const today = new Date().toDateString();
    const yest = new Date(Date.now() - TB.DAY).toDateString();
    const body = items.map((it) => {
      const ds = it.date.toDateString();
      let head = '';
      if (ds !== lastDay) {
        lastDay = ds;
        head = `<div class="day">${ds === today ? 'Today' : ds === yest ? 'Yesterday' : it.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</div>`;
      }
      return head + feedItem(it, false);
    }).join('');

    const seg = (v, l) => `<button class="${S.act === v ? 'on' : ''}" data-action="act" data-act="${v}">${l}</button>`;
    const links = TB.commitLinks(S.st);
    const unlinkedMine = S.st.commits.slice(0, 300).filter((c) => c.email === me() && !links.has(c.hash) && !TB.TAG_RE.test(c.subject)).length;
    return `
      <div class="toolbar">
        <div class="seg">${seg('all', 'Everything')}${seg('commit', 'Commits')}${seg('external', 'Updates')}${seg('event', 'Task changes')}</div>
        ${unlinkedMine ? `<span class="unlinked">${unlinkedMine} of your commits have no task</span>` : ''}
      </div>
      <div class="timeline">${body || `<div class="empty"><div class="big">\u{1F5D3}</div><h3>Nothing here yet</h3><p>Commits, updates and task changes will show up here.</p></div>`}</div>`;
  }

  function feedItem(it, inTask) {
    const w = who();
    const p = w(it.email);
    const name = esc(p?.email === me() ? 'You' : p?.name || it.email);
    const time = inTask ? TB.timeAgo(it.date) : it.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const chip = (id) => (id && !inTask ? `<span class="chip-task" data-action="openTask" data-id="${esc(id)}" title="${esc(task(id)?.title || '')}">${esc(id)}</span>` : '');
    if (it.kind === 'commit') {
      const c = it.c;
      const note = it.link && !it.link.taskId && !it.link.unlinked ? it.link : null;
      let linkPart;
      if (it.taskId) {
        linkPart = `${inTask ? '' : `<span class="muted">for</span>${chip(it.taskId)}`}<button class="link-btn" data-action="linkCommit" data-hash="${c.hash}" title="Linked to the wrong task? Fix it">Change</button>`;
      } else if (note) {
        linkPart = `<span class="pill" style="color:${TB.catColor(note.category)}">${esc(note.category || 'Note')}</span><button class="link-btn" data-action="linkCommit" data-hash="${c.hash}">Change</button>`;
      } else {
        linkPart = `<span class="unlinked">no task</span><button class="link-btn" data-action="linkCommit" data-hash="${c.hash}">Link to a task</button>`;
      }
      return `<div class="tl-item">
        <div class="tl-ico" style="--c:var(--blue)">${icon('commit')}</div>
        <div class="tl-main">
          <div class="tl-line">${avatar(p)}<span class="n">${name}</span><span class="muted">committed</span>${linkPart}</div>
          <div class="tl-msg">${esc(c.subject)}</div>
          ${note ? `<div class="tl-meta">${icon('note', 'sm')} ${esc(note.message)}</div>` : ''}
          <div class="tl-meta"><span class="mono">${c.hash.slice(0, 7)}</span>${c.files ? `<span>${c.files} files</span><span class="plus">+${TB.fmt(c.add)}</span><span class="minus">\u2212${TB.fmt(c.del)}</span>` : ''}</div>
        </div>
        <div class="tl-time">${time}</div>
      </div>`;
    }
    const a = it.a;
    if (it.kind === 'external') {
      const cc = TB.catColor(a.category);
      return `<div class="tl-item">
        <div class="tl-ico" style="--c:${cc}">${icon('note')}</div>
        <div class="tl-main">
          <div class="tl-line">${avatar(p)}<span class="n">${name}</span><span class="muted">posted an update</span><span class="pill" style="color:${cc};background:color-mix(in srgb, ${cc} 14%, transparent)">${esc(a.category || 'Other')}</span>${chip(a.taskId)}${a.hours ? `<span class="muted">${icon('clock', 'sm')} ${a.hours}h</span>` : ''}</div>
          <div class="tl-msg">${esc(a.message)}</div>
        </div>
        <div class="tl-time">${time} ${a.email === me() ? `<button class="x-btn" data-action="deleteActivity" data-id="${a.id}" title="Delete update">${icon('trash', 'sm')}</button>` : ''}</div>
      </div>`;
    }
    return `<div class="tl-item small">
      <div class="tl-ico" style="--c:var(--violet)">${icon(/Done/.test(a.message) ? 'check' : 'arrow', 'sm')}</div>
      <div class="tl-main"><div class="tl-line">${avatar(p)}<span class="n">${name}</span>${chip(a.taskId)}<span class="muted">${esc(a.message)}</span></div></div>
      <div class="tl-time">${time}</div>
    </div>`;
  }

  // ------------------------------------------------------------------ modals
  function modal(html, cls = '') {
    modalRoot.innerHTML = `<div class="backdrop" data-action="closeModal" data-self="1"><div class="modal ${cls}">${html}</div></div>`;
    const first = modalRoot.querySelector('[autofocus]') || modalRoot.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
  }
  const closeModal = () => {
    modalRoot.innerHTML = '';
    S.openTaskId = null;
  };
  const val = (id) => modalRoot.querySelector('#' + id)?.value ?? '';
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const peopleOpts = (sel) => opts([['', 'Unassigned \u2014 anyone can take it'], ...TB.people(S.st).map((p) => [p.email, p.email === me() ? `${p.name} (you)` : p.name])], sel);
  const sprintOpts = (sel) => opts([['', 'No sprint'], ...S.st.config.sprints.map((s) => [s.id, s.name])], sel);

  // ---- new task
  function newTask(status) {
    const st = S.st;
    const sprintId = S.sprint === 'active' ? st.config.activeSprintId : !['all', 'none'].includes(S.sprint) ? S.sprint : null;
    modal(`
      <div class="modal-head"><h2>${icon('plus')} New task</h2><button class="btn ghost icon x" data-action="closeModal">${icon('x')}</button></div>
      <div class="modal-body">
        <div class="field"><input class="input title" id="f-title" placeholder="What needs to be done?" autofocus></div>
        <div class="field"><label>Details <span class="opt">optional</span></label><textarea class="input" id="f-desc" rows="3" placeholder="Context, links, what 'done' looks like\u2026"></textarea></div>
        <div class="grid2">
          <div class="field"><label>Who does it?</label><select class="input" id="f-who">${peopleOpts('')}</select></div>
          <div class="field"><label>Column</label><select class="input" id="f-status">${opts(TB.STATUSES.map((s) => [s.id, s.label]), status || 'todo')}</select></div>
        </div>
        <details class="more">
          <summary>More options: priority, points, sprint, labels</summary>
          <div class="grid3">
            <div class="field"><label>Priority</label><select class="input" id="f-prio">${opts(TB.PRIORITIES.map((p) => [p.id, p.label]), 'medium')}</select></div>
            <div class="field"><label>Effort (points)</label><select class="input" id="f-pts">${opts(TB.POINTS.map((p) => [p, p]), 1)}</select></div>
            <div class="field"><label>Sprint</label><select class="input" id="f-sprint">${sprintOpts(sprintId)}</select></div>
          </div>
          <div class="field"><label>Labels</label><input class="input" id="f-labels" placeholder="e.g. frontend, bug, marketing"></div>
        </details>
        <label class="check"><input type="checkbox" id="f-take"> I'll do this myself, starting now</label>
      </div>
      <div class="modal-foot"><span class="muted" style="font-size:11px">Ctrl+Enter to create</span><span class="grow"></span><button class="btn" data-action="closeModal">Cancel</button><button class="btn primary" data-action="createTask">${icon('check')} Create task</button></div>`, 'narrow');
  }

  function createTask() {
    const title = val('f-title').trim();
    if (!title) {
      modalRoot.querySelector('#f-title').focus();
      TB.toast('Give the task a title');
      return;
    }
    const take = modalRoot.querySelector('#f-take')?.checked;
    post('saveTask', {
      task: {
        title,
        description: val('f-desc'),
        status: take ? 'inprogress' : val('f-status'),
        priority: val('f-prio') || 'medium',
        points: Number(val('f-pts') || 1),
        assignee: take ? me() : val('f-who') || null,
        sprintId: val('f-sprint') || null,
        labels: val('f-labels').split(',').map((s) => s.trim()).filter(Boolean),
      },
      setCurrent: take,
    });
    closeModal();
    TB.toast('Task created');
  }

  // ---- task page (view + edit + updates)
  function openTask(id) {
    const t = task(id);
    if (!t) return;
    S.openTaskId = id;
    const st = S.st;
    modal(`
      <div class="modal-head">
        <span class="tid" style="font-size:12.5px">${t.id}</span>
        <span id="m-badge"></span>
        <button class="btn ghost icon x" data-action="closeModal" title="Close (Esc)">${icon('x')}</button>
      </div>
      <div class="modal-body">
        <input class="input title bare" id="f-title" data-field="title" value="${esc(t.title)}" title="Click to edit">
        <div id="m-status"></div>
        <div id="m-action"></div>
        <div class="split">
          <div>
            <div class="field"><label>Details</label><textarea class="input" id="f-desc" data-field="description" rows="3" placeholder="Add context, links, what 'done' looks like\u2026">${esc(t.description)}</textarea></div>
            <div class="section-title" style="margin-top:6px">${icon('note', 'sm')} Updates</div>
            <div class="composer">
              <textarea class="input" id="u-msg" rows="2" placeholder="What did you do? e.g. \u201CSent the newsletter to 2,000 users\u201D (no commit needed)"></textarea>
              <div class="row">
                <select class="input compact" id="u-cat" title="Type of work">${opts(st.config.categories.map((c) => [c, c]), st.config.categories[0])}</select>
                <input class="input compact" id="u-hours" type="number" min="0" step="0.25" placeholder="Hours" title="Hours spent (optional)" style="width:84px">
                <span class="grow"></span>
                <button class="btn primary" data-action="postUpdate">Post update</button>
              </div>
            </div>
            <div id="m-feed"></div>
          </div>
          <aside class="details">
            <div class="field"><label>Assigned to</label><select class="input" id="f-who" data-field="assignee">${peopleOpts(t.assignee)}</select></div>
            <div class="field"><label>Priority</label><select class="input" id="f-prio" data-field="priority">${opts(TB.PRIORITIES.map((p) => [p.id, p.label]), t.priority)}</select></div>
            <div class="field"><label>Effort (points)</label><select class="input" id="f-pts" data-field="points">${opts(TB.POINTS.map((p) => [p, p]), t.points)}</select></div>
            ${st.config.sprints.length ? `<div class="field"><label>Sprint</label><select class="input" id="f-sprint" data-field="sprintId">${sprintOpts(t.sprintId)}</select></div>` : ''}
            <div class="field"><label>Labels</label><input class="input" id="f-labels" data-field="labels" value="${esc((t.labels || []).join(', '))}" placeholder="comma separated"></div>
            <div id="m-meta"></div>
            <div class="saved-note">${icon('check', 'sm')} Changes save automatically</div>
            <button class="btn danger sm" data-action="deleteTask" data-id="${t.id}" style="margin-top:10px">${icon('trash', 'sm')} Delete task</button>
          </aside>
        </div>
      </div>`, 'wide');
    refreshTaskPage();
  }

  /** Re-render the live parts of the open task page without touching inputs being typed in. */
  function refreshTaskPage() {
    const t = task(S.openTaskId);
    if (!t) {
      closeModal();
      return;
    }
    const st = S.st;
    const w = who();
    const set = (id, html) => {
      const el = modalRoot.querySelector('#' + id);
      if (el) el.innerHTML = html;
    };
    const cur = TB.STATUSES.findIndex((s) => s.id === t.status);
    const status = TB.statusOf(t.status);
    set('m-badge', `<span class="pill dot" style="color:${status.color}">${status.label}</span>`);
    set('m-status', `<div class="stepper" title="Click a step to move the task">${TB.STATUSES.map((s, i) => `<button class="step ${i === cur ? 'on' : ''} ${i < cur ? 'past' : ''}" style="--c:${s.color}" data-action="setStatus" data-status="${s.id}">${i < cur ? icon('check', 'sm') : ''}${s.label}</button>`).join('')}</div>`);

    const isMine = t.assignee === me();
    const isCurrent = t.id === st.currentTaskId;
    let action;
    if (t.status === 'done') {
      action = `<div class="cta done">${icon('check')} <div><b>This task is done.</b> <span class="muted">Finished ${TB.timeAgo(t.doneAt || t.updatedAt)}${t.assignee ? ' by ' + esc(isMine ? 'you' : w(t.assignee).name) : ''}.</span></div></div>`;
    } else if (!t.assignee) {
      action = `<div class="cta"><div class="grow"><b>Nobody is on this yet.</b> <span class="muted">Take it to assign it to yourself and start.</span></div><button class="btn primary" data-action="pickFromModal" data-id="${t.id}">${icon('play')} I'll take this</button></div>`;
    } else if (isCurrent) {
      action = `<div class="cta mine"><div class="grow"><b>${icon('target', 'sm')} You're working on this.</b> <span class="muted">Your commits link here automatically. Not coding? Post an update below.</span></div>${t.status !== 'review' ? `<button class="btn" data-action="setStatus" data-status="review">Send to review</button>` : ''}<button class="btn primary" data-action="setStatus" data-status="done">${icon('check')} Mark done</button></div>`;
    } else if (isMine) {
      action = `<div class="cta"><div class="grow"><b>Assigned to you.</b> <span class="muted">Make it your current task so new commits link here.</span></div><button class="btn primary" data-action="setCurrentFromModal" data-id="${t.id}">${icon('target')} Work on this now</button></div>`;
    } else {
      const a = w(t.assignee);
      action = `<div class="cta"><div class="grow row">${avatar(a)}<span><b>${esc(a.name)}</b> <span class="muted">is working on this.</span></span></div><button class="btn ghost" data-action="pickFromModal" data-id="${t.id}">Take over</button></div>`;
    }
    set('m-action', action);

    const items = feedItems(t.id);
    const commits = items.filter((i) => i.kind === 'commit');
    const add = commits.reduce((a, i) => a + i.c.add, 0);
    const del = commits.reduce((a, i) => a + i.c.del, 0);
    set('m-feed', items.length
      ? `<div class="feed">${items.map((i) => feedItem(i, true)).join('')}</div>`
      : `<div class="muted feed-empty">No updates or commits yet. Commits link here when you choose this task after committing, or add <span class="mono">[${t.id}]</span> to the commit message.</div>`);
    const hours = st.activity.filter((a) => a.type === 'external' && a.taskId === t.id).reduce((a, x) => a + (Number(x.hours) || 0), 0);
    set('m-meta', `
      <div class="kv"><span>Created by</span><span>${esc(w(t.createdBy)?.name || t.createdBy)}</span></div>
      <div class="kv"><span>Created</span><span>${TB.timeAgo(t.createdAt)}</span></div>
      <div class="kv"><span>Commits</span><span>${commits.length}${commits.length ? ` \u00B7 <span class="plus">+${TB.fmt(add)}</span> <span class="minus">\u2212${TB.fmt(del)}</span>` : ''}</span></div>
      ${hours ? `<div class="kv"><span>Hours logged</span><span>${hours}h</span></div>` : ''}`);
  }

  function saveField(el) {
    const id = S.openTaskId;
    const field = el.dataset.field;
    if (!id || !field) return;
    let value = el.value;
    if (field === 'title') {
      value = value.trim();
      if (!value) { el.value = task(id).title; return; }
    }
    if (field === 'points') value = Number(value);
    if (field === 'labels') value = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (field === 'assignee' || field === 'sprintId') value = value || null;
    post('saveTask', { task: { id, [field]: value } });
    TB.toast('Saved');
  }

  function setStatus(status) {
    const t = task(S.openTaskId);
    if (!t || t.status === status) return;
    t.status = status; // optimistic
    post('moveTask', { id: t.id, status });
    refreshTaskPage();
    renderColumns();
    TB.toast(status === 'done' ? `\u{1F389} ${t.id} done!` : `Moved to ${TB.statusOf(status).label}`);
  }

  function postUpdate() {
    const message = val('u-msg').trim();
    if (!message) {
      modalRoot.querySelector('#u-msg').focus();
      TB.toast('Write what you did first');
      return;
    }
    post('logWork', { entry: { message, category: val('u-cat'), hours: Number(val('u-hours')) || 0, taskId: S.openTaskId } });
    modalRoot.querySelector('#u-msg').value = '';
    modalRoot.querySelector('#u-hours').value = '';
    TB.toast('Update posted \u2713');
  }

  // ---- quick update (not opened from a task)
  function openLogWork() {
    const st = S.st;
    const open = st.tasks.filter((t) => t.status !== 'done');
    modal(`
      <div class="modal-head"><h2>${icon('note')} Add an update</h2><button class="btn ghost icon x" data-action="closeModal">${icon('x')}</button></div>
      <div class="modal-body">
        <p class="muted" style="margin-top:0">For work that isn't code, like marketing, design, calls or research, so it still counts. No commit needed.</p>
        <div class="field"><label>Which task is it for?</label><select class="input" id="w-task">${opts([['', 'No specific task'], ...open.map((t) => [t.id, `${t.id} \u00B7 ${t.title}`])], st.currentTaskId || '')}</select></div>
        <div class="field"><label>What did you do?</label><textarea class="input" id="w-msg" rows="3" placeholder="e.g. Wrote the launch announcement and scheduled social posts" autofocus></textarea></div>
        <div class="grid3">
          <div class="field"><label>Type</label><select class="input" id="w-cat">${opts(st.config.categories.map((c) => [c, c]), st.config.categories[0])}</select></div>
          <div class="field"><label>Hours <span class="opt">optional</span></label><input class="input" id="w-hours" type="number" min="0" step="0.25" placeholder="1"></div>
          <div class="field"><label>Date</label><input class="input" id="w-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <label class="check"><input type="checkbox" id="w-done"> This finishes the task (move it to Done)</label>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-action="closeModal">Cancel</button><button class="btn primary" data-action="saveWork">${icon('check')} Post update</button></div>`, 'narrow');
  }

  function openSprints() {
    const st = S.st;
    const today = new Date();
    const end = new Date(today.getTime() + 13 * TB.DAY);
    const iso = (d) => d.toISOString().slice(0, 10);
    modal(`
      <div class="modal-head"><h2>${icon('flag')} Sprints</h2><button class="btn ghost icon x" data-action="closeModal">${icon('x')}</button></div>
      <div class="modal-body">
        <p class="muted" style="margin-top:0">Optional. A sprint is a short time-box (usually 1\u20132 weeks) with a goal. Add tasks to it and the board shows progress and days left.</p>
        ${st.config.sprints.map((s) => {
          const n = st.tasks.filter((t) => t.sprintId === s.id).length;
          const on = s.id === st.config.activeSprintId;
          return `<div class="sprint-row ${on ? 'on' : ''}">
            <div class="grow"><b>${esc(s.name)}</b> <span class="muted">\u00B7 ${esc(s.start)} \u2192 ${esc(s.end)} \u00B7 ${n} tasks</span>${s.goal ? `<div class="muted" style="font-size:12px">${esc(s.goal)}</div>` : ''}</div>
            ${on ? `<span class="pill" style="color:var(--accent);background:var(--accent-soft)">Current</span>` : `<button class="btn sm" data-action="activateSprint" data-id="${s.id}">Make current</button>`}
            <button class="btn ghost icon sm" data-action="deleteSprint" data-id="${s.id}" title="Delete sprint (tasks are kept)">${icon('trash', 'sm')}</button>
          </div>`;
        }).join('')}
        <div class="section-title" style="margin-top:18px">${icon('plus', 'sm')} New sprint</div>
        <div class="field"><label>Name</label><input class="input" id="s-name" value="Sprint ${st.config.sprints.length + 1}"></div>
        <div class="grid2">
          <div class="field"><label>Start</label><input class="input" id="s-start" type="date" value="${iso(today)}"></div>
          <div class="field"><label>End</label><input class="input" id="s-end" type="date" value="${iso(end)}"></div>
        </div>
        <div class="field"><label>Goal <span class="opt">optional</span></label><input class="input" id="s-goal" placeholder="e.g. Ship onboarding v2"></div>
      </div>
      <div class="modal-foot">${st.config.activeSprintId ? `<button class="btn" data-action="activateSprint" data-id="">End current sprint</button>` : ''}<span class="grow"></span><button class="btn primary" data-action="createSprint">${icon('plus')} Start sprint</button></div>`, 'narrow');
  }

  function openMember(email) {
    const p = email ? who()(email) : null;
    const m = email ? S.st.members.find((x) => x.email === email) : null;
    modal(`
      <div class="modal-head"><h2>${icon('users')} ${p ? 'Edit person' : 'Add a team member'}</h2><button class="btn ghost icon x" data-action="closeModal">${icon('x')}</button></div>
      <div class="modal-body">
        <p class="muted" style="margin-top:0">Add people who don't write code (marketing, design, PM). They can then be assigned tasks, post updates and appear on the leaderboard. If they also commit, use the same email as their git config.</p>
        <div class="field"><label>Name</label><input class="input" id="m-name" value="${esc(m?.name || p?.name || '')}" placeholder="Jane Doe"></div>
        <div class="field"><label>Email</label><input class="input" id="m-email" value="${esc(email || '')}" ${email ? 'readonly' : ''} placeholder="jane@company.com"></div>
        <div class="field"><label>Role <span class="opt">optional</span></label><input class="input" id="m-role" value="${esc(m?.role || p?.role || '')}" placeholder="Marketing, Design, Backend\u2026"></div>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-action="closeModal">Cancel</button><button class="btn primary" data-action="saveMember">${icon('check')} Save</button></div>`, 'narrow');
  }

  function openRename() {
    modal(`
      <div class="modal-head"><h2>${icon('edit')} Rename project</h2><button class="btn ghost icon x" data-action="closeModal">${icon('x')}</button></div>
      <div class="modal-body"><div class="field"><label>Project name</label><input class="input" id="p-name" value="${esc(S.st.config.project)}"></div></div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-action="closeModal">Cancel</button><button class="btn primary" data-action="saveRename">Save</button></div>`, 'narrow');
  }

  // ------------------------------------------------------------------ events
  const actions = {
    tab: (el) => { S.tab = el.dataset.tab; persist(); render(); },
    toggleHelp: () => { S.help = !S.help; persist(); render(); },
    refresh: () => post('refresh'),
    newTask: (el) => newTask(el.dataset.status),
    createTask,
    logWork: openLogWork,
    rename: openRename,
    sprints: openSprints,
    show: (el) => { S.show = el.dataset.show; S.person = ''; persist(); render(); },
    openTask: (el) => openTask(el.dataset.id),
    pick: (el) => { post('pickTask', { id: el.dataset.id }); TB.toast("It's yours. Good luck!"); },
    pickFromModal: (el) => { post('pickTask', { id: el.dataset.id }); TB.toast("It's yours. Good luck!"); },
    setCurrentFromModal: (el) => { post('setCurrent', { id: el.dataset.id }); TB.toast('Set as your current task'); },
    setStatus: (el) => setStatus(el.dataset.status),
    postUpdate,
    deleteTask: (el) => post('deleteTask', { id: el.dataset.id }),
    closeModal: (el, e) => { if (!el.dataset.self || e.target === el) closeModal(); },
    saveWork: () => {
      const message = val('w-msg').trim();
      if (!message) { TB.toast('Write what you did first'); return; }
      const taskId = val('w-task') || undefined;
      post('logWork', { entry: { message, category: val('w-cat'), hours: Number(val('w-hours')) || 0, date: val('w-date') ? val('w-date') + 'T12:00:00' : undefined, taskId } });
      if (taskId && modalRoot.querySelector('#w-done')?.checked) post('moveTask', { id: taskId, status: 'done' });
      closeModal(); TB.toast('Update posted \u2713');
    },
    createSprint: () => {
      post('saveSprint', { sprint: { name: val('s-name'), start: val('s-start'), end: val('s-end'), goal: val('s-goal'), makeActive: true } });
      closeModal(); TB.toast('Sprint started');
    },
    activateSprint: (el) => { post('setActiveSprint', { id: el.dataset.id || null }); closeModal(); },
    deleteSprint: (el) => { post('deleteSprint', { id: el.dataset.id }); closeModal(); },
    range: (el) => { S.range = Number(el.dataset.range); persist(); render(); },
    sort: (el) => { S.sort = el.dataset.sort; persist(); render(); },
    act: (el) => { S.act = el.dataset.act; persist(); render(); },
    addMember: () => openMember(null),
    editMember: (el) => openMember(el.dataset.email),
    removeMember: (el) => post('removeMember', { email: el.dataset.email }),
    saveMember: () => {
      const email = val('m-email').trim();
      if (!/.+@.+/.test(email)) { TB.toast('Enter a valid email'); return; }
      post('saveMember', { member: { name: val('m-name'), email, role: val('m-role') } });
      closeModal(); TB.toast('Saved');
    },
    saveRename: () => { post('renameProject', { name: val('p-name') }); closeModal(); },
    linkCommit: (el) => post('linkCommit', { hash: el.dataset.hash }),
    deleteActivity: (el) => post('deleteActivity', { email: me(), id: el.dataset.id }),
    sponsor: () => post('sponsor'),
  };
  TB.on(document.body, 'click', (action, el, e) => actions[action]?.(el, e));

  document.addEventListener('input', (e) => {
    if (e.target.id === 'q') { S.q = e.target.value; renderColumns(); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'sprintFilter') { S.sprint = t.value; persist(); render(); }
    if (t.id === 'personFilter') { S.person = t.value; persist(); render(); }
    if (S.openTaskId && t.dataset.field) saveField(t);
  });
  document.addEventListener('keydown', (e) => {
    const inModal = !!modalRoot.innerHTML;
    if (e.key === 'Escape' && inModal) closeModal();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && inModal) {
      if (document.activeElement?.id === 'u-msg') postUpdate();
      else modalRoot.querySelector('.modal-foot .btn.primary')?.click();
    }
    if (e.key === 'Enter' && document.activeElement?.id === 'f-title' && S.openTaskId) document.activeElement.blur();
    if (!inModal && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
      if (e.key === 'n') { e.preventDefault(); newTask(); }
      if (e.key === '/') { e.preventDefault(); document.getElementById('q')?.focus(); }
    }
  });

  // drag & drop
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('.card');
    if (!c) return;
    S.dragId = c.dataset.id;
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', S.dragId);
  });
  document.addEventListener('dragend', (e) => {
    e.target.closest?.('.card')?.classList.remove('dragging');
    document.querySelectorAll('.col.over').forEach((c) => c.classList.remove('over'));
    S.dragId = null;
  });
  document.addEventListener('dragover', (e) => {
    const col = e.target.closest?.('.col');
    if (!col || !S.dragId) return;
    e.preventDefault();
    document.querySelectorAll('.col.over').forEach((c) => c !== col && c.classList.remove('over'));
    col.classList.add('over');
  });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest?.('.col');
    if (!col || !S.dragId) return;
    e.preventDefault();
    const t = task(S.dragId);
    const status = col.dataset.status;
    if (t && t.status !== status) {
      t.status = status; // optimistic
      post('moveTask', { id: t.id, status });
      renderColumns();
      TB.toast(status === 'done' ? `\u{1F389} ${t.id} done!` : `Moved to ${TB.statusOf(status).label}`);
    }
    S.dragId = null;
  });
})();
