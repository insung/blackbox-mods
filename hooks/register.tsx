import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Decision, IssueMeta, IssueRef, Plan, PlanStep, QueryRun, ReadEntry, RepoView, SkillGroup, SkillHit, TabId, TreeView, Turn, Worktree } from '../types'

const LOG_PANE = 'blackbox-mods'
const TABS: { id: TabId; label: string }[] = [
  { id: 'log', label: '세션 로그' },
  { id: 'decisions', label: '결정 사항' },
  { id: 'issues', label: '깃헙' },
  { id: 'tree', label: '워크 트리' },
  { id: 'skills', label: '스킬 사용량' },
]
const READ_TOOL = 'note_reads'
const SUMMARY_LIMIT = 30
const PLAN_TOOL = 'show_plan'
const DECISION_TOOL = 'track_decisions'
const QUERY_COMMAND = /run_query\.py|(^|[\s;&|])mysql\s/
const OUTPUT_LINES = 30
const STEP_MARK: Record<PlanStep['status'], string> = { todo: '[ ]', doing: '[>]', done: '[x]', skipped: '[-]' }
const DECISION_RULE = [
  '사용자에게 결정을 맡기는 항목(진행 여부, 방법 선택, 이름, 범위 등)을 답변에 남길 때는 답변을 끝내기 전에 track_decisions 도구로 항목마다 status pending, decidedBy user 로 등록한다. 질문, 선택지, 권장안을 함께 보낸다.',
  '요청을 분석해 Claude 가 스스로 정했고 사용자에게 묻지 않아도 되는 항목은 status decided, decidedBy claude 로 등록한다.',
  '사용자가 답하면 그 답으로 정해진 항목을 id 로 가리켜 status decided(또는 취소면 dropped)와 answer(무엇으로 정해졌는지, 그 결과 한 일을 짧게)로 갱신한다. 사용자 답변 원문은 도구가 자동으로 붙인다.',
  'AskUserQuestion 대화창의 질문과 답은 자동으로 기록되므로 따로 등록하지 않는다.',
].join('\n')

const READ_RULE = [
  'Read 도구로 파일을 읽어 결론을 냈으면, 그 요청의 답을 끝내기 전에 note_reads 도구로 목적(왜 읽었는지)과 결과(읽고 내린 결론)를 각각 한두 줄로 보낸다. 읽은 파일 경로는 도구가 자동으로 모은다.',
  'show_plan 의 단계에는 다이어그램에 쓸 10자 안팎의 label 을 함께 보낸다.',
].join('\n')

const PURPOSE_RULE = [
  'MI DB 쿼리(run_query.py, mysql)를 실행할 때는 SQL 문장마다 맨 앞에 `-- 조회 목적: <이 쿼리로 무엇을 왜 확인하는지 한 문장>` 주석을 붙인다.',
  '사용자는 Blackbox 패널에서 이 주석을 쿼리 설명으로 읽는다. Bash 명령의 description 은 그 작업의 짧은 목표로 쓴다.',
].join('\n')

const turns = atom({ plugin: 'blackbox-mods', key: 'turns' } as const, [] as Turn[])
const reads = atom({ plugin: 'blackbox-mods', key: 'reads' } as const, [] as ReadEntry[])
const runs = atom({ plugin: 'blackbox-mods', key: 'runs' } as const, [] as QueryRun[])
const plans = atom({ plugin: 'blackbox-mods', key: 'plans' } as const, [] as Plan[])
const places = atom({ plugin: 'blackbox-mods', key: 'places' } as const, [] as string[])
const tree = atom({ plugin: 'blackbox-mods', key: 'tree' } as const, null as TreeView | null)
const issues = atom({ plugin: 'blackbox-mods', key: 'issues' } as const, [] as IssueRef[])
const issueMeta = atom({ plugin: 'blackbox-mods', key: 'issueMeta' } as const, {} as Record<string, IssueMeta>)
const issuesAt = atom({ plugin: 'blackbox-mods', key: 'issuesAt' } as const, '')
const skillHits = atom({ plugin: 'blackbox-mods', key: 'skillHits' } as const, [] as SkillHit[])
const skillsAt = atom({ plugin: 'blackbox-mods', key: 'skillsAt' } as const, '')
const decisions = atom({ plugin: 'blackbox-mods', key: 'decisions' } as const, [] as Decision[])
const lastPrompt = atom({ plugin: 'blackbox-mods', key: 'lastPrompt' } as const, '')
const tab = atom({ plugin: 'blackbox-mods', key: 'tab' } as const, 'log' as TabId)
let githubUser = ''

type Found = { owner: string; repo: string; number: number; isPull?: boolean; action?: string }

const URL_REF = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/g
const SHORT_REF = /(?<![\w/.-])([A-Za-z0-9][\w.-]*)\/([\w.-]+)#(\d+)\b/g
const GH_COMMAND = /\bgh\s+(issue|pr)\s+([a-z-]+)([^\n;&|]*)/g

/** 글에서 이슈·PR 참조를 찾는다: URL 과 owner/repo#N */
export function refsInText(text: string): Found[] {
  const found: Found[] = []
  for (const m of text.matchAll(URL_REF)) {
    found.push({ owner: m[1] ?? '', repo: m[2] ?? '', number: Number(m[4]), isPull: m[3] === 'pull' })
  }
  for (const m of text.matchAll(SHORT_REF)) {
    found.push({ owner: m[1] ?? '', repo: m[2] ?? '', number: Number(m[3]) })
  }
  return found.filter(one => one.owner && one.repo && one.number > 0)
}

