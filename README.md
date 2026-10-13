# blackbox-mods

[한국어](README.ko.md)

A Claude Code mod that records what Claude looks at, what it decides, and where it works, in one panel next to the conversation.

Open it with `/blackbox-mods`. The panel text is in Korean. The panel has five tabs:

| Tab | What it shows |
| --- | --- |
| Session log | One separator per request (time + one-line summary). Under it: database queries (purpose, SQL, result table), files Claude read (purpose, full paths, conclusion), files Claude changed with Edit·Write·NotebookEdit (written or edited, full path), other Bash commands (purpose from the Bash description, the command shortened to the start of its first line, the first lines of its output, failed or denied), and work plans as an ASCII flow |
| Decisions | Items you must decide (`[ ]`) and items Claude decided itself (`[x] … (Claude 가 정함)`), grouped by request. When an item is decided, the same line shows `=> result` and `-> your answer`. Option buttons put `d1: option` in the prompt box; you send it |
| Git | Issues and PRs handled in this session, in the same order as the app's PR chip: state · #number · repository · branch · +additions −deletions · CI. Commits made with Bash in this session (short SHA · subject; a commit made with `-q` is found in git by its subject) appear under the issue or PR they belong to, matched by `#N` in the message or by the PR's head branch; the rest are listed under "Commits without an issue" (이슈 없는 커밋) |
| Worktrees | Git worktrees this session uses, as a tree per repository, with an "Open in VS Code" button on each worktree in use |
| Skill usage | Skill runs grouped by plugin, custom skills, and built-in skills, with counts, shares, and an excerpt of the request that triggered each run |

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

The mod registers three tools the model can call and adds rules to the system prompt so the panel gets filled.

| Tool | Purpose |
| --- | --- |
| `mcp__blackbox-mods__show_plan` | Records the steps of a multi-step task. Shown as a flow in the Session log tab |
| `mcp__blackbox-mods__track_decisions` | Records items you must decide and items Claude decided, and how each one was decided |
| `mcp__blackbox-mods__note_reads` | Records why Claude read files and what it concluded |

System prompt rules:

- Start each SQL statement with a `-- 조회 목적: <purpose>` comment. The panel shows it as the query purpose.
- Register decision items with `track_decisions`, and update them when you answer. An answer in the form `d1: option` decides item `d1`.
- After reading files to reach a conclusion, send the purpose and the conclusion with `note_reads`.

Automatic records (no tool call needed): Bash commands that run `run_query.py` or `mysql`, files read with the Read tool, `AskUserQuestion` answers, skill runs, and GitHub references in the conversation.

## External calls

| Call | When | What is sent |
| --- | --- | --- |
| `gh api`, `gh pr view`, `gh issue view` | When the Git tab is opened or refreshed, and at the end of each turn | Repository and issue number of each reference |
| Model summary (`haiku`, through your Claude Code session) | When you send a request longer than 30 characters | The first 4,000 characters of the request, once, to make the one-line summary |
| `git`, `code` (VS Code) | Worktrees tab, "Open in VS Code" button | Local commands only |

References that GitHub answers with 404 are hidden.

## Settings

| Option | Default | Meaning |
| --- | --- | --- |
| `githubUser` | empty | gh account used to read issue and PR state (`gh auth token --user <value>`). Empty uses the gh default account |

Set it with `/plugin configure blackbox-mods@blackbox-mods`, or with `--config githubUser=<account>` at install.

## Known limits

- The query detection and the query purpose rule are tuned for one team's database tooling (`run_query.py`, `mysql`). Other tools are not recorded yet.
- Records are kept per session. Sessions do not share them.
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
