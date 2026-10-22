import { expect, mock, test } from 'claude-code/testing'

import type { ActionEntry, QueryRun, SavedRecords, SavedSession, StoredEntry } from '../types'
import { actionOf, collectCommits, shownSources, groupHandled, handledActions, refsFromCommits, repoOfRemote, splitHandled, commitMessageOf, commitsInRun, dedupeCommits, linkCommits, parseCommitLookup, commandText, outputText, answerLine, executedPart, applyAgreements, applyDecisions, ciOf, classifySkill, parseMeta, stateBadge, columnsOf, shortSummary, askAnswers, cdTargetsOf, collectIssues, collectSkillHits, groupByRepo, descriptionOf, matchedPhrases, userWords, refsInGhCommand, refsInText, databaseOf, parseWorktrees, purposeOf, togglePick, pickedIds, addNote, editNote, removeNote, noteRows, noteTitleOf, titleNote, quotedNote, mdField, mdFence, mdInline, sqlOf, tablesOf, plainText, movePage, pageIndex, KEEP_MS, STORE_BUDGET, entryBytes, jsonBytes, keysToDelete, savedRecordsOf, sessionKey, shrinkRecords, purposeGroups, purposeResult } from '../hooks/register'

function watch(on: any) {
  const seen: { runs: QueryRun[]; actions: ActionEntry[] } = { runs: [], actions: [] }
  on('state.set', async ($: unknown, e: any, next: any) => {
    if (e.key === 'runs') seen.runs = e.value
    if (e.key === 'actions') seen.actions = e.value
    return next(e)
  })
  return seen
}

/** 세션 로그의 목적 묶음을 모두 펼친 뒤 다시 그린 패널 */
async function expandLog($: any, surface: string): Promise<string> {
  const render = async () => JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface }))
  for (const match of (await render()).matchAll(/"key":"(purpose-[^"]+)"/g)) {
    await $.ui.press({ plugin: 'blackbox-mods', key: match[1], surface })
  }
  return render()
}

function answerTools(on: any, stdout = '') {
  on('tool.call', async () => ({ result: { stdout, stderr: '', interrupted: false } }) as any)
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as any)
  on('session.cwd', async () => ({ value: '/tmp' }) as any)
}

test('reads the database, the SQL, its tables and its purpose', async () => {
  const command = `python3 run_query.py -D web_mihd "-- 조회 목적: 간격 확인\nSELECT 1 FROM t JOIN web_mihd.app_list l ON 1" --limit 50`
  expect(databaseOf(command)).toBe('web_mihd')
  expect(sqlOf(command)).toBe('-- 조회 목적: 간격 확인\nSELECT 1 FROM t JOIN web_mihd.app_list l ON 1')
  expect(tablesOf(sqlOf(command))).toBe('t, app_list')
  expect(purposeOf(sqlOf(command))).toBe('간격 확인')
  expect(tablesOf('SELECT 1')).toBe('-')
})

test('records a query run with its goal and output', async ($, on) => {
  const seen = watch(on)
  answerTools(on, 'a\tb\n1\t2')
  await ($.tool.call as any)({ tool: 'Bash', description: '카카오톡 조회', command: `python3 run_query.py -D web_mihd "SELECT a, b FROM t"` } as any)
  expect(seen.runs[0]?.goal).toBe('카카오톡 조회')
  expect(seen.runs[0]?.status).toBe('done')
  expect(seen.runs[0]?.output).toBe('a\tb\n1\t2')
})

test('ignores Bash commands that run no query', async ($, on) => {
  const seen = watch(on)
  answerTools(on)
  await ($.tool.call as any)({ tool: 'Bash', command: 'ls' } as any)
  expect(seen.runs).toEqual([])
})

test('finds cd targets and parses worktree lists', async () => {
  expect(cdTargetsOf('cd ~/Documents/Github/mi/dmp.crawler && git status; cd "a b" && ls')).toEqual([
    '~/Documents/Github/mi/dmp.crawler',
    'a b',
  ])
  const porcelain = 'worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/.worktree/x\nHEAD 2\ndetached\n'
  expect(parseWorktrees(porcelain)).toEqual([
    { path: '/r', branch: 'main' },
    { path: '/r/.worktree/x', branch: '(detached)' },
  ])
})

test('attaches the Blackbox rules to each prompt as context', async ($, on) => {
  on('model.complete', async () => ({ value: { isAnswered: true, text: '요약', usage: {} } }) as any)
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', async (_$: unknown, e: any) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context } as any
  })
  await $.prompt.submit({ text: '첫 요청' } as any).catch(() => undefined)
  await $.prompt.submit({ text: '둘째 요청' } as any).catch(() => undefined)
  expect(contexts.length).toBe(2)
  for (const context of contexts) {
    const rules = (context ?? []).join('\n')
    expect(rules).toContain('-- 조회 목적:')
    expect(rules).toContain('description 은 이 명령을 왜 실행하는지')
    expect(rules).toContain('track_decisions 도구로 항목마다 status pending')
    expect(rules).toContain('note_reads 도구로 목적')
    expect(rules).toContain('track_agreements 도구로 status assumed')
    expect(rules).not.toContain('show_plan')
    expect(rules).not.toContain('hypotheses')
  }
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws the log tab and switches to the tree tab on ${surface}`, async ($, on) => {
    answerTools(on, '| a |\n|---|\n| 1 |')
    await ($.tool.call as any)({ tool: 'Bash', description: 'g', command: `python3 run_query.py -D web_mihd "SELECT a FROM t"` } as any)
    const log = await expandLog($, surface)
    expect(log).toContain('SELECT a FROM t')
    expect(log).toContain('▶ 세션 로그')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-tree', surface } as any)
    const treePane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(treePane).toContain('▶ 워크 트리')
    expect(treePane).toContain('refresh-tree')
    expect(treePane).not.toContain('SELECT a FROM t')
  })
}

test('finds issue and PR references in text', async () => {
  const refs = refsInText('see https://github.com/IGAWorksDev/dmp.crawler/issues/40 and IGAWorksDev/dmp.crawler#41, pull https://github.com/a/b/pull/7')
  expect(refs.map(r => `${r.owner}/${r.repo}#${r.number}:${r.isPull ? 'pr' : 'issue'}`)).toEqual([
    'IGAWorksDev/dmp.crawler#40:issue',
    'a/b#7:pr',
    'IGAWorksDev/dmp.crawler#41:issue',
  ])
})

test('reads the repository, number and action of gh commands', async () => {
  expect(refsInGhCommand('GH_TOKEN=$(gh auth token --user x) gh issue view 40 --repo IGAWorksDev/dmp.crawler --comments', '')).toEqual([
    { owner: 'IGAWorksDev', repo: 'dmp.crawler', number: 40, isPull: false, action: 'view' },
  ])
  expect(refsInGhCommand('gh issue create --repo o/r --title t', 'https://github.com/o/r/issues/12')).toEqual([
    { owner: 'o', repo: 'r', number: 12, isPull: false, action: 'create' },
  ])
  expect(refsInGhCommand('gh pr merge https://github.com/o/r/pull/5 --squash', '')[0]?.action).toBe('merge')
})

test('collects issues from the transcript in first-seen order', async () => {
  const list = collectIssues([
    { role: 'user', text: 'https://github.com/IGAWorksDev/dmp.crawler/issues/40 이 패치' },
    {
      role: 'assistant',
      text: '',
      toolUses: [{ tool: 'Bash', input: { command: 'gh issue view 40 --repo IGAWorksDev/dmp.crawler' }, text: 'PR #41 머지 o/r#3' }],
    },
  ])
  expect(list.map(r => r.key)).toEqual(['IGAWorksDev/dmp.crawler#40', 'o/r#3'])
  expect(list[0]?.sources).toEqual(['사용자 프롬프트', 'gh issue view'])
  expect(list[0]?.actions).toEqual(['view'])
  expect(list[0]?.url).toBe('https://github.com/IGAWorksDev/dmp.crawler/issues/40')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws GitHub rows like the app's PR chip on ${surface}`, async ($, on) => {
    on('session.messages', async () => ({
      value: [
        { role: 'user', text: 'https://github.com/o/dmp.crawler/pull/35 와 https://github.com/o/dmp.crawler/issues/9', toolUses: [] },
        {
          role: 'assistant',
          text: '',
          toolUses: [
            { tool: 'Bash', input: { command: "git commit -m 'fix: 9번 수정' -m 'Refs: #9'" }, text: '[fix/9 1a2b3c4] fix: 9번 수정\n 1 file changed' },
            { tool: 'Bash', input: { command: "git commit -m 'docs: 문서 보완'" }, text: '[docs/o-rk-a-rk-reverse-engineering 5d6e7f8] docs: 문서 보완' },
            { tool: 'Bash', input: { command: "git commit -m 'chore: 정리'" }, text: '[main 9a8b7c6] chore: 정리' },
            { tool: 'Bash', input: { command: "git commit -q -m 'fix: 조용히'" }, text: '' },
          ],
        },
      ],
    }) as any)
    on('process.run', async (_$: unknown, e: any) => {
      if (String(e.argv[2] ?? '').includes('rev-parse')) {
        // 출력에 [branch sha] 가 없는 -q 커밋은 제목으로 찾는다. 첫 줄은 커밋한 저장소의 origin
        const sha = e.argv[5] || '7c7c7c7'
        const body = e.argv[6] === 'fix: 조용히' || sha === '1a2b3c4' ? `${e.argv[6]}\n\nRefs: #9` : e.argv[6]
        return { value: { exitCode: 0, stdout: `https://github.com/o/dmp.crawler.git\n${sha}\nmain fix/9 \n${body}\n`, stderr: '' } } as any
      }
      const number = e.argv.at(-1)
      const stdout =
        number === '35'
          ? 'pr\n{"title":"역공학 문서","state":"MERGED","isDraft":false,"headRefName":"docs/o-rk-a-rk-reverse-engineering","additions":4079,"deletions":761,"statusCheckRollup":[]}'
          : 'issue\n{"title":"제목 9","state":"CLOSED","stateReason":"COMPLETED"}'
      return { value: { exitCode: 0, stdout, stderr: '' } } as any
    })
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-issues', surface } as any)
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('▶ Git')
    expect(pane).not.toContain('깃헙')
    expect(pane).toContain('▸ o/dmp.crawler  2건')
    expect(pane).not.toContain('  dmp.crawler  ')
    expect(pane.indexOf('▸ o/dmp.crawler')).toBeLessThan(pane.indexOf('#35'))
    expect(pane).toContain('"children":["1a2b3c4"]')
    expect(pane).toContain(' fix: 9번 수정')
    expect(pane).toContain(' docs: 문서 보완')
    expect(pane.indexOf('#35')).toBeLessThan(pane.indexOf('5d6e7f8'))
    expect(pane.indexOf('5d6e7f8')).toBeLessThan(pane.indexOf('제목 9'))
    expect(pane.indexOf('제목 9')).toBeLessThan(pane.indexOf('1a2b3c4'))
    expect(pane.indexOf('제목 9')).toBeLessThan(pane.indexOf('7c7c7c7'))
    expect(pane.indexOf('7c7c7c7')).toBeLessThan(pane.indexOf('이슈 없는 커밋'))
    expect(pane).toContain('이슈 없는 커밋  1건')
    expect(pane.indexOf('이슈 없는 커밋')).toBeLessThan(pane.indexOf('9a8b7c6'))
    expect(pane).toContain('⎇ 머지됨')
    expect(pane).toContain('#35')
    expect(pane).toContain('https://github.com/o/dmp.crawler/pull/35')
    // PR 도 번호 옆에 제목을 두고, 디프 수치와 CI 는 보이지 않는다
    expect(pane.indexOf('#35')).toBeLessThan(pane.indexOf('역공학 문서'))
    expect(pane).not.toContain('+4,079')
    expect(pane).not.toContain('−761')
    expect(pane).not.toContain('○ CI')
    // 커밋은 브랜치 이름 머리줄 아래에 묶인다
    expect(pane.indexOf('역공학 문서')).toBeLessThan(pane.indexOf('docs/o-rk-a-rk-reverse-engineering'))
    expect(pane.indexOf('docs/o-rk-a-rk-reverse-engineering')).toBeLessThan(pane.indexOf('5d6e7f8'))
    expect(pane.indexOf('제목 9')).toBeLessThan(pane.indexOf('fix/9'))
    expect(pane.indexOf('fix/9')).toBeLessThan(pane.indexOf('1a2b3c4'))
    // 번호는 링크 색으로 보인다
    expect(pane).toContain('"color":"suggestion"')
    expect(pane).toContain('✓ 완료')
    expect(pane).toContain('제목 9')
  })
}