/** gh issue|pr 명령에서 저장소·번호·동작을 찾는다. 번호가 없는 create 는 결과의 URL 로 잇는다 */
export function refsInGhCommand(command: string, resultText: string): Found[] {
  const found: Found[] = []
  for (const m of command.matchAll(GH_COMMAND)) {
    const isPull = m[1] === 'pr'
    const action = m[2] ?? ''
    const rest = m[3] ?? ''
    const repoArg = rest.match(/(?:--repo|-R)[\s=]+([\w.-]+)\/([\w.-]+)/)
    const urlArg = [...rest.matchAll(URL_REF)][0]
    const numberArg = rest.match(/(?:^|\s)#?(\d+)(?=\s|$)/)
    if (urlArg) {
      found.push({ owner: urlArg[1] ?? '', repo: urlArg[2] ?? '', number: Number(urlArg[4]), isPull: urlArg[3] === 'pull', action })
    } else if (repoArg && numberArg) {
      found.push({ owner: repoArg[1] ?? '', repo: repoArg[2] ?? '', number: Number(numberArg[1]), isPull, action })
    } else if (action === 'create') {
      for (const ref of refsInText(resultText)) found.push({ ...ref, action })
    }
  }
  return found.filter(one => one.owner && one.repo && one.number > 0)
}

export function collectIssues(
  messages: readonly { role: string; text: string; toolUses?: readonly { tool: string; input: Record<string, unknown>; text?: string }[] }[],
): IssueRef[] {
  const byKey = new Map<string, IssueRef>()
  const add = (ref: Found, order: number, source: string) => {
    const key = `${ref.owner}/${ref.repo}#${ref.number}`
    const known = byKey.get(key)
    const isPull = Boolean(ref.isPull) || Boolean(known?.isPull)
    const entry: IssueRef = known ?? {
      key,
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      isPull,
      url: '',
      order,
      sources: [],
      actions: [],
    }
    entry.isPull = isPull
    entry.url = `https://github.com/${ref.owner}/${ref.repo}/${isPull ? 'pull' : 'issues'}/${ref.number}`
    if (!entry.sources.includes(source)) entry.sources.push(source)
    if (ref.action && !entry.actions.includes(ref.action)) entry.actions.push(ref.action)
    byKey.set(key, entry)
  }
  messages.forEach((message, order) => {
    const source = message.role === 'user' ? '사용자 프롬프트' : 'Claude 답변'
    for (const ref of refsInText(message.text)) add(ref, order, source)
    for (const use of message.toolUses ?? []) {
      const command = typeof use.input.command === 'string' ? use.input.command : ''
      const resultText = use.text ?? ''
      for (const ref of refsInGhCommand(command, resultText)) add(ref, order, 'gh 명령')
      for (const ref of refsInText(resultText)) add(ref, order, '명령 결과')
    }
  })
  return [...byKey.values()].sort((a, b) => a.order - b.order)
}

type TranscriptMessage = {
  role: string
  text: string
  toolUses?: readonly { tool: string; input: Record<string, unknown>; text?: string }[]
}

/** 시스템이 붙인 블록을 빼고 사용자가 쓴 글만 남긴다 */
export function userWords(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<(local-command-[\w-]+|command-message|command-args)>[\s\S]*?<\/\1>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** description 안의 따옴표 예시 문구 중 요청에 들어 있던 것 */
export function matchedPhrases(description: string, prompt: string): string[] {
  const squash = (text: string) => text.replace(/\s+/g, '').toLowerCase()
  const target = squash(prompt)
  const phrases = [...description.matchAll(/[“"「]([^”"」]{2,60})[”"」]/g)].map(m => (m[1] ?? '').trim())
  return [...new Set(phrases.filter(phrase => phrase && target.includes(squash(phrase))))]
}

export function descriptionOf(skillMd: string): string {
  const head = skillMd.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  const line = head.match(/^description:\s*(.*)$/m)
  if (!line) return ''
  const first = (line[1] ?? '').trim()
  if (first && !/^[|>]-?$/.test(first)) {
    const wrapped = first.match(/^(["'])([\s\S]*)\1$/)
    return wrapped && !/["']/.test(wrapped[2] ?? '') ? (wrapped[2] ?? '') : first
  }
  const after = head.slice((line.index ?? 0) + line[0].length).split('\n').slice(1)
  const body: string[] = []
  for (const row of after) {
    if (!/^\s+\S/.test(row)) break
    body.push(row.trim())
  }
  return body.join(' ')
}

export function collectSkillHits(messages: readonly TranscriptMessage[]): SkillHit[] {
  const hits: SkillHit[] = []
  let turn = 0
  let prompt = ''
  messages.forEach((message, order) => {
    if (message.role === 'user') {
      const slash = message.text.match(/<command-name>\/?([^<]+)<\/command-name>/)
      const args = message.text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? ''
      const words = userWords(message.text)
      if (words || slash) {
        turn += 1
        prompt = words || `/${slash?.[1] ?? ''} ${args}`.trim()
      }
      if (slash && !/<local-command-caveat>/.test(message.text)) {
        hits.push({ order, turn, skill: (slash[1] ?? '').trim(), args, trigger: 'slash', prompt, claudeNote: '', baseDir: '', description: '', matched: [], group: 'builtin', plugin: '' })
      }
      return
    }
    for (const use of message.toolUses ?? []) {
      if (use.tool !== 'Skill') continue
      hits.push({
        order,
        turn,
        skill: String(use.input.skill ?? ''),
        args: String(use.input.args ?? ''),
        trigger: 'model',
        prompt,
        claudeNote: message.text.trim(),
        baseDir: use.text?.match(/Base directory for this skill:\s*(\S+)/)?.[1] ?? '',
        description: '',
        matched: [],
        group: 'builtin',
        plugin: '',
      })
    }
  })
  return hits
}

/** 스킬 이름과 폴더로 묶음을 정한다. 이름의 `plugin:` 이 먼저이고, 폴더가 .claude/skills·.agents/skills 아래면 커스텀이다 */
export function classifySkill(skill: string, baseDir: string): { group: SkillHit['group']; plugin: string } {
  const cut = skill.indexOf(':')
  if (cut > 0) return { group: 'plugin', plugin: skill.slice(0, cut) }
  if (/\/\.(claude|agents)\/skills\//.test(`${baseDir}/`)) return { group: 'custom', plugin: '' }
  return { group: 'builtin', plugin: '' }
}

/** 플러그인별 묶음(많이 쓴 순), 커스텀, 내장 순서. 묶음 안의 스킬도 많이 쓴 순 */
export function groupSkillHits(hits: SkillHit[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>()
  for (const hit of hits) {
    const name = hit.group === 'plugin' ? hit.plugin : hit.group === 'custom' ? '커스텀 스킬' : 'Claude Code 내장'
    const key = `${hit.group}:${name}`
    const group = groups.get(key) ?? { kind: hit.group, name, total: 0, skills: [] }
    const short = hit.group === 'plugin' ? hit.skill.slice(hit.plugin.length + 1) : hit.skill
    const skill = group.skills.find(one => one.skill === short) ?? (group.skills.push({ skill: short, count: 0, hits: [] }), group.skills[group.skills.length - 1]!)
    skill.count += 1
    skill.hits.push(hit)
    group.total += 1
    groups.set(key, group)
  }
  const rank = { plugin: 0, custom: 1, builtin: 2 } as const
  const list = [...groups.values()]
  for (const group of list) group.skills.sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
  return list.sort((a, b) => rank[a.kind] - rank[b.kind] || b.total - a.total || a.name.localeCompare(b.name))
}

async function findSkillDir($: EngineInterface, skill: string): Promise<string> {
  const home = (await $.process.run(['sh', '-c', 'printf %s "$HOME"']).catch(() => ({ stdout: '' }))).stdout
  const root = await $.session.root().catch(() => '')
  const candidates = [`${home}/.claude/skills/${skill}`, `${home}/.agents/skills/${skill}`, `${root}/.claude/skills/${skill}`]
  for (const dir of candidates) {
    const found = await $.fs.read(`${dir}/SKILL.md`).then(() => true, () => false)
    if (found) return dir
  }
  return ''
}

async function refreshSkills($: EngineInterface): Promise<void> {
  const messages = await $.session.messages()
  const hits = collectSkillHits(Array.isArray(messages) ? messages : [])
  for (const hit of hits) {
    if (!hit.baseDir && !hit.skill.includes(':')) hit.baseDir = await findSkillDir($, hit.skill).catch(() => '')
    Object.assign(hit, classifySkill(hit.skill, hit.baseDir))
    if (!hit.baseDir) continue
    const md = await $.fs.read(`${hit.baseDir}/SKILL.md`).catch(() => '')
    hit.description = descriptionOf(String(md))
    hit.matched = matchedPhrases(hit.description, hit.prompt)
  }
  await update($, skillHits, () => hits)
  await update($, skillsAt, () => timeNow())
}

type DecisionInput = {
  id?: unknown
  question?: unknown
  options?: unknown
  recommended?: unknown
  status?: unknown
  answer?: unknown
  decidedBy?: unknown
}

/** id 가 있으면 그 항목을 고치고, 없으면 새 id(d1, d2 …)로 넣는다. 결정될 때 사용자 답변 원문을 붙인다 */
export function applyDecisions(
  list: Decision[],
  inputs: DecisionInput[],
  context: { t: number; at: string; turn: number; userQuote: string; source: Decision['source'] },
): { list: Decision[]; ids: string[] } {
  const next = [...list]
  const ids: string[] = []
  let serial = next.reduce((max, one) => Math.max(max, Number(one.id.replace(/\D/g, '')) || 0), 0)
  for (const input of inputs) {
    const status = (['pending', 'decided', 'dropped'] as const).includes(input.status as Decision['status'])
      ? (input.status as Decision['status'])
      : 'pending'
    const id = typeof input.id === 'string' && input.id ? input.id : ''
    const at = next.findIndex(one => one.id === id)
    const options = Array.isArray(input.options) ? input.options.map(String) : undefined
    if (at >= 0) {
      const old = next[at] as Decision
      const isClosing = status !== 'pending' && old.status === 'pending'
      next[at] = {
        ...old,
        decidedBy: input.decidedBy === 'claude' || input.decidedBy === 'user' ? input.decidedBy : old.decidedBy,
        quoteTurn: isClosing ? context.turn : old.quoteTurn,
        question: typeof input.question === 'string' && input.question ? input.question : old.question,
        options: options ?? old.options,
        recommended: typeof input.recommended === 'string' ? input.recommended : old.recommended,
        status,
        answer: typeof input.answer === 'string' && input.answer ? input.answer : old.answer,
        userQuote: isClosing ? context.userQuote : old.userQuote,
        decidedAt: isClosing ? context.at : status === 'pending' ? '' : old.decidedAt,
      }
      ids.push(old.id)
      continue
    }
    serial += 1
    const decidedBy: Decision['decidedBy'] = input.decidedBy === 'claude' ? 'claude' : 'user'
    const created: Decision = {
      id: id || `d${serial}`,
      t: context.t,
      at: context.at,
      turn: context.turn,
      decidedBy,
      quoteTurn: status === 'pending' || decidedBy === 'claude' ? 0 : context.turn,
      question: String(input.question ?? ''),
      options: options ?? [],
      recommended: String(input.recommended ?? ''),
      status,
      answer: String(input.answer ?? ''),
      userQuote: status === 'pending' || decidedBy === 'claude' ? '' : context.userQuote,
      decidedAt: status === 'pending' ? '' : context.at,
      source: context.source,
    }
    next.push(created)
    ids.push(created.id)
  }
  return { list: next.slice(-200), ids }
}

/** AskUserQuestion 결과에서 질문별 답을 꺼낸다 */
export function askAnswers(result: unknown, text: string): Record<string, string> {
  const answers = (result as { answers?: Record<string, unknown> } | undefined)?.answers
  if (answers && typeof answers === 'object' && Object.keys(answers).length > 0) {
    return Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, String(value)]))
  }
  return Object.fromEntries([...text.matchAll(/"([^"]+)"="([^"]*)"/g)].map(m => [m[1] ?? '', m[2] ?? '']))
}

/** CI 상태 묶음을 하나로 줄인다: 하나라도 실패면 fail, 진행 중이 있으면 pending, 모두 성공이면 pass */
export function ciOf(rollup: unknown): 'pass' | 'fail' | 'pending' | 'none' {
  const checks = Array.isArray(rollup) ? (rollup as { status?: string; conclusion?: string; state?: string }[]) : []
  if (checks.length === 0) return 'none'
  const results = checks.map(check => (check.conclusion || check.state || check.status || '').toUpperCase())
  if (results.some(r => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(r))) return 'fail'
  if (results.some(r => ['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'EXPECTED'].includes(r))) return 'pending'
  return 'pass'
}

/** fetchMeta 가 낸 출력(첫 줄 pr|issue, 다음 줄 gh --json 결과)을 읽는다 */
export function parseMeta(output: string): IssueMeta {
  const cut = output.indexOf('\n')
  const kind = (cut < 0 ? output : output.slice(0, cut)).trim()
  try {
    const data = JSON.parse(cut < 0 ? '{}' : output.slice(cut + 1)) as Record<string, unknown>
    const isPull = kind === 'pr'
    return {
      title: String(data.title ?? ''),
      state: String(data.state ?? '').toLowerCase(),
      isPull,
      stateReason: String(data.stateReason ?? '').toLowerCase(),
      isDraft: Boolean(data.isDraft),
      branch: String(data.headRefName ?? ''),
      additions: Number(data.additions ?? 0),
      deletions: Number(data.deletions ?? 0),
      ci: isPull ? ciOf(data.statusCheckRollup) : 'none',
    }
  } catch {
    return { error: '응답을 읽지 못함' }
  }
}

async function fetchMeta($: EngineInterface, ref: IssueRef): Promise<IssueMeta> {
  const script = [
    'if [ -n "$1" ]; then t=$(gh auth token --user "$1" 2>/dev/null); [ -n "$t" ] && export GH_TOKEN="$t"; fi',
    'kind=$(gh api "repos/$2/$3/issues/$4" --jq \'if .pull_request then "pr" else "issue" end\') || exit 1',
    'echo "$kind"',
    'if [ "$kind" = pr ]; then gh pr view "$4" --repo "$2/$3" --json title,state,isDraft,headRefName,additions,deletions,statusCheckRollup;',
    'else gh issue view "$4" --repo "$2/$3" --json title,state,stateReason; fi',
  ].join('\n')
  const ran = await $.process.run(['sh', '-c', script, 'sh', githubUser, ref.owner, ref.repo, String(ref.number)], {
    timeoutMs: 20000,
  })
  if (ran.exitCode !== 0) return { error: ran.stderr.trim().split('\n')[0] ?? '읽지 못함' }
  return parseMeta(ran.stdout)
}

/** 맨 앞 상태 표시: 기호, 낱말, 색 */
export function stateBadge(meta: IssueMeta | undefined, isPull: boolean): { text: string; color: string | undefined } {
  if (!meta || 'error' in meta) return { text: isPull ? '⎇ ?' : '◌ ?', color: undefined }
  if (meta.isPull) {
    if (meta.state === 'merged') return { text: '⎇ 머지됨', color: 'merged' }
    if (meta.state === 'closed') return { text: '⎇ 닫힘', color: 'error' }
    if (meta.isDraft) return { text: '⎇ 초안', color: 'subtle' }
    return { text: '⎇ 열림', color: 'success' }
  }
  if (meta.state === 'open') return { text: '◉ 열림', color: 'success' }
  if (meta.stateReason === 'not_planned') return { text: '⊘ 닫힘', color: 'subtle' }
  return { text: '✓ 완료', color: 'merged' }
}

const CI_BADGE: Record<'pass' | 'fail' | 'pending' | 'none', { text: string; color: string | undefined }> = {
  pass: { text: '✓ CI', color: 'success' },
  fail: { text: '✗ CI', color: 'error' },
  pending: { text: '○ CI', color: 'warning' },
  none: { text: '○ CI', color: 'subtle' },
}

async function refreshIssues($: EngineInterface): Promise<void> {
  const messages = await $.session.messages()
  const list = collectIssues(Array.isArray(messages) ? messages : [])
  await update($, issues, () => list)
  await update($, issuesAt, () => timeNow())
  for (const ref of list) {
    const meta = await fetchMeta($, ref).catch(() => ({ error: '읽지 못함' }) as IssueMeta)
    await update($, issueMeta, all => ({ ...all, [ref.key]: meta }))
  }
}

export function purposeOf(sql: string): string {
  return sql
    .split(/;\s*\n/)
    .map(statement => statement.match(/--\s*조회\s*목적\s*[:：]\s*(.+)/)?.[1]?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
}

export function databaseOf(command: string): string {
  return command.match(/(?:-D|--database)[\s=]+([\w.-]+)/)?.[1] ?? '-'
}

export function sqlOf(command: string): string {
  const quoted = [...command.matchAll(/run_query\.py[^"'\n]*?(["'])([\s\S]*?)\1/g)]
    .map(match => match[2]?.trim() ?? '')
    .filter(Boolean)
  if (quoted.length > 0) return quoted.join(';\n\n')
  const heredoc = command.match(/<<-?\s*'?(\w+)'?\n([\s\S]*?)\n\1/)
  if (heredoc?.[2]) return heredoc[2].trim()
  return command.trim()
}

export function tablesOf(sql: string): string {
  const names = [...sql.matchAll(/\b(?:from|join)\s+([`\w.]+)/gi)]
    .map(match => (match[1] ?? '').replace(/`/g, '').split('.').pop() ?? '')
    .filter(name => name && !/^(select|dual)$/i.test(name))
  const unique = [...new Set(names)]
  return unique.length > 0 ? unique.join(', ') : '-'
}

/** 요청을 한 줄로 줄인다. 짧으면 그대로 쓴다 */
export function shortSummary(prompt: string): string {
  const one = prompt.replace(/\s+/g, ' ').trim()
  return one.length <= SUMMARY_LIMIT ? one : `${one.slice(0, SUMMARY_LIMIT)}…`
}

async function summarizeTurn($: EngineInterface, turn: Turn): Promise<void> {
  if (turn.prompt.length <= SUMMARY_LIMIT) return
  const reply = await $.model.complete({
    model: 'haiku',
    system: '사용자 요청을 30자 안팎의 한국어 한 줄로 요약한다. 요약문 한 줄만 답한다. 따옴표나 마침표를 붙이지 않는다.',
    prompt: turn.prompt.slice(0, 4000),
    maxTokens: 80,
    timeoutMs: 20000,
  })
  if (!reply.isAnswered) return
  const summary = reply.text.split('\n')[0]?.trim() ?? ''
  if (summary) await update($, turns, list => list.map(one => (one.n === turn.n ? { ...one, summary } : one)))
}

async function currentTurn($: EngineInterface): Promise<number> {
  return (await read($, turns)).at(-1)?.n ?? 0
}

/** 화면 칸 수: 한글 등 넓은 글자는 2칸으로 센다 */
export function columnsOf(text: string): number {
  let width = 0
  for (const char of text) width += /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1
  return width
}

/** ── 제목 ──── 형태의 구분선 */
export function separator(title: string, width: number): string {
  const head = `── ${title} `
  return head + '─'.repeat(Math.max(2, width - columnsOf(head)))
}

const BOX_MARK: Record<PlanStep['status'], string> = { todo: ' ', doing: '▶', done: '✓', skipped: '✗' }

export function levelsOf(steps: PlanStep[]): number[] {
  const levels: number[] = []
  steps.forEach((step, index) => {
    const parents = (step.after ?? []).filter(n => n >= 1 && n <= index).map(n => levels[n - 1] ?? 0)
    levels[index] = parents.length > 0 ? Math.max(...parents) + 1 : 0
  })
  return levels
}

/** [✓ 계획] ──> [▶ 수정] + [ 검토] ──> [ 승인] 형태. 같은 단계에서 나란히 하는 일은 + 로 잇는다 */
export function planDiagram(steps: PlanStep[], width: number): string {
  const levels = levelsOf(steps)
  const groups: string[][] = []
  steps.forEach((step, index) => {
    const label = step.label || (step.text.length > 12 ? `${step.text.slice(0, 12)}…` : step.text)
    ;(groups[levels[index] ?? 0] ??= []).push(`[${BOX_MARK[step.status]} ${label}]`)
  })
  const lines: string[] = []
  let line = ''
  groups.forEach((group, index) => {
    const part = group.join(' + ')
    const joint = index === 0 ? '' : ' ──> '
    if (line && columnsOf(line + joint + part) > width) {
      lines.push(line)
      line = `  ──> ${part}`
    } else {
      line += joint + part
    }
  })
  if (line) lines.push(line)
  return lines.join('\n')
}

async function recordRead($: EngineInterface, file: string): Promise<void> {
  const turn = await currentTurn($)
  await update($, reads, list => {
    const last = list.at(-1)
    if (last && last.turn === turn) {
      return last.files.includes(file) ? list : [...list.slice(0, -1), { ...last, files: [...last.files, file] }]
    }
    const entry: ReadEntry = { id: `r${Date.now()}`, t: Date.now(), at: timeNow(), turn, files: [file], purpose: '', result: '' }
    return [...list, entry].slice(-100)
  })
}

export function planText(plan: Plan): string {
  return plan.steps
    .map((step, index) => {
      const from = (step.after ?? []).length > 0 ? ` ← ${(step.after ?? []).join(', ')}` : ''
      return `${STEP_MARK[step.status]} ${index + 1}. ${step.text}${from}`
    })
    .join('\n')
}

/** 같은 목표의 계획은 처음 기록한 자리에서 마지막 상태로 덮어쓴다. 목표가 다르면 새로 넣는다 */
export function upsertPlan(list: Plan[], plan: Plan): Plan[] {
  const same = list.findIndex(one => one.goal === plan.goal)
  if (same < 0) return [...list, plan].slice(-50)
  return list.map((one, index) => (index === same ? { ...plan, id: one.id, t: one.t, at: one.at, turn: one.turn } : one))
}

/** `cd <dir>` 들이 가리키는 디렉토리. 따옴표 하나와 `~` 만 다룬다 */
export function cdTargetsOf(command: string): string[] {
  return [...command.matchAll(/(?:^|&&|;|\|\||\n)\s*cd\s+(["']?)([^"'&;|\n]+?)\1\s*(?=$|&&|;|\|\||\n)/g)]
    .map(match => match[2]?.trim() ?? '')
    .filter(Boolean)
}

export function parseWorktrees(porcelain: string): { path: string; branch: string }[] {
  return porcelain
    .split('\n\n')
    .map(block => {
      const path = block.match(/^worktree (.+)$/m)?.[1] ?? ''
      const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? (/^detached$/m.test(block) ? '(detached)' : '')
      return { path, branch }
    })
    .filter(one => one.path)
}

function isInside(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(`${root}/`)
}

function relativeTo(path: string, root: string): string {
  if (path === root) return '.'
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function timeNow(): string {
  return new Date().toLocaleTimeString('ko-KR', { hour12: false })
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut) : path
}

async function resolveDir($: EngineInterface, target: string, base: string): Promise<string | undefined> {
  const shell = await $.process.run(
    ['sh', '-c', 'p="$1"; case "$p" in "~"*) p="$HOME${p#\\~}";; esac; cd "$p" 2>/dev/null && pwd -P', 'sh', target],
    { cwd: base },
  )
  const out = shell.exitCode === 0 ? shell.stdout.trim() : ''
  return out || undefined
}

async function rememberPlace($: EngineInterface, dir: string | undefined): Promise<boolean> {
  if (!dir) return false
  const known = await read($, places)
  if (known.includes(dir)) return false
  await update($, places, list => [...list, dir].slice(-100))
  return true
}

async function repoRootOf($: EngineInterface, dir: string): Promise<string | undefined> {
  const listed = await $.process.run(['git', '-C', dir, 'worktree', 'list', '--porcelain'])
  if (listed.exitCode !== 0) return undefined
  return parseWorktrees(listed.stdout)[0]?.path
}

async function refreshTree($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const used = [...new Set([cwd, ...(await read($, places))])]
  const roots: string[] = []
  for (const dir of used) {
    const root = await repoRootOf($, dir).catch(() => undefined)
    if (root && !roots.includes(root)) roots.push(root)
  }
  const repos: RepoView[] = []
  for (const root of roots) {
    const listed = await $.process.run(['git', '-C', root, 'worktree', 'list', '--porcelain'])
    const entries = parseWorktrees(listed.stdout)
    const worktrees: Worktree[] = []
    for (const [index, entry] of entries.entries()) {
      const nested = entries.filter(other => other.path !== entry.path && isInside(other.path, entry.path))
      const owns = (dir: string) => isInside(dir, entry.path) && !nested.some(other => isInside(dir, other.path))
      const isUsed = used.some(owns)
      const status = isUsed
        ? await $.process.run(['git', '-C', entry.path, 'status', '--porcelain']).catch(() => undefined)
        : undefined
      worktrees.push({
        path: entry.path,
        branch: entry.branch || '(branch 없음)',
        isMain: index === 0,
        isUsed,
        isCwd: owns(cwd),
        changes: status && status.exitCode === 0 ? status.stdout.split('\n').filter(Boolean).length : null,
      })
    }
    repos.push({ root, worktrees })
  }
  await update($, tree, () => ({ at: timeNow(), cwd, isCwdRepo: roots.some(root => isInside(cwd, root)), repos }))
}

/** VS Code 로 폴더를 연다. code 명령이 없으면 macOS 의 open 으로 앱을 부른다 */
export const OPEN_IN_VSCODE = [
  'if command -v code >/dev/null 2>&1; then code "$1";',
  'elif [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "$1";',
  'else open -a "Visual Studio Code" "$1"; fi',
].join(' ')

async function openInVsCode($: EngineInterface, path: string): Promise<void> {
  const ran = await $.process.run(['sh', '-c', OPEN_IN_VSCODE, 'sh', path], { timeoutMs: 15000 }).catch(error => ({
    exitCode: 1,
    stdout: '',
    stderr: String(error),
  }))
  $.ui.toast(ran.exitCode === 0 ? `VS Code 로 열었다: ${path}` : `VS Code 로 열지 못했다: ${ran.stderr.trim().split('\n')[0] ?? ''}`)
}

async function noteTool($: EngineInterface, e: { tool: string } & Record<string, unknown>): Promise<void> {
  const cwd = await $.session.cwd()
  const targets: string[] = []
  if (e.tool === 'Bash' && typeof e.command === 'string') targets.push(...cdTargetsOf(e.command))
  if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(e.tool)) {
    const file = typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : ''
    if (file) targets.push(dirOf(file))
  }
  let isNew = false
  for (const target of targets) {
    const dir = await resolveDir($, target, cwd).catch(() => undefined)
    if (await rememberPlace($, dir)) isNew = true
  }
  if (isNew || e.tool === 'Bash') await refreshTree($)
}

async function record($: EngineInterface, e: { command: string; description?: string; tool_use_id: string }): Promise<QueryRun> {
  let sql = sqlOf(e.command)
  const file = e.command.match(/--file[\s=]+(\S+)/)?.[1]
  if (file) {
    sql = await $.fs.read(file).then(
      text => `-- ${file}\n${String(text).trim()}`,
      () => `-- ${file} (파일을 읽지 못함)\n${sql}`,
    )
  }
  const run: QueryRun = {
    id: e.tool_use_id,
    turn: await currentTurn($),
    t: Date.now(),
    at: timeNow(),
    goal: e.description?.trim() || '(목표 설명 없음)',
    purpose: purposeOf(sql),
    database: databaseOf(e.command),
    tables: tablesOf(sql),
    sql,
    status: 'running',
    output: '',
  }
  await update($, runs, list => [...list, run].slice(-50))
  await update($, tab, () => 'log' as TabId)
  void $.ui.open({ id: LOG_PANE, title: 'Blackbox' }).catch(() => undefined)

  return run
}

async function finish($: EngineInterface, run: QueryRun, ran: ToolCallResult<'Bash'>): Promise<void> {
  const finished: Partial<QueryRun> =
    ran.deny !== undefined
      ? { status: 'denied', output: ran.deny }
      : {
          status: ran.isError ? 'failed' : 'done',
          output: ran.isError
            ? String(ran.text ?? '')
            : [ran.result?.stdout, ran.result?.stderr].filter(Boolean).join('\n'),
        }
  await update($, runs, list => list.map(one => (one.id === run.id ? { ...one, ...finished } : one)))
}

export const register: Register = (on, options) => {
  githubUser = typeof options?.githubUser === 'string' ? options.githubUser : ''

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'blackbox-mods',
      description: 'Blackbox 패널을 연다 (탭: 세션 로그·결정 사항·깃헙·워크 트리·스킬 사용량)',
    })
    await $.tool.register({
      name: PLAN_TOOL,
      description:
        'Claude 가 할 작업들을 사용자가 보는 Blackbox 패널에 기록한다. 여러 단계 작업을 시작하기 전에 목표와 단계를 보내고, 단계 상태가 바뀔 때마다 같은 목표로 전체 단계를 다시 보낸다(같은 목표는 한 항목으로 갱신된다). 나란히 할 수 있는 단계는 after 로 같은 앞 단계를 가리킨다.',
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '무엇을 밝히거나 만들려는지 한 문장. 같은 계획을 갱신할 때는 같은 문장을 쓴다' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: '단계 하나: 무엇을 어떻게 하는지' },
                label: { type: 'string', description: '다이어그램 상자에 쓸 10자 안팎의 짧은 이름' },
                status: { type: 'string', enum: ['todo', 'doing', 'done', 'skipped'] },
                after: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: '이 단계가 기다리는 앞 단계 번호(1부터). 빈 배열이면 시작 단계. 빼면 바로 앞 단계',
                },
              },
              required: ['text', 'status'],
            },
          },
        },
        required: ['goal', 'steps'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: DECISION_TOOL,
      description:
        '결정 사항을 Blackbox 의 결정 사항 탭에 기록한다. 사용자가 정할 항목은 id 없이 status pending, decidedBy user 로 보낸다(도구가 d1, d2 … id 를 돌려준다). Claude 가 스스로 정한 항목은 status decided, decidedBy claude 로 보낸다. 사용자가 답하면 같은 id 로 status decided 또는 dropped 와 answer 를 보낸다. 사용자 답변 원문은 도구가 붙인다.',
      inputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '갱신할 항목의 id (d1 …). 새 항목이면 뺀다' },
                question: { type: 'string', description: '사용자가 정할 것, 한 문장' },
                options: { type: 'array', items: { type: 'string' }, description: '선택지' },
                recommended: { type: 'string', description: 'Claude 의 권장안' },
                status: { type: 'string', enum: ['pending', 'decided', 'dropped'] },
                answer: { type: 'string', description: '정해진 내용과 그 결과 한 일, 짧게 (decided·dropped 일 때)' },
                decidedBy: { type: 'string', enum: ['user', 'claude'], description: 'user: 사용자가 정할 것, claude: Claude 가 정한 것' },
              },
              required: ['status'],
            },
          },
        },
        required: ['items'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: READ_TOOL,
      description:
        '이 요청에서 Read 도구로 읽은 파일들을 왜 읽었고 읽고 무엇을 알았는지 Blackbox 에 남긴다. 목적과 결과를 각각 한두 줄로 보낸다. 파일 경로는 도구가 자동으로 모으므로 보낼 필요가 없다.',
      inputSchema: {
        type: 'object',
        properties: {
          purpose: { type: 'string', description: '파일을 읽은 목적, 한두 줄' },
          result: { type: 'string', description: '읽고 내린 결론, 한두 줄' },
        },
        required: ['purpose', 'result'],
      },
      isDeferred: false,
    })
    void refreshTree($).catch(() => undefined)
    void refreshIssues($).catch(() => undefined)
    void refreshSkills($).catch(() => undefined)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [
        ...composed.sections,
        { id: 'blackbox-mods:purpose', text: PURPOSE_RULE, scope: 'session' as const },
        { id: 'blackbox-mods:decisions', text: DECISION_RULE, scope: 'session' as const },
        { id: 'blackbox-mods:reads', text: READ_RULE, scope: 'session' as const },
      ],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const words = userWords(e.text)
    if (words) {
      await update($, lastPrompt, () => words).catch(() => undefined)
      const list = await read($, turns)
      const turn: Turn = { n: (list.at(-1)?.n ?? 0) + 1, t: Date.now(), at: timeNow(), prompt: words, summary: shortSummary(words) }
      await update($, turns, all => [...all, turn].slice(-200))
      void summarizeTurn($, turn).catch(() => undefined)
    }

    return next(e)
  })

  on('tool.call', { tool: `mcp__blackbox-mods__${DECISION_TOOL}` }, async ($, e) => {
    const input = e as unknown as { items?: unknown }
    const items = Array.isArray(input.items) ? (input.items as DecisionInput[]) : []
    const quote = await read($, lastPrompt)
    const turn = await currentTurn($)
    let ids: string[] = []
    await update($, decisions, list => {
      const applied = applyDecisions(list, items, { t: Date.now(), at: timeNow(), turn, userQuote: quote, source: 'tool' })
      ids = applied.ids
      return applied.list
    })
    await update($, tab, () => 'decisions' as TabId)
    void $.ui.open({ id: LOG_PANE, title: 'Blackbox' }).catch(() => undefined)
    const pending = (await read($, decisions)).filter(one => one.status === 'pending').length

    return { result: `결정 항목을 기록했다: ${ids.join(', ')} (대기 ${pending}건).` }
  })

  on('tool.call', { tool: `mcp__blackbox-mods__${READ_TOOL}` }, async ($, e) => {
    const input = e as unknown as { purpose?: unknown; result?: unknown }
    const turn = await currentTurn($)
    const purpose = String(input.purpose ?? '').trim()
    const result = String(input.result ?? '').trim()
    let isAttached = false
    await update($, reads, list => {
      const index = list.map(one => one.turn).lastIndexOf(turn)
      if (index < 0) return list
      isAttached = true
      return list.map((one, n) => (n === index ? { ...one, purpose, result } : one))
    })
    if (!isAttached) {
      const entry: ReadEntry = { id: `r${Date.now()}`, t: Date.now(), at: timeNow(), turn, files: [], purpose, result }
      await update($, reads, list => [...list, entry].slice(-100))
    }

    return { result: isAttached ? '읽은 파일의 목적과 결과를 기록했다.' : '이 요청에서 읽은 파일이 없어 목적과 결과만 기록했다.' }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      const questions = (e as unknown as { questions?: { question?: string; options?: { label?: string }[] }[] }).questions ?? []
      const answers = ran.deny === undefined ? askAnswers(ran.result, String(ran.text ?? '')) : {}
      const inputs: DecisionInput[] = questions.map(q => {
        const answer = answers[q.question ?? '']
        return {
          question: q.question ?? '',
          options: (q.options ?? []).map(option => option.label ?? ''),
          status: answer ? 'decided' : 'dropped',
          answer: answer ? `대화창에서 「${answer}」 선택` : '답하지 않음',
        }
      })
      const quote = Object.values(answers).join(' / ')
      const turn = await currentTurn($)
      await update($, decisions, list => applyDecisions(list, inputs, { t: Date.now(), at: timeNow(), turn, userQuote: quote, source: 'ask' }).list)
    } catch {
      // 기록만 빠진다
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) {
      await refreshIssues($).catch(() => undefined)
      await refreshSkills($).catch(() => undefined)
    }

    return ran
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const ran = await next(e)
    await refreshTree($).catch(() => undefined)

    return ran
  })

  on('tool.call', { tool: `mcp__blackbox-mods__${PLAN_TOOL}` }, async ($, e) => {
    const input = e as unknown as { goal?: unknown; steps?: unknown }
    const steps: PlanStep[] = Array.isArray(input.steps)
      ? input.steps.map((step, index) => ({
          text: String(step?.text ?? ''),
          label: typeof step?.label === 'string' ? step.label : '',
          after: Array.isArray(step?.after)
            ? step.after.map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= index)
            : index > 0
              ? [index]
              : [],
          status: (['todo', 'doing', 'done', 'skipped'] as const).includes(step?.status) ? step.status : 'todo',
        }))
      : []
    const plan: Plan = { id: e.tool_use_id, t: Date.now(), at: timeNow(), turn: await currentTurn($), goal: String(input.goal ?? ''), steps }
    await update($, plans, list => upsertPlan(list, plan))
    await update($, tab, () => 'log' as TabId)
    void $.ui.open({ id: LOG_PANE, title: 'Blackbox' }).catch(() => undefined)

    return { result: `계획을 Blackbox 패널에 기록했다 (${steps.length}단계).` }
  })

  on('command.run', { command: 'blackbox-mods' }, async $ => {
    await $.ui.open({ id: LOG_PANE, title: 'Blackbox' })
    await refreshTree($).catch(() => undefined)
    await refreshIssues($).catch(() => undefined)
    await refreshSkills($).catch(() => undefined)

    return { text: 'Blackbox 패널을 열었다. 위쪽 탭으로 세션 로그·결정 사항·깃헙·워크 트리·스킬 사용량을 바꿔 본다.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!QUERY_COMMAND.test(e.command)) return next(e)

    const run = await record($, e).catch(() => undefined)
    const ran = await next(e)
    if (run) await finish($, run, ran).catch(() => undefined)

    return ran
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'Read' && ran.deny === undefined && !ran.isError) {
      const file = (e as unknown as { file_path?: unknown }).file_path
      if (typeof file === 'string' && file) await recordRead($, file).catch(() => undefined)
    }
    if (['Bash', 'Read', 'Edit', 'Write', 'NotebookEdit'].includes(e.tool)) {
      await noteTool($, e as unknown as { tool: string } & Record<string, unknown>).catch(() => undefined)
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e) => {
    const { Box, Text, Button, Code, Markdown, Link } = $.ui.resolve(e)
    const current = await read($, tab)
    const width = Math.max(30, Math.min(100, (e.props?.bodyColumns ?? 80) - 2))
    const turnList = await read($, turns)
    const turnOf = (n: number) => turnList.find(one => one.n === n)
    const titleOf = (n: number, at: string) => {
      const turn = turnOf(n)
      return turn ? `[${turn.at}] ${turn.summary}` : `[${at}] (요청 기록 없음)`
    }
    const allDecisions = await read($, decisions)
    const entries = [
      ...(await read($, plans)).map(plan => ({ kind: 'plan' as const, t: plan.t, turn: plan.turn ?? 0, at: plan.at, plan })),
      ...(await read($, runs)).map(run => ({ kind: 'run' as const, t: run.t ?? 0, turn: run.turn ?? 0, at: run.at, run })),
      ...(await read($, reads)).map(entry => ({ kind: 'read' as const, t: entry.t, turn: entry.turn, at: entry.at, entry })),
    ].sort((x, y) => x.t - y.t)
    const logGroups: { key: string; title: string; items: typeof entries }[] = []
    for (const item of entries) {
      const key = item.turn > 0 ? `turn-${item.turn}` : `t-${item.t}`
      const last = logGroups.at(-1)
      if (last && last.key === key) last.items.push(item)
      else logGroups.push({ key, title: titleOf(item.turn, item.at), items: [item] })
    }
    const decisionGroups: { turn: number; title: string; items: Decision[] }[] = []
    for (const one of allDecisions) {
      const group = decisionGroups.find(g => g.turn === (one.turn ?? 0) && (one.turn ?? 0) > 0)
      if (group) group.items.push(one)
      else decisionGroups.push({ turn: one.turn ?? 0, title: turnOf(one.turn ?? 0)?.summary ?? `(요청 기록 없음) ${one.at}`, items: [one] })
    }
    decisionGroups.reverse()
    const pendingCount = allDecisions.filter(one => one.status === 'pending').length
    const quoteOf = (one: Decision) => {
      const quote = one.userQuote.replace(/\s+/g, ' ').trim()
      if (quote.length <= 60) return quote
      return turnOf(one.quoteTurn ?? 0)?.summary ?? `${quote.slice(0, 60)}…`
    }
    const view = await read($, tree)
    const list = await read($, issues)
    const metas = await read($, issueMeta)
    const issueAt = await read($, issuesAt)
    const hits = await read($, skillHits)
    const skillAt = await read($, skillsAt)
    const cut = (text: string, size: number) => (text.length > size ? `${text.slice(0, size)}…` : text)
    const choose = async (id: TabId) => {
      await update($, tab, () => id)
      if (id === 'tree') await refreshTree($).catch(() => undefined)
      if (id === 'issues') await refreshIssues($).catch(() => undefined)
      if (id === 'skills') await refreshSkills($).catch(() => undefined)
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          {TABS.map(one => (
            <Button
              key={`tab-${one.id}`}
              label={`${one.id === current ? '▶ ' : '  '}${one.label}${one.id === 'decisions' && pendingCount > 0 ? ` (${pendingCount})` : ''}`}
              dimColor={one.id !== current}
              onPress={() => choose(one.id)}
            />
          ))}
        </Box>
        {current === 'log' && (
          <Box flexDirection="column">
            {logGroups.length === 0 && <Text dimColor>아직 기록이 없다.</Text>}
            {logGroups.map(group => (
              <Box flexDirection="column" marginBottom={1}>
                <Text bold color="claude">{separator(group.title, width)}</Text>
                {group.items.map(item => {
                  if (item.kind === 'plan') {
                    return (
                      <Box flexDirection="column" marginTop={1}>
                        <Text>{`계획: ${item.plan.goal}`}</Text>
                        <Text bold>{planDiagram(item.plan.steps, width)}</Text>
                        <Text dimColor>{planText(item.plan)}</Text>
                      </Box>
                    )
                  }
                  if (item.kind === 'read') {
                    const entry = item.entry
                    return (
                      <Box flexDirection="column" marginTop={1}>
                        {entry.purpose ? <Text>{`목적: ${entry.purpose}`}</Text> : <Text dimColor>목적: (Claude 가 아직 정리하지 않음)</Text>}
                        {entry.files.length > 0 && <Text>읽은 파일:</Text>}
                        {entry.files.map(file => (
                          <Text dimColor>{`  ${file}`}</Text>
                        ))}
                        {entry.result ? <Text>{`결과: ${entry.result}`}</Text> : <Text dimColor>결과: (Claude 가 아직 정리하지 않음)</Text>}
                      </Box>
                    )
                  }
                  const run = item.run
                  const lines = run.output.split('\n')
                  const isCut = lines.length > OUTPUT_LINES
                  return (
                    <Box flexDirection="column" marginTop={1}>
                      <Text>{`목적: ${run.purpose || run.goal}`}</Text>
                      <Text>{`쿼리: (DB ${run.database} · 테이블 ${run.tables})`}</Text>
                      <Code source={run.sql} language="sql" />
                      <Text>{`결과:${run.status === 'failed' ? ' (실패)' : run.status === 'denied' ? ' (거부됨)' : ''}`}</Text>
                      {run.status === 'running' ? (
                        <Text dimColor>실행 중…</Text>
                      ) : (
                        <Markdown text={lines.slice(0, OUTPUT_LINES).join('\n')} />
                      )}
                      {isCut && <Text dimColor>{`결과 앞 ${OUTPUT_LINES}줄만 보인다 (전체 ${lines.length}줄)`}</Text>}
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        )}
        {current === 'decisions' && (
          <Box flexDirection="column">
            <Text dimColor>{pendingCount > 0 ? `결정 대기 ${pendingCount}건 · [ ] 대기  [x] 정해짐  [-] 취소` : '결정 대기 없음 · [x] 정해짐  [-] 취소'}</Text>
            {decisionGroups.length === 0 && <Text dimColor>아직 결정 사항이 없다.</Text>}
            {decisionGroups.map(group => (
              <Box flexDirection="column" marginTop={1}>
                <Text bold color="claude">{separator(group.title, width)}</Text>
                {group.items.map((one, index) => {
                  const box = one.status === 'pending' ? '[ ]' : one.status === 'decided' ? '[x]' : '[-]'
                  const result = one.status === 'dropped' ? ` => 취소${one.answer ? `: ${one.answer}` : ''}` : one.answer ? ` => ${one.answer}` : ''
                  return (
                    <Box flexDirection="column">
                      <Text bold={one.status === 'pending'} color={one.status === 'pending' ? 'warning' : undefined}>
                        {`${box} ${index + 1}. ${one.question}${one.status === 'pending' ? '' : result}${one.decidedBy === 'claude' ? '  (Claude 가 정함)' : ''}`}
                      </Text>
                      {one.status === 'pending' && (one.options.length > 0 || one.recommended) && (
                        <Text dimColor>{`    ${one.options.length > 0 ? `선택지: ${one.options.join(' / ')}` : ''}${one.options.length > 0 && one.recommended ? ' · ' : ''}${one.recommended ? `권장: ${one.recommended}` : ''}`}</Text>
                      )}
                      {one.status !== 'pending' && one.decidedBy === 'user' && one.userQuote && <Text dimColor>{`    -> ${quoteOf(one)}`}</Text>}
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        )}
        {current === 'tree' && (
            <Box flexDirection="column">
              <Box flexDirection="row">
                <Button key="refresh-tree" onPress={() => refreshTree($)}>새로고침</Button>
                <Text dimColor>{view ? `  ${view.at} 기준` : '  아직 읽지 않았다'}</Text>
              </Box>
              {view && (
                <Text>{`작업 디렉토리: ${view.cwd}${view.isCwdRepo ? '' : '  (git 저장소 아님)'}`}</Text>
              )}
              {view && view.repos.length === 0 && <Text dimColor>이 세션에서 사용한 git 저장소가 없다.</Text>}
              {view?.repos.map(repo => (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold>{repo.root}</Text>
                  {repo.worktrees.map((wt, index) => {
                    const branchLine = index === repo.worktrees.length - 1 ? '└─' : '├─'
                    const marks = [
                      wt.isMain ? '메인' : '',
                      wt.isCwd ? '작업 디렉토리' : wt.isUsed ? '사용 중' : '',
                      wt.changes !== null ? `변경 ${wt.changes}` : '',
                    ].filter(Boolean)
                    const row = (
                      <Text dimColor={!wt.isUsed} bold={wt.isUsed} color={wt.isUsed ? 'success' : undefined}>
                        {`${branchLine} ${wt.isUsed ? '●' : '○'} ${wt.branch}  ${relativeTo(wt.path, repo.root)}${marks.length > 0 ? `  [${marks.join(' · ')}]` : ''}`}
                      </Text>
                    )
                    if (!wt.isUsed) return row
                    return (
                      <Box flexDirection="row">
                        {row}
                        <Text>{'  '}</Text>
                        <Button key={`open-${wt.path}`} label="VS Code 로 열기" onPress={() => openInVsCode($, wt.path)} />
                      </Box>
                    )
                  })}
                </Box>
              ))}
            </Box>
        )}
        {current === 'issues' && (
            <Box flexDirection="column">
              <Box flexDirection="row">
                <Button key="refresh-issues" onPress={() => refreshIssues($)}>새로고침</Button>
                <Text dimColor>{issueAt ? `  ${issueAt} 기준 · ${list.length}건` : '  아직 읽지 않았다'}</Text>
              </Box>
              {issueAt && list.length === 0 && <Text dimColor>이 세션에서 다룬 GitHub 이슈·PR 이 없다.</Text>}
              {list.map(ref => {
                const meta = metas[ref.key]
                const hasMeta = meta !== undefined && !('error' in meta)
                const isPull = hasMeta ? meta.isPull : ref.isPull
                const url = ref.url.replace(/\/(issues|pull)\//, isPull ? '/pull/' : '/issues/')
                const badge = stateBadge(meta, ref.isPull)
                return (
                  <Box flexDirection="column" marginTop={1}>
                    <Box flexDirection="row">
                      <Text bold color={badge.color}>{`${badge.text}  `}</Text>
                      <Link href={url} label={`#${ref.number}`} />
                      <Text>{`  ${ref.repo}  `}</Text>
                      {hasMeta && meta.isPull && <Text dimColor>{`${meta.branch}  `}</Text>}
                      {hasMeta && meta.isPull && <Text color="success">{`+${meta.additions.toLocaleString('en-US')} `}</Text>}
                      {hasMeta && meta.isPull && <Text color="error">{`−${meta.deletions.toLocaleString('en-US')}  `}</Text>}
                      {hasMeta && meta.isPull && <Text color={CI_BADGE[meta.ci].color}>{CI_BADGE[meta.ci].text}</Text>}
                      {hasMeta && !meta.isPull && <Text dimColor>{cut(meta.title, 60)}</Text>}
                    </Box>
                    {hasMeta && meta.isPull && <Text dimColor>{`      ${cut(meta.title, 80)}`}</Text>}
                    {!hasMeta && <Text dimColor>{`      ${meta && 'error' in meta ? `읽지 못함: ${meta.error}` : '읽는 중…'}`}</Text>}
                  </Box>
                )
              })}
            </Box>
        )}
        {current === 'skills' && (
            <Box flexDirection="column">
              <Box flexDirection="row">
                <Button key="refresh-skills" onPress={() => refreshSkills($)}>새로고침</Button>
                <Text dimColor>{skillAt ? `  ${skillAt} 기준 · 전체 ${hits.length}회` : '  아직 읽지 않았다'}</Text>
              </Box>
              {skillAt && hits.length === 0 && <Text dimColor>이 세션에서 실행된 스킬이 없다.</Text>}
              {groupSkillHits(hits).map(group => (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold color={group.kind === 'plugin' ? 'claude' : group.kind === 'custom' ? 'suggestion' : undefined}>
                    {`${group.kind === 'plugin' ? '플러그인 ' : ''}${group.name}  ${group.total}회 · ${Math.round((group.total / hits.length) * 100)}%`}
                  </Text>
                  {group.skills.map((one, index) => (
                    <Box flexDirection="column">
                      <Text bold>{`  ${index + 1}. ${one.skill}  ${one.count}회 · ${Math.round((one.count / hits.length) * 100)}%`}</Text>
                      {one.hits.map((hit, n) => (
                        <Text dimColor>
                          {`     ${n + 1}) 턴 ${hit.turn} · ${hit.trigger === 'slash' ? '슬래시' : 'Claude 판단'} · 「${cut(hit.prompt || '(요청 없음)', 60)}」${hit.matched.length > 0 ? ` · 일치: ${hit.matched.map(m => `「${m}」`).join(', ')}` : ''}`}
                        </Text>
                      ))}
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
        )}
      </Box>
    )
  })
}
