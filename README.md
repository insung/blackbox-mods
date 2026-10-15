# blackbox-mods

[한국어](README.ko.md)

A Claude Code mod that records what Claude looks at, what it decides, and where it works, in one panel next to the conversation.

Open it with `/blackbox-mods`. Only this command opens the panel. Records keep accumulating while it is closed and show when you open it. The panel text is in Korean. The panel has six tabs:

| Tab | What it shows |
| --- | --- |
| Session log | Each request starts with its time in colour, such as `[14:02]`, and, under it, the request summary as a Markdown `##` heading (a large heading on desktop, bold in the terminal). Under it: database queries (purpose, SQL, result table), files Claude read (purpose, full paths, conclusion), files Claude changed with Edit·Write·NotebookEdit (written or edited, full path), other Bash commands (purpose from the Bash description, up to 8 lines of the command highlighted as bash, the first lines of its output, failed or denied), in time order. Each entry starts with a coloured header that names its kind (file read, file change, command, query), without a time. Purpose, run and result show as a Markdown list such as `- 목적:`, with the command and its output in code blocks under the list. One request is shown at a time; `◀ Prev` and `Next ▶` turn the pages, `current / total` counts requests, and the last page follows new requests |
| Decisions | Items you must decide (`[ ]`) and items Claude decided itself (`[x] … (Claude 가 정함)`), grouped by request under the same `[request time]` and request summary header as the session log. When an item is decided, the same line shows `=> result` and `-> your answer`. Option buttons put `d1: option` in the prompt box; you send it |
| Git | Issues and PRs handled in this session, grouped by repository under an `▸ owner/repo  N건` header (repositories and items in the order they first appear). Handled means a write action of `gh issue/pr` (create, comment, close, merge and so on; `view`, `list`, `status`, `diff` and `checks` do not count) touched it, or a commit of this session is linked to it. Each row follows the app's PR chip: state · #number · branch · +additions −deletions · CI. Commits made with Bash in this session (short SHA · subject; a commit made with `-q` is found in git by its subject) record the `origin` repository of the folder they were made in, and appear under the issue or PR of the same repository, matched by `#N` in the message or by the PR's head branch. The rest are listed under "Commits without an issue" (이슈 없는 커밋) in their repository, and commits whose `origin` is unknown under `▸ 저장소 모름`. Issues and PRs only mentioned in prompts, answers, `gh … view` or `gh` output are listed at the bottom under "Referenced issues and PRs" (참고한 이슈·PR), by repository, with state · #number · title and, when they came from a prompt or an answer, that source (`사용자 프롬프트`, `Claude 답변`). `gh` command names and command output are not shown as sources |
| Worktrees | Git worktrees this session uses, as a tree per repository, with an "Open in VS Code" button on each worktree in use |
| Skill usage | Skill runs grouped by plugin, custom skills, and built-in skills, with counts, shares, and an excerpt of the request that triggered each run |
| Implicit agreements | What Claude took as agreed without anyone asking: scope, terms, way of working, how a request was read, and the like. Each item shows its kind and evidence, grouped by request from oldest to newest, under the same request header as the session log. Press an assumed item (`[?]`) to pick it (`▶`) and again to unpick it. `선택 맞음` (yes) and `선택 아님` (no) fill the prompt box with the picked ids joined by commas, such as `a1, a3: 맞음`, and clear the picks; `선택 해제` only clears them. You send it. Confirmed items show `[o]`, revoked items `[-]` with what changed |

## Install

Requires Claude Code with mod (hooks module) support. Tested on Claude Code 2.1.295.

```bash
claude plugin marketplace add insung/blackbox-mods
```

```bash
claude plugin install blackbox-mods@blackbox-mods
```

In a running session, run `/reload-plugins`, then `/blackbox-mods`.

To update after a new version is pushed:

```bash
claude plugin update blackbox-mods@blackbox-mods
```

## What the mod adds to Claude

The mod registers four tools the model can call and adds rules to the system prompt so the panel gets filled.

| Tool | Purpose |
| --- | --- |
| `mcp__blackbox-mods__track_decisions` | Records items you must decide and items Claude decided, and how each one was decided |
| `mcp__blackbox-mods__track_agreements` | Records what Claude took as agreed without asking, with its evidence, and whether you confirmed or revoked it |
| `mcp__blackbox-mods__note_reads` | Records why Claude read files and what it concluded |