test('groups refs by repository in the order they first appear', async () => {
  const ref = (owner: string, repo: string, number: number) => ({ key: `${owner}/${repo}#${number}`, owner, repo, number, isPull: false, url: '', order: 0, sources: [], actions: [] })
  const groups = groupByRepo([ref('a', 'x', 3), ref('b', 'y', 1), ref('a', 'x', 1), ref('a', 'z', 2)])
  expect(groups.map(g => g.repo)).toEqual(['a/x', 'b/y', 'a/z'])
  expect(groups[0]?.refs.map(r => r.number)).toEqual([3, 1])
  expect(groupByRepo([])).toEqual([])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws one header per repository with its refs under it on ${surface}`, async ($, on) => {
    on('session.messages', async () => ({
      value: [
        {
          role: 'assistant',
          text: '',
          toolUses: ['gh issue comment 3 --repo a/x --body t', 'gh issue close 1 --repo b/y', 'gh issue edit 1 --repo a/x --title t'].map(command => ({ tool: 'Bash', input: { command }, text: '' })),
        },
      ],
    }) as any)
    on('process.run', async (_$: unknown, e: any) => {
      if (e.argv[0] !== 'sh' || String(e.argv[2] ?? '').includes('rev-parse')) return { value: { exitCode: 1, stdout: '', stderr: '' } } as any
      const [owner, repo, number] = e.argv.slice(-3)
      return { value: { exitCode: 0, stdout: `issue\n{"title":"제목 ${owner}/${repo}#${number}","state":"OPEN","stateReason":""}`, stderr: '' } } as any
    })
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-issues', surface } as any)
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    const at = (text: string) => pane.indexOf(text)
    expect(pane).toContain('▸ a/x  2건')
    expect(pane).toContain('▸ b/y  1건')
    expect(at('▸ a/x')).toBeLessThan(at('제목 a/x#3'))
    expect(at('제목 a/x#3')).toBeLessThan(at('제목 a/x#1'))
    expect(at('제목 a/x#1')).toBeLessThan(at('▸ b/y'))
    expect(at('▸ b/y')).toBeLessThan(at('제목 b/y#1'))
    // 참고 항목이 없으면 구분선도 없다
    expect(pane).not.toContain('─────')
    expect(pane).toContain('3건')
  })
}

test('reads the commit message from -m and heredoc, not from other commands on the line', async () => {
  const heredoc = "git add -A && git commit -q -F - <<'EOF'\nfeat(x): 기능\n\n본문에 # 문자\n\nRefs: #10\nEOF\ngit log --oneline -1"
  expect(commitMessageOf(heredoc)).toBe('feat(x): 기능\n\n본문에 # 문자\n\nRefs: #10')
  expect(commitMessageOf(`git commit -m "a \\"q\\"" -m 'Refs: #3'`)).toBe('a "q"\n\nRefs: #3')
  expect(commitMessageOf('git commit --message=one && gh pr create --body "Closes #12"')).toBe('one')
  expect(commitMessageOf('git commit -m "a" && gh pr create --body "Closes #12"')).toBe('a')
})

test('reads commits that a Bash call made, with the numbers in the message', async () => {
  const heredoc = "git add -A && git commit -F - <<'EOF'\nfeat(x): 기능\n\nRefs: #10\nEOF"
  expect(commitsInRun(heredoc, '[feat/10-x 041d59b] feat(x): 기능', 3)).toEqual([
    { sha: '041d59b', branch: 'feat/10-x', subject: 'feat(x): 기능', refs: [10], order: 3, command: heredoc },
  ])
  expect(commitsInRun('git commit -m "init"', '[main (root-commit) abc1234] init', 0)[0]).toMatchObject({ sha: 'abc1234', branch: 'main', refs: [] })
  expect(commitsInRun('git -C /r commit -m "a #3"', '[b 1111111] a #3', 0)[0]?.refs).toEqual([3])
  expect(commitsInRun('git commit -m "a" && gh pr create --body "Closes #12"', '[b 1111111] a', 0)[0]?.refs).toEqual([])
  expect(commitsInRun('echo "git commit"', '[b 1111111] a', 0)).toEqual([])
  expect(commitsInRun('git log --oneline', '[b 1111111] a', 0)).toEqual([])
})

test('keeps a quiet commit by its subject so git can find its SHA', async () => {
  const quiet = "git commit -q -F - <<'EOF'\nfix: 조용한 커밋\n\nRefs: #11\nEOF\ngit log --oneline -1"
  expect(commitsInRun(quiet, 'abc1234 fix: 조용한 커밋', 0)).toEqual([{ sha: '', branch: '', subject: 'fix: 조용한 커밋', refs: [11], order: 0, command: quiet }])
  expect(parseCommitLookup('git@github.com:o/r.git\nabc1234\nmain feat/11-x \nfix: 조용한 커밋\n\nRefs: #11\n', '')).toEqual({ sha: 'abc1234', branch: 'feat/11-x', repo: 'o/r', refs: [11] })
  expect(parseCommitLookup('\nabc1234\nmain \nx\n', 'b')).toEqual({ sha: 'abc1234', branch: 'b', repo: '', refs: [] })
  expect(parseCommitLookup('fatal: not a git repository', '')).toBe(undefined)
})

test('keeps the last commit when amend repeats the subject on a branch', async () => {
  const one = (sha: string, branch: string) => ({ sha, branch, subject: 'same', refs: [], order: 0 })
  expect(dedupeCommits([one('1111111', 'b'), one('2222222', 'b'), one('3333333', 'c'), one('3333333', 'c')]).map(c => c.sha)).toEqual(['2222222', '3333333'])
  expect(collectCommits([{ role: 'assistant', text: '', toolUses: [{ tool: 'Bash', input: { command: 'git commit --amend --no-edit' }, text: '[b 1111111] same' }] }]).length).toBe(1)
})

test('links commits by number first, then by the PR head branch', async () => {
  const ref = (number: number, isPull: boolean) => ({ key: `o/r#${number}`, owner: 'o', repo: 'r', number, isPull, url: '', order: 0, sources: [], actions: [] })
  const metas = { 'o/r#12': { title: '', state: 'open', isPull: true, stateReason: '', isDraft: false, branch: 'feat/10-x', additions: 0, deletions: 0, ci: 'none' as const } }
  const one = (sha: string, branch: string, refs: number[], repo = 'o/r') => ({ sha, branch, repo, subject: sha, refs, order: 0 })
  const linked = linkCommits(
    [one('a', 'feat/10-x', [10]), one('b', 'feat/10-x', []), one('c', 'other', [99]), one('d', 'x', [10], 'p/q'), one('e', 'feat/10-x', [10], '')],
    [ref(10, false), ref(12, true)],
    metas,
  )
  expect(linked.byKey['o/r#10']?.map(c => c.sha)).toEqual(['a'])
  expect(linked.byKey['o/r#12']?.map(c => c.sha)).toEqual(['b'])
  // 다른 저장소의 같은 번호, 저장소를 모르는 커밋은 잇지 않는다
  expect(linked.unlinked.map(c => c.sha)).toEqual(['c', 'd', 'e'])
})

test('reads the GitHub repository from a git remote URL', async () => {
  expect(repoOfRemote('https://github.com/insung/blackbox-mods.git')).toBe('insung/blackbox-mods')
  expect(repoOfRemote('git@github.com:o/r.git\n')).toBe('o/r')
  expect(repoOfRemote('https://github.com/o/dmp.crawler')).toBe('o/dmp.crawler')
  expect(repoOfRemote('https://gitlab.com/o/r.git')).toBe('')
  expect(repoOfRemote('')).toBe('')
})

