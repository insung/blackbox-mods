/** 사용자 요청 하나. 기록을 요청별로 묶는 데 쓴다 */
export type Turn = {
  n: number
  t: number
  at: string
  prompt: string
  /** 한 줄 요약. 짧은 요청은 원문, 긴 요청은 모델 요약 */
  summary: string
}

export type QueryRun = {
  id: string
  /** 몇 번째 요청 중에 실행됐는지. 0 이면 요청 기록 전 */
  turn: number
  /** Date.now() 값. 기록 목록을 시간 순으로 섞는 데 쓴다 */
  t: number
  at: string
  goal: string
  /** 조회 목적: SQL 맨 앞의 `-- 조회 목적:` 주석 */
  purpose: string
  database: string
  tables: string
  sql: string
  status: 'running' | 'done' | 'failed' | 'denied'
  output: string
}

/** 한 요청 안에서 Read 도구로 읽은 파일 묶음과 Claude 가 정리한 목적·결론 */
export type ReadEntry = {
  id: string
  t: number
  at: string
  turn: number
  files: string[]
  purpose: string
  result: string
}

export type PlanStep = {
  text: string
  /** 다이어그램에 쓰는 짧은 이름 */
  label: string
  status: 'todo' | 'doing' | 'done' | 'skipped'
  /** 이 단계가 기다리는 앞 단계 번호(1부터). 빈 배열이면 시작 단계 */
  after: number[]
}

export type Plan = { id: string; t: number; at: string; turn: number; goal: string; steps: PlanStep[] }

export type Worktree = {
  path: string
  branch: string
  isMain: boolean
  isUsed: boolean
  isCwd: boolean
  /** 사용 중인 워크트리만 센다. 그 밖은 null */
  changes: number | null
}

export type RepoView = { root: string; worktrees: Worktree[] }

export type TreeView = { at: string; cwd: string; isCwdRepo: boolean; repos: RepoView[] }

export type IssueRef = {
  /** owner/repo#number */
  key: string
  owner: string
  repo: string
  number: number
  isPull: boolean
  url: string
  /** 처음 나온 대화 위치(메시지 순번). 목록을 이 순서로 보인다 */
  order: number
  /** 어디서 나왔는지: 사용자 프롬프트, Claude 답변, 명령 결과 */
  sources: string[]
  /** gh 명령으로 한 일: view, create, comment, close … */
  actions: string[]
}

export type IssueMeta =
  | {
      title: string
      /** 이슈: open·closed, PR: open·closed·merged */
      state: string
      isPull: boolean
      /** 이슈를 닫은 이유: completed·not_planned·reopened … */
      stateReason: string
      isDraft: boolean
      branch: string
      additions: number
      deletions: number
      /** PR 의 CI: pass·fail·pending·none */
      ci: 'pass' | 'fail' | 'pending' | 'none'
    }
  /** notFound: GitHub 이 404 로 답함. 목록에서 숨긴다 */
  | { error: string; notFound?: boolean }

export type SkillHit = {
  /** 대화에서 나온 순서(메시지 순번) */
  order: number
  /** 사용자 프롬프트 기준 몇 번째 턴인지 */
  turn: number
  skill: string
  args: string
  /** Claude 판단(Skill 도구) | 사용자 슬래시 명령 */
  trigger: 'model' | 'slash'
  /** 직전 사용자 요청(앞부분) */
  prompt: string
  /** Skill 도구를 부르기 직전 Claude 가 쓴 문장 */
  claudeNote: string
  /** 스킬 폴더 (Skill 도구 결과의 Base directory) */
  baseDir: string
  description: string
  /** description 의 예시 문구 중 요청에 들어 있던 것 */
  matched: string[]
  /** 묶음: 플러그인, 커스텀(.claude/skills·.agents/skills), Claude Code 내장 */
  group: 'plugin' | 'custom' | 'builtin'
  /** 플러그인 이름. 그 밖에는 빈 값 */
  plugin: string
}

export type SkillGroup = {
  kind: SkillHit['group']
  name: string
  total: number
  skills: { skill: string; count: number; hits: SkillHit[] }[]
}

export type Decision = {
  /** d1, d2 … Claude 가 갱신할 때 이 값으로 가리킨다 */
  id: string
  t: number
  at: string
  /** 항목이 나온 요청 */
  turn: number
  question: string
  options: string[]
  recommended: string
  status: 'pending' | 'decided' | 'dropped'
  /** 어떻게 정해졌는지: Claude 가 정리한 결정 내용 */
  answer: string
  /** 정해질 때의 사용자 답변 원문 */
  userQuote: string
  decidedAt: string
  /** 사용자 답변이 온 요청. 답변이 길면 이 요청의 요약을 보인다 */
  quoteTurn: number
  /** user: 사용자가 정할 것, claude: Claude 가 정하고 알리기만 한 것 */
  decidedBy: 'user' | 'claude'
  /** tool: Claude 가 등록, ask: AskUserQuestion 대화창 */
  source: 'tool' | 'ask'
}

export type TabId = 'log' | 'decisions' | 'issues' | 'tree' | 'skills'

declare module 'claude-code' {
  interface PluginState {
    'blackbox-mods': {
      turns: Turn[]
      reads: ReadEntry[]
      runs: QueryRun[]
      plans: Plan[]
      places: string[]
      tree: TreeView | null
      issues: IssueRef[]
      issueMeta: Record<string, IssueMeta>
      issuesAt: string
      skillHits: SkillHit[]
      skillsAt: string
      tab: TabId
      decisions: Decision[]
      lastPrompt: string
    }
  }
}