System prompt rules:

- Start each SQL statement with a `-- 조회 목적: <purpose>` comment. The panel shows it as the query purpose.
- Register decision items with `track_decisions`, and update them when you answer. An answer in the form `d1: option` decides item `d1`.
- Register implicit agreements with `track_agreements`, not items that were asked and answered. An answer `a1: 맞음` confirms item `a1`; `a1: 아님` revokes it; `a1, a3: 맞음` gives the same answer to each id listed, and Claude rechecks work done on it.
- After reading files to reach a conclusion, send the purpose and the conclusion with `note_reads`.

Automatic records (no tool call needed): Bash commands that run `run_query.py` or `mysql`, files read with the Read tool, `AskUserQuestion` answers, skill runs, and GitHub references in the conversation.

## External calls

| Call | When | What is sent |
| --- | --- | --- |
| `gh api`, `gh pr view`, `gh issue view` | When the Git tab is opened or refreshed, and at the end of each turn | Repository and issue number of each reference |
| Model summary (`haiku`, through your Claude Code session) | When you send a request longer than 30 characters | The first 4,000 characters of the request, once, to make the one-line summary |
| `git`, `code` (VS Code) | Worktrees tab, "Open in VS Code" button | Local commands only |

References that GitHub answers with 404 are hidden.

## Record storage

Panel records are also kept on disk. When the desktop app pauses a session that sat idle for 15 minutes, or Claude Code restarts, reopening the same session shows the earlier records again.

- Location: Claude Code's `$.store`, a JSON file of this plugin's own under the Claude Code configuration directory (`~/.claude/` by default). Each session has one key, `session:<session id>`, holding its records and the time of its last save (`updatedAt`).
- When it saves: one second after records change, when a turn completes, and when the session ends.
- Restore: when a session starts, the records saved under the same session id go back into the panel. A new session starts with an empty panel. Records of other sessions are not read.
- What it saves: the session log (requests, queries, commands and files, files read), decisions, implicit agreements, the places the work tree tab uses, the last user request, and the tab and page in view. The Git, work tree and skill usage tabs are read again from the conversation and git when a session starts, so they are not saved.

The plugin code applies the retention rules itself, when a session starts and on every save. There is no separate script to run.

| Rule | What it does |
| --- | --- |
| 30-day retention | Deletes other sessions whose last save is more than 30 days old |
| 4 MiB in total | `$.store` takes at most 4 MiB of JSON per plugin. When all session records together exceed the limit less a 256 KiB margin (3.75 MiB), other sessions are deleted one at a time, oldest last save first, until the total is under it. It never deletes everything |
| Current session | The current session's records are never deleted. If the current session alone exceeds the limit, the saved copy has large text such as query and command output cut (`… (저장 한도를 넘어 잘림)`), then the oldest session log items dropped if still too large. Decisions and implicit agreements are kept. The records shown in the panel are not reduced |

A failed save does not stop the panel. The unsaved change is written on the next save.

## Settings

| Option | Default | Meaning |
| --- | --- | --- |
| `githubUser` | empty | gh account used to read issue and PR state (`gh auth token --user <value>`). Empty uses the gh default account |

Set it with `/plugin configure blackbox-mods@blackbox-mods`, or with `--config githubUser=<account>` at install.

## Known limits

- The query detection and the query purpose rule are tuned for one team's database tooling (`run_query.py`, `mysql`). Other tools are not recorded yet.
- Records are kept per session. Sessions do not share them.
- Records lost before this feature was added cannot be brought back.
- Requests sent before the mod loaded have no summary and are grouped as "(no request record)".

## Development

```bash
claude plugin validate .
```

```bash
npx -p typescript tsc -p .
```

```bash
claude plugin test .
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code writes when it loads the mod. Load the mod once (for example with `claude --plugin-dir .`) before running `tsc`. The MCP tool types are left out on purpose: that list differs on every machine and can exceed the type checker's limits.

An installed plugin runs a copy made at install time, so edits to the folder do not reach it. To see edits immediately, disable the installed copy and load the folder in a session that hot-reloads it: `claude --plugin-dir <folder>`, or the session's mods folder (`~/.claude/dev-mods/<session id>/`).

## License

[MIT](LICENSE)