test('splits refs this session handled from refs it only mentioned', async () => {
  const list = collectIssues([
    { role: 'user', text: 'o/r#1 참고해서' },
    { role: 'assistant', text: 'o/r#2 를 봤다', toolUses: [
      { tool: 'Bash', input: { command: 'gh issue view 3 --repo o/r' }, text: 'see https://github.com/o/r/issues/4' },
      { tool: 'Bash', input: { command: 'gh issue create --repo o/r --title t' }, text: 'https://github.com/o/r/issues/5' },
      { tool: 'Bash', input: { command: 'gh pr merge 6 --repo o/r --squash' }, text: '' },
      { tool: 'Bash', input: { command: 'gh issue view 7 --repo o/r' }, text: '' },
    ] },
  ])
  const commit = { sha: 'abc1234', branch: 'b', repo: 'o/r', subject: 's', refs: [7, 8], order: 1 }
  const all = [...list, ...refsFromCommits([commit], list)]
  expect(all.map(r => r.key)).toEqual(['o/r#1', 'o/r#2', 'o/r#3', 'o/r#4', 'o/r#5', 'o/r#6', 'o/r#7', 'o/r#8'])
  expect(all.find(r => r.number === 8)?.sources).toEqual(['커밋'])
  expect(refsFromCommits([{ ...commit, repo: '' }], list)).toEqual([])
  const { handled, consulted } = splitHandled(all, { 'o/r#7': [commit] })
  expect(handled.map(r => r.number)).toEqual([5, 6, 7, 8])
  expect(consulted.map(r => r.number)).toEqual([1, 2, 3, 4])
  expect(handledActions(all[4]!, 0)).toEqual(['생성'])
  expect(handledActions(all[5]!, 0)).toEqual(['머지'])
  expect(handledActions(all[6]!, 1)).toEqual(['커밋'])
  expect(handledActions(all[2]!, 0)).toEqual([])
  expect(all[2]?.sources).toEqual(['gh issue view'])
})

test('shows only prompt and answer sources for referenced refs', async () => {
  expect(shownSources(['사용자 프롬프트', 'gh issue list', 'gh pr view', '명령 결과', 'Claude 답변'])).toEqual(['사용자 프롬프트', 'Claude 답변'])
  expect(shownSources(['gh issue view'])).toEqual([])
})

test('groups handled refs and commits without an issue by repository, unknown repository last', async () => {
  const ref = (owner: string, repo: string, number: number, order: number) => ({ key: `${owner}/${repo}#${number}`, owner, repo, number, isPull: false, url: '', order, sources: [], actions: ['create'] })
  const commit = (sha: string, repo: string | undefined, order: number) => ({ sha, branch: 'b', repo, subject: sha, refs: [], order })
  const groups = groupHandled([ref('a', 'x', 1, 2), ref('b', 'y', 1, 3)], [commit('c1', 'b/y', 1), commit('c2', '', 0), commit('c3', undefined, 4), commit('c4', 'c/z', 5)])
  expect(groups.map(g => [g.repo, g.refs.map(r => r.key), g.commits.map(c => c.sha)])).toEqual([
    ['b/y', ['b/y#1'], ['c1']],
    ['a/x', ['a/x#1'], []],
    ['c/z', [], ['c4']],
    ['', [], ['c2', 'c3']],
  ])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`puts mentioned refs under 참고한 이슈·PR at the bottom on ${surface}`, async ($, on) => {
    on('session.messages', async () => ({
      value: [
        { role: 'user', text: 'o/r#28 참고', toolUses: [] },
        {
          role: 'assistant',
          text: '',
          toolUses: [
            { tool: 'Bash', input: { command: 'gh issue create --repo o/r --title t' }, text: 'https://github.com/o/r/issues/29' },
            { tool: 'Bash', input: { command: 'gh pr view 27 --repo p/q' }, text: '' },
            { tool: 'Bash', input: { command: "git commit -m 'chore: 정리'" }, text: '[main 9a8b7c6] chore: 정리' },
            { tool: 'Bash', input: { command: "git commit -m 'docs: 문서'" }, text: '[main 1b1b1b1] docs: 문서' },
          ],
        },
      ],
    }) as any)
    on('process.run', async (_$: unknown, e: any) => {
      if (String(e.argv[2] ?? '').includes('rev-parse')) {
        // 1b1b1b1 커밋을 한 폴더만 origin 이 있다
        const origin = e.argv[5] === '1b1b1b1' ? 'https://github.com/w/z.git' : ''
        return { value: { exitCode: 0, stdout: `${origin}\n${e.argv[5]}\nmain \n${e.argv[6]}\n`, stderr: '' } } as any
      }
      const [owner, repo, number] = e.argv.slice(-3)
      return { value: { exitCode: 0, stdout: `issue\n{"title":"제목 ${owner}/${repo}#${number}","state":"OPEN","stateReason":""}`, stderr: '' } } as any
    })
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-issues', surface } as any)
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    const at = (text: string) => pane.indexOf(text)
    expect(pane).toContain('처리 1건 · 참고 2건')
    expect(pane).toContain('▸ o/r  1건')
    // 처리 줄에는 동작 이름을 보이지 않는다
    expect(pane).not.toContain('생성')
    expect(pane).toContain('▸ 저장소 모름')
    // 커밋만 있는 저장소는 머리줄에 건수를 붙이지 않는다
    expect(pane).toContain('"▸ w/z"')
    expect(pane).not.toContain('▸ w/z  0건')
    expect(at('▸ w/z')).toBeLessThan(at('1b1b1b1'))
    expect(at('1b1b1b1')).toBeLessThan(at('▸ 저장소 모름'))
    expect(at('제목 o/r#29')).toBeLessThan(at('▸ 저장소 모름'))
    expect(at('▸ 저장소 모름')).toBeLessThan(at('9a8b7c6'))
    expect(at('9a8b7c6')).toBeLessThan(at('참고한 이슈·PR  2건'))
    expect(at('참고한 이슈·PR')).toBeLessThan(at('제목 o/r#28'))
    expect(at('참고한 이슈·PR')).toBeLessThan(at('제목 p/q#27'))
    // 참고 줄에는 출처(사용자 프롬프트·Claude 답변), gh 명령 이름, 명령 결과를 보이지 않는다
    expect(pane).not.toContain('사용자 프롬프트')
    expect(pane).not.toContain('gh pr view')
    expect(pane).not.toContain('명령 결과')
    // 참고 머리줄 위에 가로 구분선을 두지 않는다 (좁은 창에서 다음 줄로 넘어간다)
    expect(pane).not.toContain('─────')
    expect(pane).not.toContain('이 세션에서 처리한 GitHub 이슈·PR 과 커밋이 없다.')
  })
}

test('finds skill runs and why they ran', async () => {
  const hits = collectSkillHits([
    { role: 'user', text: '<system-reminder>x</system-reminder>카카오톡 DB에서 확인해줘' },
    {
      role: 'assistant',
      text: 'DB 조회가 필요하다.',
      toolUses: [{ tool: 'Skill', input: { skill: 'mi-data-access', args: '카카오톡 조회' }, text: 'Launching skill\nBase directory for this skill: /s/mi-data-access' }],
    },
    { role: 'user', text: '<command-name>/plugin-authoring</command-name><command-args>패널</command-args>' },
  ])
  expect(hits.map(h => [h.turn, h.skill, h.trigger])).toEqual([
    [1, 'mi-data-access', 'model'],
    [2, 'plugin-authoring', 'slash'],
  ])
  expect(hits[0]?.prompt).toBe('카카오톡 DB에서 확인해줘')
  expect(hits[0]?.baseDir).toBe('/s/mi-data-access')
  expect(hits[0]?.claudeNote).toBe('DB 조회가 필요하다.')
})

