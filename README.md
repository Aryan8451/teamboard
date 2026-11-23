# TeamBoard

A free Kanban/Scrum board that lives inside your repo. There's no server, no account and no subscription: the board is saved as JSON in `.teamboard/` and syncs through git like your code.

## Features

**Kanban board**
- Five columns: Backlog -> To Do -> In Progress -> Review -> Done. Drag and drop cards between them.
- Each task has a priority, story points, labels, an assignee and a sprint.
- Use the **Up for grabs** filter to see unassigned tasks. Contributors choose their own work with **Pick up**, which assigns the task to them, moves it to *In Progress* and makes it their current task.
- Filter by person, by "mine" or by sprint, or search. Press `n` to create a task and `/` to search.

**Scrum sprints**
- Create time-boxed sprints with a goal, then set one as active.
- The sprint bar shows points done and in flight, plus how many days are left.

**"What was this commit for?"**
- After each commit you make (Source Control panel or terminal), a picker opens. Choose your current task, another task, *create a new task*, or **type a free-text note**, such as *"Marketing: landing page copy"*, for work that isn't a task.
- If the commit message already has a tag like `[T-AB12]`, it's linked automatically.
- After a **push**, TeamBoard offers to link any of your pushed commits that are still unlinked.
- Your current task tag is pre-filled in the commit box, and the status bar always shows what you're working on.

**External work log**
- Log non-code work (marketing, design, meetings, research, support) with a category and hours, so everyone's contribution is counted.
- Add non-coding team members from the Team tab.

**Contributors and leaderboard**
- Everyone on the project in one list: git authors, manually added members and assignees.
- Shows commits, lines added and removed, files touched, tasks shipped, story points and external hours.
- Includes a 12-week trend sparkline, a podium for the top 3, and each person's share of impact.
- Filter by 7, 30 or 90 days, or all time. Click any column to sort.
- **Impact score** = commits x 3 + tasks done x 10 + story points x 5 + update hours x 4 + lines changed / 50.
- Lockfiles and build output are left out of line counts. You can change this with `teamboard.excludeFromLineStats`.

**Activity timeline**
- Every commit (linked or not), logged piece of work and task change, grouped by day.

## Team setup

1. Install the extension (see below) and open your git repo.
2. Click the **TeamBoard** icon in the Activity Bar and create a task.
3. **Commit and push the `.teamboard/` folder.** When teammates pull, they get the same board.

Each task is its own file and each person has their own activity file, so merge conflicts should be rare.

Your identity comes from `git config user.name` and `user.email`. Use the same email when adding a member manually so their stats merge.

## Install

```bash
npm install
npm run compile
npm run package        # creates teamboard-0.1.0.vsix
code --install-extension teamboard-0.1.0.vsix
```

To develop, open this folder in VS Code and press **F5**.

## Settings

| Setting | Default | |
|---|---|---|
| `teamboard.commitPrompt` | `always` | Show the "what was this for?" picker after your commits (`never` turns it off) |
| `teamboard.promptOnPush` | `true` | After a push, offer to link unlinked commits |
| `teamboard.autoTagCommitMessage` | `true` | Pre-fill `[T-XXXX]` in the commit box |
| `teamboard.maxCommits` | `5000` | How many commits of history to read for stats |
| `teamboard.excludeFromLineStats` | lockfiles, dist... | Glob patterns left out of line counts |

## About the maker

Made by **Aryan Goud**, an indie maker. TeamBoard is free. If it helps your team, please leave a review on the Marketplace.

## Commands

`TeamBoard: Open Board` | `Open Contributors & Leaderboard` | `New Task` | `Log External Work` | `Set Current Task` (or click the status bar) | `Link Last Commit to a Task` | `Refresh`
