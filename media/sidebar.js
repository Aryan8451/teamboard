// TeamBoard sidebar: current task, my tasks, up-for-grabs, mini leaderboard.
(() => {
  const { esc, icon, avatar, post } = TB;
  const app = document.getElementById('app');
  let st = null;

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') {
      st = e.data.state;
      render();
    }
  });
  post('ready');

  function render() {
    if (!st.ready) {
      app.innerHTML = `<div class="now-empty"><b>No folder open</b>Open a git repository to use TeamBoard.</div>`;
      return;
    }
    const meEmail = st.me.email;
    const current = st.tasks.find((t) => t.id === st.currentTaskId);
    const mine = st.tasks.filter((t) => t.assignee === meEmail && t.status !== 'done' && t.id !== st.currentTaskId);
    const grabs = st.tasks.filter((t) => !t.assignee && (t.status === 'todo' || t.status === 'backlog')).sort((a, b) => (a.status === 'todo' ? -1 : 1) - (b.status === 'todo' ? -1 : 1));
    const ranked = TB.stats(st, 30).sort((a, b) => b.score - a.score);
    const myRank = ranked.findIndex((r) => r.email === meEmail) + 1;
    const myRow = ranked[myRank - 1];
    const commits = current ? TB.taskCommits(st, current.id).length : 0;
    const status = current && TB.statusOf(current.status);

    app.innerHTML = `
      <div class="sb-me">
        ${avatar({ name: st.me.name, email: meEmail }, 'md')}
        <div style="min-width:0"><div class="n">${esc(st.me.name)}</div><div class="e">${esc(meEmail)}</div></div>
        ${myRow?.score ? `<div class="sb-rank" title="Your rank (last 30 days)"><b>#${myRank}</b><small>${TB.fmt(myRow.score)} pts</small></div>` : ''}
      </div>

      ${current ? `
        <div class="now-card">
          <div class="lbl">${icon('target', 'sm')} Working on now</div>
          <div class="ttl" data-action="open" data-id="${current.id}">${esc(current.title)}</div>
          <div class="row" style="flex-wrap:wrap;gap:6px">
            <span class="tid">${current.id}</span>
            <span class="pill dot" style="color:${status.color}">${status.label}</span>
            <span class="pill p-${current.priority}">${current.priority}</span>
            <span class="muted" style="font-size:11px">${icon('commit', 'sm')} ${commits}</span>
          </div>
          <div class="acts">
            <button class="btn sm primary" data-action="move" data-id="${current.id}" data-status="done">${icon('check', 'sm')} Mark done</button>
            <button class="btn sm" data-action="open" data-id="${current.id}" title="Post progress on non-code work">${icon('note', 'sm')} Add update</button>
            <button class="btn sm ghost" data-action="cmd" data-command="teamboard.setCurrentTask" title="Work on a different task">Switch</button>
          </div>
        </div>` : `
        <div class="now-empty">
          <b>What are you working on?</b>
          Choose a task and your commits and updates will be linked to it.
          <div style="margin-top:10px"><button class="btn sm primary" data-action="cmd" data-command="teamboard.setCurrentTask">${icon('target', 'sm')} Choose task</button></div>
        </div>`}

      <div class="sb-actions">
        <button class="btn sm" data-action="board">${icon('board', 'sm')} Open board</button>
        <button class="btn sm" data-action="cmd" data-command="teamboard.newTask">${icon('plus', 'sm')} New task</button>
        <button class="btn sm" data-action="cmd" data-command="teamboard.logWork" title="Non-code work: marketing, design, calls\u2026">${icon('note', 'sm')} Add update</button>
        <button class="btn sm" data-action="cmd" data-command="teamboard.linkLastCommit" title="Linked your last commit to the wrong task? Change it">${icon('link', 'sm')} Fix last commit</button>
      </div>

      <div class="sb-title">My tasks <span class="n">${mine.length}</span></div>
      ${mine.length ? mine.map((t) => mini(t, 'current')).join('') : `<div class="muted" style="font-size:12px;padding:2px 4px">Nothing assigned to you.</div>`}

      <div class="sb-title">Unassigned, anyone can take <span class="n">${grabs.length}</span></div>
      ${grabs.length ? grabs.slice(0, 8).map((t) => mini(t, 'pick')).join('') : `<div class="muted" style="font-size:12px;padding:2px 4px">No unassigned tasks \u{1F389}</div>`}

      <div class="sb-title">${icon('trophy', 'sm')} Top contributors \u00B7 30d</div>
      ${ranked.filter((r) => r.score).slice(0, 5).map((r, i) => `
        <div class="lb-mini ${r.email === meEmail ? 'me' : ''}">
          <span class="r r${i + 1}">${i + 1}</span>${avatar(r)}<span class="n">${esc(r.name)}</span><b>${TB.fmt(r.score)}</b>
        </div>`).join('') || `<div class="muted" style="font-size:12px;padding:2px 4px">No activity yet.</div>`}
      <div style="margin-top:8px"><button class="btn sm ghost block" data-action="team">View full leaderboard ${icon('arrow', 'sm')}</button></div>
      <footer class="foot">Made with <span class="heart">\u2665</span> by Aryan \u00B7 <button class="foot-link" data-action="sponsor" title="Visit quickdm.app">quickdm.app</button></footer>`;
  }

  function mini(t, mode) {
    const s = TB.statusOf(t.status);
    return `<div class="mini" data-action="${mode === 'pick' ? 'open' : 'current'}" data-id="${t.id}" title="${esc(t.title)} \u2014 ${s.label}${mode === 'pick' ? '' : ' \u00B7 click to make it your current task'}">
      <span class="sd" style="--c:${s.color}"></span>
      <span class="t">${esc(t.title)}</span>
      ${mode === 'pick' ? `<button class="pickup" data-action="pick" data-id="${t.id}" title="Assign to me and start">Take it</button>` : `<span class="tid">${t.id}</span>`}
    </div>`;
  }

  TB.on(document.body, 'click', (action, el) => {
    const id = el.dataset.id;
    switch (action) {
      case 'open': return post('openBoard', { tab: 'board', taskId: id });
      case 'current': return post('setCurrent', { id });
      case 'pick': return post('pickTask', { id });
      case 'move': return post('moveTask', { id, status: el.dataset.status });
      case 'board': return post('openBoard', { tab: 'board' });
      case 'team': return post('openBoard', { tab: 'team' });
      case 'cmd': return post('command', { command: el.dataset.command });
      case 'sponsor': return post('sponsor');
    }
  });
})();