test('reads a skill description and the phrases the request matched', async () => {
  const md = '---\nname: x\ndescription: 읽기 쿼리를 실행할 때 쓴다. "이 쿼리 돌려줘", "DB에서 확인해줘" 같은 요청\n---\nbody'
  const description = descriptionOf(md)
  expect(description.startsWith('읽기 쿼리')).toBe(true)
  expect(matchedPhrases(description, '카카오톡 DB 에서 확인해줘')).toEqual(['DB에서 확인해줘'])
  expect(descriptionOf('---\nname: y\ndescription: |\n  첫 줄\n  둘째 줄\n---')).toBe('첫 줄 둘째 줄')
  expect(descriptionOf("---\ndescription: 'quoted whole'\n---")).toBe('quoted whole')
  expect(userWords('<system-reminder>a</system-reminder> 진행해')).toBe('진행해')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws skill hit rates grouped by plugin and custom on ${surface}`, async ($, on) => {
    const use = (skill: string, dir: string) => ({ tool_use_id: skill, tool: 'Skill', input: { skill }, text: dir ? `Base directory for this skill: ${dir}` : '' })
    on('session.messages', async () => ({
      value: [
        { role: 'user', text: '이 쿼리 돌려줘', toolUses: [] },
        { role: 'assistant', text: '', toolUses: [use('mi-data-access', '/h/.claude/skills/mi-data-access')] },
        { role: 'user', text: '이 내용을 이슈로 만들어줘', toolUses: [] },
        { role: 'assistant', text: '', toolUses: [use('git-workflow:issue-create', '/p/git-workflow/skills/issue-create'), use('git-workflow:issue-create', ''), use('git-workflow:pr-request', '')] },
      ],
    }) as any)
    on('fs.read', async () => ({ value: '---\ndescription: "이 쿼리 돌려줘" 같은 요청\n---' }) as any)
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as any)
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    on('session.root', async () => ({ value: '/tmp' }) as any)
    await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-skills', surface } as any)
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('▶ 스킬 사용량')
    expect(pane).toContain('플러그인 git-workflow  3회 · 75%')
    expect(pane).toContain('1. issue-create  2회 · 50%')
    expect(pane).toContain('2. pr-request  1회 · 25%')
    expect(pane).toContain('커스텀 스킬  1회 · 25%')
    expect(pane).toContain('「이 내용을 이슈로 만들어줘」')
    expect(pane.indexOf('git-workflow')).toBeLessThan(pane.indexOf('커스텀 스킬'))
  })
}

test('registers pending decisions and closes them with the user quote', async () => {
  const first = applyDecisions([], [{ question: '이름을 정한다', options: ['work-log', 'blackbox-mods'], recommended: 'work-log', status: 'pending' }], {
    t: 1, at: '10:00', turn: 1, userQuote: '이전 요청', source: 'tool',
  })
  expect(first.ids).toEqual(['d1'])
  expect(first.list[0]?.userQuote).toBe('')
  const second = applyDecisions(first.list, [{ id: 'd1', status: 'decided', answer: 'blackbox-mods 로 정함' }, { question: '설치', status: 'pending' }], {
    t: 2, at: '10:05', turn: 2, userQuote: 'blackbox-mods 로 해줘', source: 'tool',
  })
  expect(second.ids).toEqual(['d1', 'd2'])
  expect(second.list[0]).toMatchObject({ status: 'decided', answer: 'blackbox-mods 로 정함', userQuote: 'blackbox-mods 로 해줘', decidedAt: '10:05', at: '10:00' })
  expect(second.list[1]?.status).toBe('pending')
})

test('reads AskUserQuestion answers from the result or its text', async () => {
  expect(askAnswers({ answers: { 'Q?': 'A' } }, '')).toEqual({ 'Q?': 'A' })
  expect(askAnswers({ answers: {} }, 'Your questions have been answered: "어떤 이름?"="blackbox-mods".')).toEqual({ '어떤 이름?': 'blackbox-mods' })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`shows pending decisions and how they were decided on ${surface}`, async ($, on) => {
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as any)
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    on('model.complete', async () => ({ value: { isAnswered: true, text: '결정 기록 방식 정하기', usage: {} } }) as any)
    on('prompt.submit', async (_$: unknown, e: any) => ({ text: e.text }) as any)
    await $.prompt.submit({ text: '결정 사항을 별도 탭으로 보여 줘' } as any).catch(() => undefined)
    await ($.tool.call as any)({
      tool: 'mcp__blackbox-mods__track_decisions',
      items: [
        { question: '도구로 결정 대기 항목을 등록할지', recommended: '등록', status: 'pending', decidedBy: 'user' },
        { question: '사용자 답변 원문을 자동으로 붙인다', status: 'decided', decidedBy: 'claude' },
      ],
    } as any)
    let pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('▶ 결정 사항 (1)')
    expect(pane).toContain('## 결정 사항을 별도 탭으로 보여 줘')
    expect(pane).not.toContain('── 결정 사항을 별도 탭으로 보여 줘')
    expect(pane).toContain('[ ] d1. 도구로 결정 대기 항목을 등록할지')
    expect(pane).toContain('[x] d2. 사용자 답변 원문을 자동으로 붙인다  (Claude 가 정함)')
    await $.prompt.submit({ text: '등록하지마.' } as any).catch(() => undefined)
    await ($.tool.call as any)({
      tool: 'mcp__blackbox-mods__track_decisions',
      items: [{ id: 'd1', status: 'decided', answer: '등록 안 함' }, { question: '다음 요청의 결정', status: 'pending', decidedBy: 'user' }],
    } as any)
    pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('[x] d1. 도구로 결정 대기 항목을 등록할지 => 등록 안 함')
    expect(pane).toContain('[ ] d3. 다음 요청의 결정')
    expect(pane).toContain('-> 등록하지마.')
    expect(pane.match(/도구로 결정 대기 항목을 등록할지/g)?.length).toBe(1)
    expect(pane).toContain('결정 대기 1건')
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`shows only worktrees this session changed, with the changed files, on ${surface}`, async ($, on) => {
    const runs: string[][] = []
    on('session.cwd', async () => ({ value: '/r' }) as any)
    on('session.messages', async () => ({ value: [] }) as any)
    on('ui.toast', async () => ({ value: undefined }) as any)
    on('tool.call', async () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as any)
    on('process.run', async (_$: unknown, e: any) => {
      runs.push(e.argv)
      const argv: string[] = e.argv
      // 폴더를 실제 경로로 바꾸는 sh 는 받은 폴더를 그대로 돌려준다
      if (argv[0] === 'sh' && String(argv[2]).includes('pwd -P')) return { value: { exitCode: 0, stdout: `${argv[4]}\n`, stderr: '' } } as any
      if (argv[0] === 'git' && argv.includes('worktree')) {
        if (!String(argv[2]).startsWith('/r')) return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } } as any
        return {
          value: {
            exitCode: 0,
            stdout: 'worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/.worktree/x\nHEAD 2\nbranch refs/heads/x\n\nworktree /r/.worktree/y\nHEAD 3\nbranch refs/heads/y\n',
            stderr: '',
          },
        } as any
      }
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
    })
    await ($.tool.call as any)({ tool: 'Write', file_path: '/r/.worktree/x/src/a.ts', content: '' } as any)
    await ($.tool.call as any)({ tool: 'Edit', file_path: '/r/README.md', old_string: 'a', new_string: 'b' } as any)
    await ($.tool.call as any)({ tool: 'Edit', file_path: '/r/.worktree/x/src/a.ts', old_string: 'a', new_string: 'b' } as any)
    await ($.tool.call as any)({ tool: 'Read', file_path: '/s/notes.md' } as any)
    await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-tree', surface } as any)
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    const at = (text: string) => pane.indexOf(text)
    // 바꾼 워크트리만 처음 바꾼 순서로 보이고, 손대지 않은 워크트리와 읽기만 한 곳은 보이지 않는다
    expect(pane).toContain('⎇ x')
    expect(pane).toContain('⎇ main')
    expect(pane).not.toContain('⎇ y')
    expect(pane).not.toContain('/s')
    expect(at('⎇ x')).toBeLessThan(at('⎇ main'))
    expect(pane).toContain('  [.worktree/x]  ')
    expect(pane).toContain('  [.]  ')
    expect(pane.match(/src\/a\.ts/g)?.length).toBe(1)
    expect(at('⎇ x')).toBeLessThan(at('src/a.ts'))
    expect(at('⎇ main')).toBeLessThan(at('README.md'))
    expect(pane).not.toContain('작업 디렉토리')
    expect(pane).not.toContain('사용 중')
    expect(pane).toContain('open-/r/.worktree/x')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'open-/r', surface } as any)
    const opened = runs.find(argv => argv[0] === 'sh' && String(argv[2]).includes('code'))
    expect(opened?.at(-1)).toBe('/r')
  })

  test(`says no worktree was changed before any edit on ${surface}`, async ($, on) => {
    on('session.cwd', async () => ({ value: '/r' }) as any)
    on('session.messages', async () => ({ value: [] }) as any)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: 'worktree /r\nHEAD 1\nbranch refs/heads/main\n', stderr: '' } }) as any)
    await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-tree', surface } as any)
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('이 세션에서 파일을 바꾼 워크트리가 없다.')
    expect(pane).not.toContain('open-/r')
  })
}

test('classifies skills by plugin name and folder', async () => {
  expect(classifySkill('git-workflow:issue-create', '')).toEqual({ group: 'plugin', plugin: 'git-workflow' })
  expect(classifySkill('find-skills', '/Users/b/.agents/skills/find-skills')).toEqual({ group: 'custom', plugin: '' })
  expect(classifySkill('mi-data-access', '/Users/b/Documents/Github/mi/.claude/skills/mi-data-access')).toEqual({ group: 'custom', plugin: '' })
  expect(classifySkill('plugin-authoring', '/private/tmp/bundled-skills/x/plugin-authoring')).toEqual({ group: 'builtin', plugin: '' })
})

test('counts columns and short summaries', async () => {
  expect(columnsOf('가a')).toBe(3)
  expect(shortSummary('짧은 요청')).toBe('짧은 요청')
  expect(shortSummary('가'.repeat(40)).endsWith('…')).toBe(true)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`logs a query and read files under the request summary on ${surface}`, async ($, on) => {
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as any)
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    on('model.complete', async () => ({ value: { isAnswered: true, text: '카카오톡 DAU 조회', usage: {} } }) as any)
    on('prompt.submit', async (_$: unknown, e: any) => ({ text: e.text }) as any)
    on('tool.call', async () => ({ result: { stdout: '| a |\n|---|\n| 1 |', stderr: '', interrupted: false } }) as any)
    await $.prompt.submit({ text: '카카오톡 일간 사용자수를 날짜별, OS 별로 조회해서 알려줘. 영향이 있는지 확인하고 싶어.' } as any).catch(() => undefined)
    await ($.tool.call as any)({ tool: 'Bash', description: 'g', command: `python3 run_query.py -D web_mihd "-- 조회 목적: 날짜별 OS별 사용자수\nSELECT a FROM t"` } as any)
    await ($.tool.call as any)({ tool: 'Read', file_path: '/Users/b/mi/.worktree/x/README.md' } as any)
    await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__note_reads', purpose: '배치 문서 확인', result: '기준일이 -2일로 바뀌었다' } as any)
    await ($.tool.call as any)({ tool: 'Bash', description: '배치 폴더 확인', command: 'ls batch' } as any)
    await ($.tool.call as any)({ tool: 'Edit', file_path: '/Users/b/mi/a.py', old_string: 'x', new_string: 'y' } as any)
    // 접힌 상태: 목적 머리줄과 ⇒ 결과만 보인다
    const folded = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(folded).toContain('{"type":"Markdown","props":{"text":"## 카카오톡 DAU 조회"}}')
    expect(folded.match(/"\[[^"\]]+\]"/g)?.length).toBe(1)
    expect(folded).toContain('▸ 날짜별 OS별 사용자수')
    expect(folded).toContain('▸ 배치 문서 확인')
    expect(folded).toContain('  ⇒ 기준일이 -2일로 바뀌었다')
    expect(folded).toContain('▸ 배치 폴더 확인')
    expect(folded).toContain('  ⇒ 실행 1건 모두 성공')
    expect(folded).not.toContain('ls batch')
    expect(folded).not.toContain('건수')
    expect(folded).not.toContain('▌')
    // 펼친 상태: 목적은 머리줄에만 있고, 기록은 공백으로 들여쓴다
    const pane = await expandLog($, surface)
    expect(pane).toContain('▾ 배치 폴더 확인')
    expect(pane).toContain('"paddingLeft":4')
    expect(pane).not.toContain('- **목적:**')
    expect(pane).toContain('- **실행:**\\n  ```bash\\n  ls batch\\n  ```\\n- **결과:**\\n  ```text\\n  | a |\\n  |---|\\n  | 1 |\\n  ```')
    expect(pane).toContain('- **수정:** /Users/b/mi/a.py')
    expect(pane.indexOf('▾ 배치 폴더 확인')).toBeLessThan(pane.indexOf('/Users/b/mi/a.py'))
    expect(pane).not.toContain('run_query.py')
    expect(pane).toContain('- **대상:** DB web\\\\_mihd · 테이블 t\\n- **실행:**\\n  ```sql')
    expect(pane).toContain('SELECT a FROM t')
    expect(pane).toContain('- **읽은 파일:**\\n  - /Users/b/mi/.worktree/x/README.md\\n- **결과:** 기준일이 -2일로 바뀌었다')
    expect(pane).not.toContain('결정 대기')
    // 다시 누르면 접힌다
    await $.ui.press({ plugin: 'blackbox-mods', key: 'purpose-turn-1-2', surface } as any)
    expect(JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))).not.toContain('ls batch')
  })
}

