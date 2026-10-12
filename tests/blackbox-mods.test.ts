import { expect, test } from 'claude-code/testing'

import type { ActionEntry, Plan, QueryRun } from '../types'
import { actionOf, commandText, answerLine, executedPart, applyDecisions, ciOf, classifySkill, parseMeta, stateBadge, columnsOf, planDiagram, separator, shortSummary, askAnswers, cdTargetsOf, collectIssues, collectSkillHits, descriptionOf, matchedPhrases, userWords, refsInGhCommand, refsInText, databaseOf, parseWorktrees, planText, purposeOf, sqlOf, tablesOf, upsertPlan } from '../hooks/register'

function watch(on: any) {
  const seen: { runs: QueryRun[]; plans: Plan[]; actions: ActionEntry[] } = { runs: [], plans: [], actions: [] }
  on('state.set', async ($: unknown, e: any, next: any) => {
    if (e.key === 'runs') seen.runs = e.value
    if (e.key === 'actions') seen.actions = e.value
    if (e.key === 'plans') seen.plans = e.value
    return next(e)
  })
  return seen
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

test('keeps one entry per plan goal, updated in place', async () => {
  const first: Plan = { id: 'a', t: 1, at: '10:00', turn: 1, goal: 'g', steps: [{ text: 's', label: '', status: 'todo', after: [] }] }
  const other: Plan = { id: 'b', t: 2, at: '10:05', turn: 1, goal: 'h', steps: [] }
  const again: Plan = { id: 'c', t: 3, at: '10:09', turn: 2, goal: 'g', steps: [{ text: 's', label: '', status: 'done', after: [] }] }
  const list = upsertPlan(upsertPlan(upsertPlan([], first), other), again)
  expect(list.map(plan => plan.goal)).toEqual(['g', 'h'])
  expect(list[0]?.at).toBe('10:00')
  expect(list[0]?.steps[0]?.status).toBe('done')
})

test('writes a plan as text with its branches', async () => {
  const plan: Plan = {
    id: 'a',
    t: 1,
    at: '10:00',
    turn: 1,
    goal: 'g',
    steps: [
      { text: '조회', label: '', status: 'done', after: [] },
      { text: '대조', label: '', status: 'doing', after: [1] },
    ],
  }
  expect(planText(plan)).toBe('[x] 1. 조회\n[>] 2. 대조 ← 1')
})

test('stores a plan the model sends', async ($, on) => {
  const seen = watch(on)
  answerTools(on)
  await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__show_plan', goal: 'g', steps: [{ text: 'a', status: 'doing' }, { text: 'b', status: 'todo' }] } as any)
  expect(seen.plans[0]?.steps).toEqual([
    { text: 'a', label: '', status: 'doing', after: [] },
    { text: 'b', label: '', status: 'todo', after: [1] },
  ])
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

test('asks the model for a purpose comment in the system prompt', async ($, on) => {
  on('prompt.compose', async () => ({ sections: [] }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['desktop'],
    tools: ['Bash'],
    outputStyle: null,
    traits: [],
  } as any)
  expect(composed.sections.some(section => section.id === 'blackbox-mods:purpose')).toBe(true)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws the log tab and switches to the tree tab on ${surface}`, async ($, on) => {
    answerTools(on, '| a |\n|---|\n| 1 |')
    await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__show_plan', goal: 'g', steps: [{ text: '계획 단계', status: 'todo' }] } as any)
    await ($.tool.call as any)({ tool: 'Bash', description: 'g', command: `python3 run_query.py -D web_mihd "SELECT a FROM t"` } as any)
    const log = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(log).toContain('계획 단계')
    expect(log).toContain('SELECT a FROM t')
    expect(log.indexOf('계획 단계')).toBeLessThan(log.indexOf('SELECT a FROM t'))
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
  expect(list[0]?.sources).toEqual(['사용자 프롬프트', 'gh 명령'])
  expect(list[0]?.actions).toEqual(['view'])
  expect(list[0]?.url).toBe('https://github.com/IGAWorksDev/dmp.crawler/issues/40')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws GitHub rows like the app's PR chip on ${surface}`, async ($, on) => {
    on('session.messages', async () => ({
      value: [{ role: 'user', text: 'https://github.com/o/dmp.crawler/pull/35 와 https://github.com/o/dmp.crawler/issues/9', toolUses: [] }],
    }) as any)
    on('process.run', async (_$: unknown, e: any) => {
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
    expect(pane).toContain('▶ 깃헙')
    expect(pane).toContain('⎇ 머지됨')
    expect(pane).toContain('#35')
    expect(pane).toContain('https://github.com/o/dmp.crawler/pull/35')
    expect(pane).toContain('docs/o-rk-a-rk-reverse-engineering')
    expect(pane).toContain('+4,079')
    expect(pane).toContain('−761')
    expect(pane).toContain('○ CI')
    expect(pane).toContain('✓ 완료')
    expect(pane).toContain('제목 9')
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
    expect(pane).toContain('── 결정 사항을 별도 탭으로 보여 줘 ')
    expect(pane).toContain('[ ] 1. 도구로 결정 대기 항목을 등록할지')
    expect(pane).toContain('[x] 2. 사용자 답변 원문을 자동으로 붙인다  (Claude 가 정함)')
    await $.prompt.submit({ text: '등록하지마.' } as any).catch(() => undefined)
    await ($.tool.call as any)({ tool: 'mcp__blackbox-mods__track_decisions', items: [{ id: 'd1', status: 'decided', answer: '등록 안 함' }] } as any)
    pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('[x] 1. 도구로 결정 대기 항목을 등록할지 => 등록 안 함')
    expect(pane).toContain('-> 등록하지마.')
    expect(pane.match(/도구로 결정 대기 항목을 등록할지/g)?.length).toBe(1)
    expect(pane).not.toContain('결정 대기 1건')
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`opens only used worktrees in VS Code on ${surface}`, async ($, on) => {
    const runs: string[][] = []
    on('session.cwd', async () => ({ value: '/r' }) as any)
    on('session.messages', async () => ({ value: [] }) as any)
    on('ui.toast', async () => ({ value: undefined }) as any)
    on('process.run', async (_$: unknown, e: any) => {
      runs.push(e.argv)
      const argv: string[] = e.argv
      if (argv[0] === 'git' && argv.includes('worktree')) {
        return { value: { exitCode: 0, stdout: 'worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/.worktree/x\nHEAD 2\nbranch refs/heads/x\n', stderr: '' } } as any
      }
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
    })
    await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any)
    await $.ui.press({ plugin: 'blackbox-mods', key: 'tab-tree', surface } as any)
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('open-/r')
    expect(pane).not.toContain('open-/r/.worktree/x')
    await $.ui.press({ plugin: 'blackbox-mods', key: 'open-/r', surface } as any)
    const opened = runs.find(argv => argv[0] === 'sh' && String(argv[2]).includes('code'))
    expect(opened?.at(-1)).toBe('/r')
  })
}

test('classifies skills by plugin name and folder', async () => {
  expect(classifySkill('git-workflow:issue-create', '')).toEqual({ group: 'plugin', plugin: 'git-workflow' })
  expect(classifySkill('find-skills', '/Users/b/.agents/skills/find-skills')).toEqual({ group: 'custom', plugin: '' })
  expect(classifySkill('mi-data-access', '/Users/b/Documents/Github/mi/.claude/skills/mi-data-access')).toEqual({ group: 'custom', plugin: '' })
  expect(classifySkill('plugin-authoring', '/private/tmp/bundled-skills/x/plugin-authoring')).toEqual({ group: 'builtin', plugin: '' })
})

test('draws a plan as an ascii flow and a separator line', async () => {
  const steps = [
    { text: '계획을 세운다', label: '계획', status: 'done' as const, after: [] },
    { text: '코드를 고친다', label: '수정', status: 'doing' as const, after: [1] },
    { text: '테스트를 고친다', label: '테스트', status: 'todo' as const, after: [1] },
    { text: '사용자 승인', label: '승인', status: 'todo' as const, after: [2, 3] },
  ]
  expect(planDiagram(steps, 80)).toBe('[✓ 계획] ──> [▶ 수정] + [  테스트] ──> [  승인]')
  expect(planDiagram(steps, 20).split('\n')[1]?.startsWith('  ──> ')).toBe(true)
  expect(columnsOf('가a')).toBe(3)
  expect(separator('요청', 20)).toBe(`── 요청 ${'─'.repeat(12)}`)
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
    const pane = JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'blackbox-mods', surface } as any))
    expect(pane).toContain('카카오톡 DAU 조회')
    expect(pane.match(/── \[/g)?.length).toBe(1)
    expect(pane).toContain('명령: 배치 폴더 확인')
    expect(pane).toContain('$ ls batch')
    expect(pane).toContain('수정: /Users/b/mi/a.py')
    expect(pane).not.toContain('run_query.py')
    expect(pane).toContain('목적: 날짜별 OS별 사용자수')
    expect(pane).toContain('SELECT a FROM t')
    expect(pane).toContain('읽은 파일:')
    expect(pane).toContain('/Users/b/mi/.worktree/x/README.md')
    expect(pane).toContain('결과: 기준일이 -2일로 바뀌었다')
    expect(pane).not.toContain('결정 대기')
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

test('shows the first lines of a long command', async () => {
  expect(commandText('a\nb')).toBe('a\nb')
  expect(commandText('a\nb\nc\nd')).toBe('a\nb\nc\n… (전체 4줄)')
})
