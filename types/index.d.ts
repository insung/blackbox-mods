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

/** Claude 가 실행한 명령(DB 쿼리 제외) 또는 바꾼 파일 하나 */
export type ActionEntry = {
  id: string
  t: number
  at: string
  turn: number
  /** agent: 하위 에이전트에게 일을 맡긴 Agent 호출. 뒤따르는 하위 에이전트 기록의 목적이 된다 */
  kind: 'command' | 'file' | 'agent'
  /** command: 실행한 명령, file: 파일 경로, agent: 하위 에이전트 종류 */
  target: string
  /** command: Bash description, file: 수정·작성, agent: Agent description */
  note: string
  status: 'done' | 'failed' | 'denied'
  /** command: 출력 앞부분 (실패면 오류 글, 거부면 거부 이유). file: 빈 값 */
  output: string
  /** command: 출력 전체 줄 수 */
  outputLines: number
}

export type Worktree = {
  path: string
  branch: string
  /** 이 세션이 Edit·Write 로 바꾼 파일. 워크트리 기준 상대 경로, 처음 바꾼 순서 */
  files: string[]
}

export type RepoView = { root: string; worktrees: Worktree[] }

/** 이 세션이 파일을 바꾼 워크트리만 담는다 */
export type TreeView = { at: string; repos: RepoView[] }

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
  /** 어디서 나왔는지: 사용자 프롬프트, Claude 답변, gh issue view 처럼 실행한 gh 명령, 명령 결과, 커밋 */
  sources: string[]
  /** gh 명령으로 한 일: view, create, comment, close … */
  actions: string[]
}

/** 이 세션에서 Bash 로 실행한 git commit 하나 */
export type SessionCommit = {
  /** git commit 출력의 짧은 SHA */
  sha: string
  branch: string
  /** 커밋한 폴더의 origin 이 가리키는 GitHub owner/repo. 모르면 '' 또는 없음(예전 기록) */
  repo?: string
  subject: string
  /** 커밋 메시지에 적힌 이슈·PR 번호 (#N, Refs: #N) */
  refs: number[]
  /** 대화 위치(메시지 순번) */
  order: number
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

/** 아무도 묻지 않았지만 Claude 가 작업의 전제로 삼은 합의 하나 */
export type Agreement = {
  /** a1, a2 … 사용자가 `a1: 맞음` 처럼 답할 때 이 값으로 가리킨다 */
  id: string
  t: number
  at: string
  /** 항목이 나온 요청 */
  turn: number
  /** 합의 내용 한 문장 */
  statement: string
  /** 진행 전제, 범위, 용어, 작업 방식, 요청 해석, 답 형식 */
  kind: 'premise' | 'scope' | 'term' | 'method' | 'reading' | 'format'
  /** 이렇게 본 근거: 사용자 발언 인용 또는 관찰 */
  evidence: string
  /** assumed: Claude 의 추정, confirmed: 사용자가 맞다고 함, revoked: 사용자가 아니라고 함 */
  status: 'assumed' | 'confirmed' | 'revoked'
  /** 철회·확인 뒤 바뀐 전제와 그에 따라 할 일 */
  note: string
  /** 확인·철회될 때의 사용자 답변 원문 */
  userQuote: string
  /** 사용자 답변이 온 요청. 답변이 길면 이 요청의 요약을 보인다 */
  quoteTurn: number
  decidedAt: string
}

/** 노트 탭의 노트 하나: 사용자가 복사한 클립보드 글을 원문 그대로 담는다 */
export type Note = {
  id: string
  t: number
  at: string
  /** 담은 때의 요청. 요청 머리말로 묶을 때 쓴다 */
  turn: number
  /** 글을 가져온 곳. 지금은 클립보드뿐이다 */
  source: 'clipboard'
  /** 노트 머리에 보이는 짧은 제목. haiku 가 만들고, 만들기 전에는 빈 값 */
  title: string
  /** 담은 원문. 고친 노트인지 가릴 때 쓴다 */
  original: string
  /** 지금 글. 사용자가 노트 탭에서 고친다 */
  text: string
}

export type TabId = 'log' | 'decisions' | 'issues' | 'tree' | 'skills' | 'agreements' | 'notes'

/** 프로세스가 끝나도 남기는 패널 기록. 세션 시작 때 다시 계산하는 값(워크 트리, Git, 스킬 사용량)은 뺀다 */
export type SavedRecords = {
  turns: Turn[]
  reads: ReadEntry[]
  runs: QueryRun[]
  actions: ActionEntry[]
  places: string[]
  decisions: Decision[]
  agreements: Agreement[]
  notes: Note[]
  lastPrompt: string
  tab: TabId
  logPage: string
}

/** `$.store` 의 `session:<세션 id>` 키에 두는 값 */
export type SavedSession = {
  /** 저장 형식 판. 다른 판이면 복원하지 않는다 */
  v: 1
  /** 마지막으로 저장한 시각(ISO). 보관 기간과 삭제 순서를 이 값으로 정한다 */
  updatedAt: string
  records: SavedRecords
}

/** 보관 규칙을 정할 때 보는 다른 세션 기록 하나 */
export type StoredEntry = {
  key: string
  updatedAt: string
  /** 저장소 JSON 에서 이 항목이 차지하는 바이트 수 */
  bytes: number
}

declare module 'claude-code' {
  interface PluginState {
    'blackbox-mods': {
      turns: Turn[]
      reads: ReadEntry[]
      runs: QueryRun[]
      actions: ActionEntry[]
          places: string[]
      tree: TreeView | null
      issues: IssueRef[]
      issueMeta: Record<string, IssueMeta>
      issuesAt: string
      commits: SessionCommit[]
      skillHits: SkillHit[]
      skillsAt: string
      tab: TabId
      /** 세션 로그에서 보는 요청 묶음의 key. 빈 값이면 마지막 묶음을 따라간다 */
      logPage: string
      decisions: Decision[]
      agreements: Agreement[]
      /** 암묵적 합의 탭에서 한 번에 답하려고 고른 항목 id */
      pickedAgreements: string[]
      notes: Note[]
      /** 노트 탭에서 크게 보기로 펼친 노트 id */
      wideNotes: string[]
      /** 세션 로그에서 펼친 목적 묶음의 버튼 키 */
      openPurposes: string[]
      lastPrompt: string
    }
  }
}