test('reads PR and issue state, diff and CI', async () => {
  const pr = parseMeta('pr\n{"title":"t","state":"OPEN","isDraft":false,"headRefName":"b","additions":1,"deletions":2,"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS"}]}')
  expect(pr).toMatchObject({ isPull: true, state: 'open', branch: 'b', additions: 1, deletions: 2, ci: 'pass' })
  expect(stateBadge(pr, true).text).toBe('⎇ 열림')
  expect(ciOf([{ status: 'IN_PROGRESS' }])).toBe('pending')
  expect(ciOf([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe('fail')
  expect(ciOf([])).toBe('none')
  expect(stateBadge(parseMeta('pr\n{"state":"MERGED"}'), true).text).toBe('⎇ 머지됨')
  expect(stateBadge(parseMeta('pr\n{"state":"OPEN","isDraft":true}'), true).text).toBe('⎇ 초안')
  expect(stateBadge(parseMeta('issue\n{"state":"OPEN","stateReason":"REOPENED"}'), false).text).toBe('◉ 열림')
  expect(stateBadge(parseMeta('issue\n{"state":"CLOSED","stateReason":"NOT_PLANNED"}'), false).text).toBe('⊘ 닫힘')
})

test('reads only gh commands the shell runs, not text inside heredocs or quotes', async () => {
  const command = "cat > t.ts <<'EOF'\nrefsInGhCommand('gh issue create --repo o/r --title t', '')\nEOF\necho 'gh pr merge https://github.com/o/r/pull/5'"
  expect(executedPart(command)).not.toContain('o/r')
  expect(refsInGhCommand(command, 'https://github.com/o/r/issues/12')).toEqual([])
  expect(refsInGhCommand("gh issue view 40 --repo IGAWorksDev/dmp.crawler --json title --jq '.title'", '')[0]?.number).toBe(40)
})

test('scans results only of Bash calls that ran gh', async () => {
  const list = collectIssues([
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool: 'Read', input: { file_path: '/x/test.ts' }, text: 'https://github.com/o/r/issues/9' },
        { tool: 'Bash', input: { command: 'cat test.ts' }, text: 'https://github.com/o/r/issues/7' },
        { tool: 'Bash', input: { command: 'gh issue create --repo a/b --title t' }, text: 'https://github.com/a/b/issues/3' },
      ],
    },
  ])
  expect(list.map(r => r.key)).toEqual(['a/b#3'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`hides refs GitHub does not know on ${surface}`, async ($, on) => {
    on('session.messages', async () => ({
      value: [{ role: 'user', text: 'https://github.com/a/b/issues/1 와 https://github.com/o/r/issues/12', toolUses: [] }],
    }) as any)
    on('process.run', async (_$: unknown, e: any) => {
      const isMissing = e.argv.includes('o')
      return {
        value: isMissing
          ? { exitCode: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }
          : { exitCode: 0, stdout: 'issue\n{"title":"있는 이슈","state":"OPEN","stateReason":""}', stderr: '' },
      } as any
    })
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-issues', surface } as any)
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('있는 이슈')
    expect(pane).toContain('1건')
    expect(pane).not.toContain('#12')
  })
}

test('builds the answer line for a picked option', async () => {
  expect(answerLine('d2', '프롬프트 창에 채우기', '')).toBe('d2: 프롬프트 창에 채우기')
  expect(answerLine('d2', 'A', '그리고 이것도  \n')).toBe('그리고 이것도\nd2: A')
  expect(answerLine('a1, a3', '맞음', '')).toBe('a1, a3: 맞음')
})

test('toggles picked agreements and keeps only the ones still waiting, in list order', async () => {
  expect(togglePick([], 'a1')).toEqual(['a1'])
  expect(togglePick(['a1', 'a3'], 'a1')).toEqual(['a3'])
  const list = [
    { id: 'a1', status: 'assumed' },
    { id: 'a2', status: 'confirmed' },
    { id: 'a3', status: 'assumed' },
  ] as any
  expect(pickedIds(['a3', 'a2', 'a1', 'a9'], list)).toEqual(['a1', 'a3'])
})

test('writes markdown list fields and fenced blocks that survive backticks', async () => {
  expect(mdField('목적', '소스 *위치* 찾기')).toBe('- **목적:** 소스 \\*위치\\* 찾기')
  expect(mdFence('echo `a`', 'bash')).toBe('  ```bash\n  echo `a`\n  ```')
  expect(mdFence('x ``` y', 'text')).toBe('  ````text\n  x ``` y\n  ````')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`fills the prompt box when an option is pressed on ${surface}`, async ($, on) => {
    const fills: string[] = []
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as any)
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }) as any)
    on('prompt.fill', async (_$: unknown, e: any) => {
      fills.push(e.text)
      return { isFilled: true } as any
    })
    await ($.tool.call as any)({
      tool: 'mcp__blackbox-mods__track_decisions',
      items: [{ question: '답 방식', options: ['채우기', '바로 보내기'], recommended: '채우기', status: 'pending', decidedBy: 'user' }],
    })
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('채우기 (권장)')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'pick-d1-1', surface } as any)
    expect(fills).toEqual(['d1: 바로 보내기'])
  })
}

test('moves between request pages and follows the latest at the end', async () => {
  const keys = ['turn-1', 'turn-2', 'turn-3']
  expect(pageIndex(keys, '')).toBe(2)
  expect(pageIndex(keys, 'turn-1')).toBe(0)
  expect(pageIndex(keys, 'gone')).toBe(2)
  expect(pageIndex([], '')).toBe(0)
  expect(movePage(keys, '', -1)).toBe('turn-2')
  expect(movePage(keys, 'turn-1', -1)).toBe('turn-1')
  expect(movePage(keys, 'turn-2', 1)).toBe('')
  expect(movePage(keys, '', 1)).toBe('')
  expect(movePage([], '', 1)).toBe('')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pages the session log one request at a time on ${surface}`, async ($, on) => {
    answerTools(on)
    on('model.complete', async () => ({ value: { isAnswered: false, text: '', usage: {} } }) as any)
    on('prompt.submit', async (_$: unknown, e: any) => ({ text: e.text }) as any)
    const render = async () => JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    await $.prompt.submit({ text: '첫 요청' } as any).catch(() => undefined)
    await ($.tool.call as any)({ tool: 'Bash', description: '첫 명령', command: 'ls one' } as any)
    await $.prompt.submit({ text: '둘째 요청' } as any).catch(() => undefined)
    await ($.tool.call as any)({ tool: 'Bash', description: '둘째 명령', command: 'ls two' } as any)
    // 목적 묶음은 접혀 있어 머리줄의 목적으로 요청 묶음을 가린다
    let pane = await render()
    expect(pane).toContain('  2 / 2  ')
    expect(pane).toContain('▸ 둘째 명령')
    expect(pane).not.toContain('첫 명령')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'log-prev', surface } as any)
    pane = await render()
    expect(pane).toContain('  1 / 2  ')
    expect(pane).toContain('▸ 첫 명령')
    expect(pane).not.toContain('둘째 명령')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'log-prev', surface } as any)
    expect(await render()).toContain('  1 / 2  ')
    await $.prompt.submit({ text: '셋째 요청' } as any).catch(() => undefined)
    await ($.tool.call as any)({ tool: 'Bash', description: '셋째 명령', command: 'ls three' } as any)
    pane = await render()
    expect(pane).toContain('  1 / 3  ')
    expect(pane).toContain('첫 명령')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'log-next', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'log-next', surface } as any)
    expect(await render()).toContain('셋째 명령')
    await $.prompt.submit({ text: '넷째 요청' } as any).catch(() => undefined)
    await ($.tool.call as any)({ tool: 'Bash', description: '넷째 명령', command: 'ls four' } as any)
    pane = await render()
    expect(pane).toContain('  4 / 4  ')
    expect(pane).toContain('넷째 명령')
  })
}

test('removes control characters that a surface cannot draw', async () => {
  expect(plainText('\x1b[31mred\x1b[0m ok')).toBe('red ok')
  expect(plainText('a\r\nb')).toBe('a\nb')
  expect(plainText('10%\r50%\r100%\ndone')).toBe('100%\ndone')
  expect(plainText('\x1b]8;;https://x\x07link\x1b]8;;\x07 bell\x07')).toBe('link bell')
  expect(plainText('tab\tkept')).toBe('tab\tkept')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws the log when a command prints colors on ${surface}`, async ($, on) => {
    on('tool.call', async () => ({ result: { stdout: '\x1b[31mred\x1b[0m\r\nok\x07', stderr: '', interrupted: false } }) as any)
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as any)
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    await ($.tool.call as any)({ tool: 'Bash', description: '색 출력', command: 'ls --color' } as any)
    const pane = await expandLog($, surface)
    expect(pane).toContain('▾ 색 출력')
    expect(pane).toContain('- **결과:**\\n  ```text\\n  red\\n  ok\\n  ```')
  })
}

test('groups records by purpose, putting records without one under the purpose before them', async () => {
  const groups = purposeGroups(['', 'a', '', 'a', 'b', '', 'c'], one => one, '요청 요약')
  expect(groups.map(g => [g.purpose, g.items.length])).toEqual([['요청 요약', 1], ['a', 3], ['b', 2], ['c', 1]])
  expect(purposeGroups([], one => String(one), 'x')).toEqual([])
})

test('sums a purpose result from read conclusions, else from command status', async () => {
  expect(purposeResult([{ kind: 'command', status: 'done' }, { kind: 'read', result: '결론' }]).text).toBe('결론')
  expect(purposeResult([{ kind: 'command', status: 'done' }, { kind: 'run', status: 'done' }, { kind: 'file', status: 'done' }])).toEqual({ text: '실행 2건 모두 성공', color: 'success' })
  expect(purposeResult([{ kind: 'command', status: 'done' }, { kind: 'command', status: 'denied' }])).toEqual({ text: '실행 2건 중 1건 실패', color: 'error' })
  expect(purposeResult([{ kind: 'file', status: 'done' }]).text).toBe('파일 1개 작성·수정')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`puts a sub-agent's records under its Agent description on ${surface}`, async ($, on) => {
    answerTools(on)
    on('model.complete', async () => ({ value: { isAnswered: true, text: '카드 엔진 구현', usage: {} } }) as any)
    on('prompt.submit', async (_$: unknown, e: any) => ({ text: e.text }) as any)
    await $.prompt.submit({ text: '카드 엔진을 구현해줘' } as any).catch(() => undefined)
    await ($.tool.call as any)({ tool: 'Bash', description: '이슈 본문 확인', command: 'gh issue view 4' } as any)
    // Agent 호출이 먼저 기록되고, 뒤따르는 description 없는 하위 에이전트 기록은 그 아래에 묶인다
    await ($.tool.call as any)({ tool: 'Agent', description: '카드 엔진 1~3단계 구현', subagent_type: 'general-purpose', prompt: '…' } as any)
    await ($.tool.call as any)({ tool: 'Bash', command: 'git status' } as any)
    await ($.tool.call as any)({ tool: 'Write', file_path: '/tmp/engine.py', content: '' } as any)
    const folded = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(folded).toContain('▸ 이슈 본문 확인')
    expect(folded).toContain('▸ 카드 엔진 1~3단계 구현')
    expect(folded).not.toContain('목적 없음')
    expect(folded).not.toContain('설명 없음')
    const pane = await expandLog($, surface)
    expect(pane.indexOf('▾ 카드 엔진 1~3단계 구현')).toBeLessThan(pane.indexOf('git status'))
    expect(pane.indexOf('git status')).toBeLessThan(pane.indexOf('/tmp/engine.py'))
    expect(pane).toContain('하위 에이전트에게 맡김 (general-purpose)')
  })
}

test('records a Bash command that runs no query, with its goal and status', async ($, on) => {
  const seen = watch(on)
  answerTools(on)
  await ($.tool.call as any)({ tool: 'Bash', description: '파일 목록', command: 'ls -la' } as any)
  expect(seen.actions.map(one => [one.kind, one.target, one.note, one.status])).toEqual([['command', 'ls -la', '파일 목록', 'done']])
})

test('records a query once, as a query run and not as a command', async ($, on) => {
  const seen = watch(on)
  answerTools(on)
  await ($.tool.call as any)({ tool: 'Bash', command: `python3 run_query.py -D web_mihd "SELECT 1"` } as any)
  expect(seen.runs.length).toBe(1)
  expect(seen.actions).toEqual([])
})

test('records files that Edit, Write and NotebookEdit change', async ($, on) => {
  const seen = watch(on)
  answerTools(on)
  await ($.tool.call as any)({ tool: 'Write', file_path: '/tmp/a.ts', content: 'x' } as any)
  await ($.tool.call as any)({ tool: 'Edit', file_path: '/tmp/a.ts', old_string: 'x', new_string: 'y' } as any)
  expect(seen.actions.map(one => [one.kind, one.target, one.note])).toEqual([
    ['file', '/tmp/a.ts', '작성'],
    ['file', '/tmp/a.ts', '수정'],
  ])
})

test('marks failed and denied commands, and skips files a call did not change', async () => {
  expect(actionOf({ tool: 'Bash', command: 'false' }, { isError: true })?.status).toBe('failed')
  expect(actionOf({ tool: 'Bash', command: 'rm x' }, { deny: 'no' })?.status).toBe('denied')
  expect(actionOf({ tool: 'Edit', file_path: '/tmp/a' }, { isError: true })).toBe(undefined)
  expect(actionOf({ tool: 'NotebookEdit', notebook_path: '/tmp/n.ipynb' }, {})?.target).toBe('/tmp/n.ipynb')
  expect(actionOf({ tool: 'Read', file_path: '/tmp/a' }, {})).toBe(undefined)
})

test('keeps the first lines of a command, each cut to its start', async () => {
  expect(commandText('ls -la')).toBe('ls -la')
  expect(commandText('a\nb\nc\nd')).toBe('a\nb\nc\nd')
  expect(commandText(`echo ${'x'.repeat(150)}`)).toBe(`echo ${'x'.repeat(115)}…`)
  const long = Array.from({ length: 10 }, (_, n) => `echo ${n + 1}`).join('\n')
  expect(commandText(long)).toBe(`${long.split('\n').slice(0, 8).join('\n')}\n# … (전체 10줄)`)
})

test('keeps the start of a command output, and the deny reason or error', async () => {
  const many = Array.from({ length: 30 }, (_, n) => `line ${n + 1}`).join('\n')
  const kept = actionOf({ tool: 'Bash', command: 'seq' }, { result: { stdout: many, stderr: '' } })
  expect(kept?.outputLines).toBe(30)
  expect(kept?.output.split('\n').length).toBe(20)
  expect(outputText(kept?.output ?? '', kept?.outputLines ?? 0)).toBe('line 1\nline 2\nline 3\nline 4\nline 5\n… (전체 30줄)')
  expect(outputText('y'.repeat(130), 1)).toBe(`${'y'.repeat(120)}…`)
  expect(actionOf({ tool: 'Bash', command: 'rm x' }, { deny: '거부함' })?.output).toBe('거부함')
  expect(actionOf({ tool: 'Bash', command: 'false' }, { isError: true, text: 'Exit code 1' })?.output).toBe('Exit code 1')
  expect(actionOf({ tool: 'Bash', command: 'true' }, { result: { stdout: '', stderr: '' } })?.outputLines).toBe(0)
})

test('registers assumed agreements and closes them with the user quote', async () => {
  const first = applyAgreements([], [{ statement: 'README 두 개를 함께 고친다', kind: 'scope', evidence: '이전 PR 이 두 README 를 함께 고침', status: 'assumed' }], {
    t: 1, at: '10:00', turn: 1, userQuote: '이전 요청',
  })
  expect(first.ids).toEqual(['a1'])
  expect(first.list[0]).toMatchObject({ kind: 'scope', status: 'assumed', userQuote: '', decidedAt: '' })
  const second = applyAgreements(first.list, [{ id: 'a1', status: 'revoked', note: '영문 README 만 고친다' }, { statement: '탭 이름은 암묵적 합의', kind: 'unknown', status: 'assumed' }], {
    t: 2, at: '10:05', turn: 2, userQuote: 'a1: 아님',
  })
  expect(second.ids).toEqual(['a1', 'a2'])
  expect(second.list[0]).toMatchObject({ status: 'revoked', note: '영문 README 만 고친다', userQuote: 'a1: 아님', quoteTurn: 2, decidedAt: '10:05', at: '10:00', evidence: '이전 PR 이 두 README 를 함께 고침' })
  expect(second.list[1]).toMatchObject({ kind: 'premise', status: 'assumed' })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws the agreements tab last and fills the prompt box on ${surface}`, async ($, on) => {
    const fills: string[] = []
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as any)
    on('session.cwd', async () => ({ value: '/tmp' }) as any)
    on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }) as any)
    on('prompt.fill', async (_$: unknown, e: any) => {
      fills.push(e.text)
      return { isFilled: true } as any
    })
    const ran = await ($.tool.call as any)({
      tool: 'mcp__blackbox-mods__track_agreements',
      items: [{ statement: '등록 시 탭을 바꾸지 않는다', kind: 'method', evidence: '사용자가 이의 없이 진행', status: 'assumed' }],
    })
    expect(JSON.stringify(ran)).toContain('a1')
    const before = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(before).toContain('▶ 세션 로그')
    expect(before).toContain('암묵적 합의 (1)')
    expect(before.indexOf('스킬 사용량')).toBeLessThan(before.indexOf('암묵적 합의'))
    await ($.tool.call as any)({
      tool: 'mcp__blackbox-mods__track_agreements',
      items: [
        { statement: '둘째 전제', kind: 'scope', evidence: '근거 2', status: 'assumed' },
        { statement: '셋째 전제', kind: 'term', evidence: '근거 3', status: 'assumed' },
      ],
    })
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-agreements', surface } as any)
    const render = async () => JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    const pane = await render()
    expect(pane).toContain('[?] a1. (작업 방식) 등록 시 탭을 바꾸지 않는다')
    expect(pane).toContain('근거: 사용자가 이의 없이 진행')
    expect(pane).toContain('암묵적 합의: 아무도 묻지 않았지만')
    expect(pane.indexOf('a1.')).toBeLessThan(pane.indexOf('a3.'))
    expect(pane).toContain('선택 0건')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'picked-yes', surface } as any)
    expect(fills).toEqual([])
    await $.ui.press({ plugin: 'blackbox-mods', key: 'agree-a1', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'agree-a2', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'agree-a3', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'agree-a2', surface } as any)
    const picking = await render()
    expect(picking).toContain('선택 2건')
    expect(picking).toContain('▶ [?] a1.')
    expect(picking).toContain('  [?] a2.')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'picked-yes', surface } as any)
    expect(fills).toEqual(['a1, a3: 맞음'])
    expect(await render()).toContain('선택 0건')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'agree-a2', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'picked-no', surface } as any)
    expect(fills).toEqual(['a1, a3: 맞음', 'a2: 아님'])
    await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__track_agreements', items: [{ id: 'a1', status: 'confirmed' }, { id: 'a2', status: 'confirmed' }, { id: 'a3', status: 'confirmed' }] })
    const after = await render()
    expect(after).toContain('[o] a1.')
    expect(after).not.toContain('agree-a1')
    expect(after).not.toContain('선택 맞음')
    expect(after).not.toContain('암묵적 합의 (1)')
  })
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-14T00:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

function emptyRecords(): SavedRecords {
  return { turns: [], reads: [], runs: [], actions: [], places: [], decisions: [], agreements: [], notes: [], lastPrompt: '', tab: 'log', logPage: '' }
}

test('deletes other sessions last updated more than 30 days ago and keeps newer ones', async () => {
  const others: StoredEntry[] = [
    { key: 'session:old', updatedAt: ago(31 * DAY), bytes: 10 },
    { key: 'session:edge', updatedAt: ago(30 * DAY), bytes: 10 },
    { key: 'session:new', updatedAt: ago(1 * DAY), bytes: 10 },
    { key: 'session:broken', updatedAt: '', bytes: 10 },
  ]
  expect(keysToDelete(others, 'session:now', 10, NOW)).toEqual(['session:old', 'session:broken'])
  expect(KEEP_MS).toBe(30 * DAY)
})

test('never deletes the current session, however old its last update is', async () => {
  const others: StoredEntry[] = [{ key: 'session:now', updatedAt: ago(90 * DAY), bytes: 10 }]
  expect(keysToDelete(others, 'session:now', 10, NOW)).toEqual([])
  expect(keysToDelete(others, 'session:now', STORE_BUDGET * 2, NOW, { maxAgeMs: KEEP_MS, budget: STORE_BUDGET })).toEqual([])
})

test('over the size limit, deletes the oldest other sessions first and stops once under it', async () => {
  const others: StoredEntry[] = [
    { key: 'session:b', updatedAt: ago(2 * DAY), bytes: 40 },
    { key: 'session:a', updatedAt: ago(3 * DAY), bytes: 40 },
    { key: 'session:c', updatedAt: ago(1 * DAY), bytes: 40 },
  ]
  const limits = { maxAgeMs: KEEP_MS, budget: 100 }
  // 합계 30 + 120 = 150: a(가장 오래됨) 를 지워 110, b 를 지워 70 에서 멈춘다
  expect(keysToDelete(others, 'session:now', 30, NOW, limits)).toEqual(['session:a', 'session:b'])
  // 합계가 한도 아래면 지우지 않는다
  expect(keysToDelete(others, 'session:now', 0, NOW, { maxAgeMs: KEEP_MS, budget: 200 })).toEqual([])
  // 현재 세션 하나로 한도를 넘으면 다른 세션을 모두 지우지만 현재 세션은 남긴다
  expect(keysToDelete(others, 'session:now', 500, NOW, limits)).toEqual(['session:a', 'session:b', 'session:c'])
})

test('counts JSON size in UTF-8 bytes', async () => {
  expect(jsonBytes('a')).toBe(3)
  expect(jsonBytes('가')).toBe(5)
  expect(jsonBytes('😀')).toBe(6)
  expect(entryBytes('k', 1)).toBe(jsonBytes('k') + 1 + 2)
  expect(sessionKey('abc')).toBe('session:abc')
})

test('shrinks an oversized session before saving and keeps decisions and agreements', async () => {
  const big = 'x'.repeat(200_000)
  const records: SavedRecords = {
    ...emptyRecords(),
    runs: Array.from({ length: 20 }, (_, n) => ({ id: `q${n}`, turn: 1, t: n, at: '', goal: '', purpose: '', database: '', tables: '', sql: 'SELECT 1', status: 'done' as const, output: big })),
    actions: [{ id: 'c1', t: 1, at: '', turn: 1, kind: 'command', target: 'ls', note: '', status: 'done', output: big, outputLines: 1 }],
    decisions: [{ id: 'd1', t: 1, at: '', turn: 1, question: '남길까', options: [], recommended: '', status: 'pending', answer: '', userQuote: '', decidedAt: '', quoteTurn: 0, decidedBy: 'user', source: 'tool' }],
  }
  const budget = 1024 * 1024
  expect(jsonBytes(records)).toBeGreaterThan(budget)
  const shrunk = shrinkRecords(records, budget)
  expect(jsonBytes(shrunk)).toBeLessThanOrEqual(budget)
  expect(shrunk.runs).toHaveLength(20)
  expect(shrunk.runs[0]?.output.length).toBeLessThan(big.length)
  expect(shrunk.runs[0]?.output).toContain('저장 한도를 넘어 잘림')
  expect(shrunk.decisions).toEqual(records.decisions)
  // 작은 기록은 그대로 둔다
  expect(shrinkRecords(emptyRecords(), budget)).toEqual(emptyRecords())
  // 잘라도 넘으면 오래된 로그부터 뺀다
  const tiny = shrinkRecords(records, 20_000)
  expect(jsonBytes(tiny)).toBeLessThanOrEqual(20_000)
  expect(tiny.decisions).toEqual(records.decisions)
  expect(tiny.runs.at(-1)?.id).toBe('q19')
})

test('reads back only saved sessions of this format', async () => {
  expect(savedRecordsOf({ v: 1, updatedAt: '', records: { turns: [] } })).toEqual({ turns: [] })
  expect(savedRecordsOf({ v: 2, updatedAt: '', records: {} })).toBeUndefined()
  expect(savedRecordsOf('x')).toBeUndefined()
  expect(savedRecordsOf(undefined)).toBeUndefined()
})

/** 테스트가 들여다볼 수 있는 메모리 저장소. $.store 의 get·set·delete·keys 에 답한다 */
function memoryStore(on: any, entries: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(entries))
  const deleted: string[] = []
  on('store.get', async (_$: unknown, e: any) => ({ value: store.get(e.key) }) as any)
  on('store.set', async (_$: unknown, e: any) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined } as any
  })
  on('store.delete', async (_$: unknown, e: any) => {
    store.delete(e.key)
    deleted.push(e.key)
    return { value: undefined } as any
  })
  on('store.keys', async () => ({ value: [...store.keys()] }) as any)
  return { store, deleted }
}

/** session.start 가 부르는 등록 호출과 시작 자체에 답한다 */
function startable(on: any) {
  on('command.register', async () => ({ value: undefined }) as any)
  on('tool.register', async () => ({ value: undefined }) as any)
  on('session.start', async () => ({ cwd: '/tmp' }) as any)
}

function quietTools(on: any) {
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as any)
  on('session.cwd', async () => ({ value: '/tmp' }) as any)
  on('session.root', async () => ({ value: '/tmp' }) as any)
  on('session.messages', async () => ({ value: [] }) as any)
}

test('saves records to the store a moment after they change, and deletes expired sessions', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const { store, deleted } = memoryStore(on, {
    'session:old': { v: 1, updatedAt: new Date(Date.now() - 31 * DAY).toISOString(), records: emptyRecords() },
    'session:recent': { v: 1, updatedAt: new Date(Date.now() - 2 * DAY).toISOString(), records: emptyRecords() },
  })
  on('session.id', async () => ({ value: 's1' }) as any)
  quietTools(on)
  await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__track_decisions', items: [{ question: '저장할까', status: 'pending', decidedBy: 'user' }] })
  expect(store.get('session:s1')).toBeUndefined()
  await clock.advance(1000)
  const saved = store.get('session:s1') as SavedSession
  expect(saved?.v).toBe(1)
  expect(saved.records.decisions[0]?.id).toBe('d1')
  expect(Number.isFinite(Date.parse(saved.updatedAt))).toBe(true)
  expect(deleted).toEqual(['session:old'])
  expect(store.has('session:recent')).toBe(true)
})

test('restores the same session at start, and new decision and agreement ids continue', async ($, on) => {
  const records: SavedRecords = {
    ...emptyRecords(),
    turns: [{ n: 1, t: 1, at: '09:00', prompt: '어제 요청', summary: '어제 요청' }],
    decisions: [{ id: 'd1', t: 1, at: '09:00', turn: 1, question: '어제 결정', options: [], recommended: '', status: 'pending', answer: '', userQuote: '', decidedAt: '', quoteTurn: 0, decidedBy: 'user', source: 'tool' }],
    agreements: [{ id: 'a1', t: 1, at: '09:00', turn: 1, statement: '어제 합의', kind: 'scope', evidence: '', status: 'assumed', note: '', userQuote: '', quoteTurn: 0, decidedAt: '' }],
  }
  startable(on)
  const { deleted } = memoryStore(on, {
    'session:s1': { v: 1, updatedAt: new Date().toISOString(), records },
    'session:other': { v: 1, updatedAt: new Date().toISOString(), records: { ...emptyRecords(), decisions: [] } },
  })
  on('session.id', async () => ({ value: 's1' }) as any)
  quietTools(on)
  await ($.session as any).start({ cwd: '/tmp' })
  const decided = await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__track_decisions', items: [{ question: '오늘 결정', status: 'pending', decidedBy: 'user' }] })
  expect(JSON.stringify(decided)).toContain('d2')
  const agreed = await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__track_agreements', items: [{ statement: '오늘 합의', kind: 'scope', evidence: '', status: 'assumed' }] })
  expect(JSON.stringify(agreed)).toContain('a2')
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'terminal' } as any))
  expect(pane).toContain('d1. 어제 결정')
  expect(pane).toContain('d2. 오늘 결정')
  expect(deleted).toEqual([])
})

test('a new session starts empty even when other sessions are saved', async ($, on) => {
  startable(on)
  memoryStore(on, { 'session:other': { v: 1, updatedAt: new Date().toISOString(), records: { ...emptyRecords(), turns: [{ n: 1, t: 1, at: '', prompt: '남의 요청', summary: '남의 요청' }] } } })
  on('session.id', async () => ({ value: 'fresh' }) as any)
  quietTools(on)
  await ($.session as any).start({ cwd: '/tmp' })
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'terminal' } as any))
  expect(pane).not.toContain('남의 요청')
})

test('a failed save does not stop the panel', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  on('store.keys', async () => {
    throw new Error('disk full')
  })
  on('session.id', async () => ({ value: 's1' }) as any)
  quietTools(on)
  const ran = await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__track_decisions', items: [{ question: '저장 실패해도', status: 'pending', decidedBy: 'user' }] })
  await clock.advance(1000)
  expect(JSON.stringify(ran)).toContain('d1')
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'terminal' } as any))
  expect(pane).toContain('d1. 저장 실패해도')
})

test('saves at once when a turn completes, without waiting for the delay', async ($, on) => {
  const { store } = memoryStore(on)
  on('session.id', async () => ({ value: 's1' }) as any)
  on('turn.complete', async () => ({ text: '' }) as any)
  quietTools(on)
  await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__track_agreements', items: [{ statement: '바로 저장', kind: 'method', evidence: '', status: 'assumed' }] })
  await ($.turn as any).complete({ answer: '끝', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'sub' })
  expect((store.get('session:s1') as SavedSession)?.records.agreements[0]?.id).toBe('a1')
})

test('registers no work plan tool at session start', async ($, on) => {
  const names: string[] = []
  on('tool.register', async (_$: unknown, e: any) => {
    names.push(e.name)
    return { value: undefined } as any
  })
  on('command.register', async () => ({ value: undefined }) as any)
  on('session.start', async () => ({ cwd: '/tmp' }) as any)
  memoryStore(on)
  on('session.id', async () => ({ value: 's1' }) as any)
  quietTools(on)
  await ($.session as any).start({ cwd: '/tmp' })
  expect(names).toContain('track_decisions')
  expect(names).not.toContain('show_plan')
})

test('restores records saved with work plans and steps, and draws them without the plan', async ($, on) => {
  const records = {
    ...emptyRecords(),
    turns: [{ n: 1, t: 1, at: '09:00', prompt: '어제 요청', summary: '어제 요청' }],
    actions: [{ id: 'x', t: 2, at: '09:01', turn: 1, kind: 'command', target: 'ls old', note: '어제 명령', status: 'done', output: '', outputLines: 0, step: { goal: 'g', n: 1 } }],
    plans: [{ id: 'p', t: 1, at: '09:00', turn: 1, goal: '어제 목표', steps: [{ text: '어제 단계', label: '어제 단계', status: 'doing', after: [] }] }],
  }
  startable(on)
  memoryStore(on, { 'session:s1': { v: 1, updatedAt: new Date().toISOString(), records } })
  on('session.id', async () => ({ value: 's1' }) as any)
  quietTools(on)
  await ($.session as any).start({ cwd: '/tmp' })
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'terminal' } as any))
  expect(pane).toContain('어제 명령')
  expect(pane).not.toContain('어제 목표')
  expect(pane).not.toContain('작업 계획')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`lists a request's records in time order without a work plan on ${surface}`, async ($, on) => {
    answerTools(on, 'ok')
    on('model.complete', async () => ({ value: { isAnswered: true, text: '실시간 순위 장애 대응', usage: {} } }) as any)
    on('prompt.submit', async (_$: unknown, e: any) => ({ text: e.text }) as any)
    await $.prompt.submit({ text: '실시간 순위가 안 보이는 장애가 있어. 원인을 찾아서 알려줘. 로그와 배치 코드를 봐줘.' } as any).catch(() => undefined)
    await ($.tool.call as any)({ tool: 'Bash', description: '마지막 적재 시각 확인', command: 'ls load' } as any)
    await ($.tool.call as any)({ tool: 'Bash', description: '배치 로그 확인', command: 'ls batch' } as any)
    await ($.tool.call as any)({ tool: 'Edit', file_path: '/tmp/fix.py', old_string: 'a', new_string: 'b' } as any)
    const pane = await expandLog($, surface)
    const at = (text: string) => pane.indexOf(text)
    expect(at('## 실시간 순위 장애 대응')).toBeLessThan(at('마지막 적재 시각 확인'))
    expect(at('마지막 적재 시각 확인')).toBeLessThan(at('배치 로그 확인'))
    // 목적 없는 파일 수정은 바로 앞 목적 묶음에 들어간다
    expect(at('▾ 배치 로그 확인')).toBeLessThan(at('/tmp/fix.py'))
    expect(pane.match(/"key":"purpose-/g)?.length).toBe(2)
    expect(pane).not.toContain('▌')
    expect(pane).not.toContain('작업 계획')
    expect(pane).not.toContain('단계 밖')
  })
}

test('opens the panel only when /blackbox-mods runs', async ($, on) => {
  answerTools(on, 'ok')
  const opened: string[] = []
  on('ui.open', async (_$: unknown, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as any
  })
  await ($.tool.call as any)({ tool: 'Bash', description: '순위 확인', command: `python3 run_query.py -D web_mihd "SELECT 1"` } as any)
  await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__track_decisions', items: [{ question: '저장할까', status: 'pending', decidedBy: 'user' }] })
  expect(opened).toEqual([])
  await ($.command.run as any)({ command: 'blackbox-mods', args: '' })
  expect(opened).toEqual(['blackbox-mods'])
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'terminal' } as any))
  expect(pane).toContain('결정 사항 (1)')
})

function answerIssue(on: any, calls: { server: string; tool: string; args: Record<string, unknown> }[], runs: string[][], isError: boolean) {
  on('session.messages', async () => ({
    value: [{ role: 'assistant', text: '', toolUses: [{ tool: 'Bash', input: { command: 'gh issue close 7 --repo a/x' }, text: '' }] }],
  }) as any)
  on('session.cwd', async () => ({ value: '/tmp' }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  on('mcp.call', async (_$: unknown, e: any) => {
    calls.push(e)
    return { value: { content: [], isError } } as any
  })
  on('process.run', async (_$: unknown, e: any) => {
    runs.push(e.argv)
    if (e.argv[0] === 'open') return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
    if (e.argv[0] !== 'sh' || String(e.argv[2] ?? '').includes('rev-parse')) return { value: { exitCode: 1, stdout: '', stderr: '' } } as any
    return { value: { exitCode: 0, stdout: 'issue\n{"title":"제목 7","state":"OPEN","stateReason":""}', stderr: '' } } as any
  })
}

test('opens an issue in the built-in browser when its number is pressed on desktop', async ($, on) => {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  const runs: string[][] = []
  answerIssue(on, calls, runs, false)
  await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'desktop' } as any)
  await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-issues', surface: 'desktop' } as any)
  await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'desktop' } as any)
  await $.ui.press({ plugin: 'blackbox-mods', key: 'issue-https://github.com/a/x/issues/7', surface: 'desktop' } as any)
  expect(calls).toEqual([{ server: 'Claude_Browser', tool: 'preview_start', args: { url: 'https://github.com/a/x/issues/7' } }])
  expect(runs.some(argv => argv[0] === 'open')).toBe(false)
})

test('opens the system browser when the built-in browser fails', async ($, on) => {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  const runs: string[][] = []
  answerIssue(on, calls, runs, true)
  await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'desktop' } as any)
  await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-issues', surface: 'desktop' } as any)
  await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'desktop' } as any)
  await $.ui.press({ plugin: 'blackbox-mods', key: 'issue-https://github.com/a/x/issues/7', surface: 'desktop' } as any)
  expect(runs.find(argv => argv[0] === 'open')).toEqual(['open', 'https://github.com/a/x/issues/7'])
})

test('keeps the issue number a link on terminal', async ($, on) => {
  answerIssue(on, [], [], false)
  await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'terminal' } as any)
  await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-issues', surface: 'terminal' } as any)
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'terminal' } as any))
  expect(pane).toContain('"href":"https://github.com/a/x/issues/7"')
  expect(pane).not.toContain('issue-https://github.com/a/x/issues/7')
})

test('addNote keeps the text as it is and numbers notes n1, n2 …', () => {
  const now = { t: 1, at: '14:21' }
  expect(addNote([], '  \n', 'clipboard', 1, now)).toBe(undefined)
  const one = addNote([], '  첫 줄\n둘째 줄  ', 'clipboard', 1, now) ?? []
  expect(one[0]).toEqual({ id: 'n1', t: 1, at: '14:21', turn: 1, source: 'clipboard', title: '', original: '  첫 줄\n둘째 줄  ', text: '  첫 줄\n둘째 줄  ' })
  const two = addNote(removeNote(addNote(one, 'b', 'clipboard', 2, now) ?? [], 'n1'), 'c', 'clipboard', 2, now) ?? []
  expect(two.map(note => note.id)).toEqual(['n2', 'n3'])
})

test('editNote changes only the text of that note and keeps the original', () => {
  const list = addNote([], '원문', 'clipboard', 1, { t: 1, at: '' }) ?? []
  const edited = editNote(list, 'n1', '고친 글')
  expect(edited[0]?.text).toBe('고친 글')
  expect(edited[0]?.original).toBe('원문')
  expect(editNote(list, 'n9', 'x')).toEqual(list)
})

test('noteRows counts wrapped lines, from 3 rows to 10, or 30 when wide', () => {
  expect(noteRows('한 줄')).toBe(3)
  expect(noteRows('1\n2\n3')).toBe(4)
  expect(noteRows('가'.repeat(45))).toBe(3)
  expect(noteRows('가'.repeat(100))).toBe(5)
  expect(noteRows(Array(40).fill('x').join('\n'))).toBe(10)
  expect(noteRows(Array(40).fill('x').join('\n'), true)).toBe(30)
})

test('noteTitleOf takes a short answer, else the head of the note', () => {
  expect(noteTitleOf('노트 탭 설계\n', '본문')).toBe('노트 탭 설계')
  expect(noteTitleOf('', '짧은 글')).toBe('짧은 글')
  expect(noteTitleOf('주어진 글이 보이지 않습니다. 제목을 쓸 글을 본문으로 붙여 넣어 주세요.', '가나다라마바사아자차카타파하 가나다라마바사')).toBe('가나다라마바사아자차카타파하 가나다라마…')
  expect(titleNote(addNote([], 'a', 'clipboard', 0, { t: 0, at: '' }) ?? [], 'n1', '제목')[0]?.title).toBe('제목')
})

test('quotedNote quotes each line and keeps the draft', () => {
  expect(quotedNote('a\nb\n', '')).toBe('> a\n> b\n')
  expect(quotedNote('a', '이 부분 봐줘  ')).toBe('이 부분 봐줘\n\n> a\n')
})

test('notes tab: takes the clipboard as it is in UTF-8, titles it, edits in place, Enter keeps it, and delete needs two presses', async ($, on) => {
  const toasts: string[] = []
  const argvs: string[][] = []
  on('ui.toast', async (_$: unknown, e: any) => {
    toasts.push(String(e.text ?? e))
    return { value: undefined } as any
  })
  on('process.run', async (_$: unknown, e: any) => {
    argvs.push(e.argv)
    return e.argv.includes('/usr/bin/pbpaste')
      ? ({ value: { exitCode: 0, stdout: '오류: ENOENT\n    at open\n', stderr: '' } } as any)
      : ({ value: { exitCode: 1, stdout: '', stderr: '' } } as any)
  })
  on('model.complete', async () => ({ value: { isAnswered: true, text: '열기 오류 로그', usage: {} } }) as any)
  on('session.cwd', async () => ({ value: '/tmp' }) as any)
  const render = async (surface = 'desktop') => JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
  await render()
  await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-notes', surface: 'desktop' } as any)
  let pane = await render()
  expect(pane).toContain('아직 노트가 없다')
  expect(pane).not.toContain('선택한 글 담기')
  await $.ui.press({ plugin: 'blackbox-mods', key: 'note-clipboard', surface: 'desktop' } as any)
  expect(argvs.find(argv => argv.includes('/usr/bin/pbpaste'))).toEqual(['/usr/bin/env', 'LANG=en_US.UTF-8', 'LC_ALL=en_US.UTF-8', '/usr/bin/pbpaste'])
  pane = await render()
  expect(pane).toContain('열기 오류 로그 · ')
  expect(pane).not.toContain('n1 · ')
  expect(pane).toContain('오류: ENOENT\\n    at open\\n')
  expect(pane).toContain('"type":"Input"')
  expect(pane).toContain('크게 보기')
  await ($.ui as any).input({ plugin: 'blackbox-mods', key: 'note-n1', text: '고친 노트\n둘째 줄', kind: 'change', surface: 'desktop' })
  await ($.ui as any).input({ plugin: 'blackbox-mods', key: 'note-n1', text: '고친 노트\n둘째 줄', kind: 'submit', surface: 'desktop' })
  pane = await render()
  expect(pane).toContain('고친 노트\\n둘째 줄')
  expect(pane).toContain('(수정함)')
  await $.ui.press({ plugin: 'blackbox-mods', key: 'note-remove-n1', surface: 'desktop' } as any)
  expect(await render()).toContain('고친 노트')
  expect(toasts.some(text => text.includes('한 번 더 누른다'))).toBe(true)
  await $.ui.press({ plugin: 'blackbox-mods', key: 'note-remove-n1', surface: 'desktop' } as any)
  expect(await render()).toContain('아직 노트가 없다')
})

test('restores saved notes of the same session', async ($, on) => {
  const records: SavedRecords = {
    ...emptyRecords(),
    tab: 'notes',
    notes: [{ id: 'n1', t: 1, at: '09:00', turn: 0, source: 'clipboard', title: '어제 제목', original: '어제 담은 글', text: '어제 고친 글' }],
  }
  startable(on)
  memoryStore(on, { 'session:s1': { v: 1, updatedAt: new Date().toISOString(), records } })
  on('session.id', async () => ({ value: 's1' }) as any)
  quietTools(on)
  await ($.session as any).start({ cwd: '/tmp' })
  const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface: 'terminal' } as any))
  expect(pane).toContain('어제 제목 · 09:00  (수정함)')
  expect(pane).toContain('어제 고친 글')
})
