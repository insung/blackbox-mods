# blackbox-mods

[English](README.md)

Claude 가 무엇을 보고, 무엇을 정하고, 어디서 일했는지를 대화 옆 패널 하나에 기록하는 Claude Code mod 다.

`/blackbox-mods` 로 연다. 패널에는 탭 다섯 개가 있다.

| 탭 | 보이는 것 |
| --- | --- |
| 세션 로그 | 요청마다 구분선 하나(시각 + 한 줄 요약). 그 아래에 DB 쿼리(목적, SQL, 결과 표), Claude 가 읽은 파일(목적, 전체 경로, 결론), Edit·Write·NotebookEdit 로 바꾼 파일(작성·수정, 전체 경로), 그 밖의 Bash 명령(Bash description 으로 적은 목적, 앞 8줄까지 bash 로 강조한 명령, 출력 앞 5줄, 실패·거부 표시), 작업 계획(아스키 흐름도)이 쌓인다. 항목마다 종류(계획·파일 읽기·파일 수정·명령·쿼리)를 색 있는 머리줄로 보이고, 목적·실행·결과 같은 이름은 굵은 기울임으로 강조한다. 요청 묶음은 한 번에 하나씩 보이며 `◀ Prev`·`Next ▶` 로 넘긴다. 사이의 `현재 / 전체` 는 요청 묶음 수이고, 마지막 묶음을 보는 중이면 새 요청을 따라간다 |
| 결정 사항 | 사용자가 정할 항목(`[ ]`)과 Claude 가 스스로 정한 항목(`[x] … (Claude 가 정함)`)을 요청별로 보인다. 정해지면 같은 줄에 `=> 결과` 와 `-> 사용자 답변` 이 붙는다. 선택지 버튼을 누르면 프롬프트 창에 `d1: 선택지` 가 채워진다. 보내기는 사용자가 한다 |
| 깃헙 | 이 세션에서 다룬 이슈와 PR 을 앱의 PR 표시와 같은 순서로 보인다: 상태 · #번호 · 저장소 · 브랜치 · +추가 −삭제 · CI |
| 워크 트리 | 이 세션이 쓰는 git 워크트리를 저장소별 트리로 보인다. 사용 중인 워크트리에는 「VS Code 로 열기」 버튼이 있다 |
| 스킬 사용량 | 스킬 실행을 플러그인, 커스텀 스킬, 내장 스킬 묶음별 횟수와 비율로 보이고, 실행을 일으킨 요청을 발췌한다 |

## 설치

mod(hooks 모듈)를 지원하는 Claude Code 가 필요하다. Claude Code 2.1.295 에서 확인했다.

```bash
claude plugin marketplace add insung/blackbox-mods
```

```bash
claude plugin install blackbox-mods@blackbox-mods
```

이미 열린 세션에서는 `/reload-plugins` 를 실행한 뒤 `/blackbox-mods` 를 실행한다.

새 버전이 올라오면 아래로 갱신한다.

```bash
claude plugin update blackbox-mods@blackbox-mods
```

## Claude 에 더하는 것

패널을 채우기 위해, 모델이 부를 도구 세 개를 등록하고 시스템 프롬프트에 규칙을 넣는다.

| 도구 | 쓰임 |
| --- | --- |
| `mcp__blackbox-mods__show_plan` | 여러 단계 작업의 단계를 기록한다. 세션 로그 탭에 흐름도로 보인다 |
| `mcp__blackbox-mods__track_decisions` | 사용자가 정할 항목과 Claude 가 정한 항목, 그리고 각 항목이 어떻게 정해졌는지를 기록한다 |
| `mcp__blackbox-mods__note_reads` | 파일을 왜 읽었고 읽고 무엇을 알았는지 기록한다 |

시스템 프롬프트 규칙:

- SQL 문장마다 맨 앞에 `-- 조회 목적: <목적>` 주석을 붙인다. 패널은 이 주석을 쿼리 목적으로 보인다.
- 결정 항목은 `track_decisions` 로 등록하고, 사용자가 답하면 갱신한다. `d1: 선택지` 형식의 답은 `d1` 항목의 답이다.
- 파일을 읽고 결론을 냈으면 `note_reads` 로 목적과 결론을 보낸다.

도구를 부르지 않아도 자동으로 기록되는 것: `run_query.py` 나 `mysql` 을 실행한 Bash 명령, Read 도구로 읽은 파일, `AskUserQuestion` 답, 스킬 실행, 대화에 나온 GitHub 참조.

## 외부 호출

| 호출 | 시점 | 보내는 것 |
| --- | --- | --- |
| `gh api`, `gh pr view`, `gh issue view` | 깃헙 탭을 열거나 새로고침할 때, 그리고 턴이 끝날 때 | 각 참조의 저장소와 번호 |
| 모델 요약 (`haiku`, 사용 중인 Claude Code 세션을 거침) | 30자를 넘는 요청을 보낼 때 | 한 줄 요약을 만들기 위해 요청의 앞 4,000자를 한 번 |
| `git`, `code` (VS Code) | 워크 트리 탭, 「VS Code 로 열기」 버튼 | 로컬 명령만 실행한다 |

GitHub 이 404 로 답한 참조는 숨긴다.

## 설정

| 항목 | 기본값 | 뜻 |
| --- | --- | --- |
| `githubUser` | 빈 값 | 이슈와 PR 상태를 읽을 gh 계정(`gh auth token --user <값>`). 비우면 gh 기본 계정을 쓴다 |

`/plugin configure blackbox-mods@blackbox-mods` 로 정하거나, 설치할 때 `--config githubUser=<계정>` 을 붙인다.

## 알려진 한계

- 쿼리 판정과 조회 목적 규칙은 한 팀의 DB 도구(`run_query.py`, `mysql`)에 맞춰져 있다. 다른 도구의 쿼리는 아직 기록하지 않는다.
- 기록은 세션마다 따로 쌓인다. 세션끼리 공유하지 않는다.
- mod 가 로드되기 전에 보낸 요청은 요약이 없어서 「(요청 기록 없음)」 으로 묶인다.

## 개발

```bash
claude plugin validate .
```

```bash
npx -p typescript tsc -p .
```

```bash
claude plugin test .
```

`tsconfig.json` 은 `.claude-plugin/types/tsconfig.json` 을 상속한다. 이 파일은 Claude Code 가 mod 를 로드할 때 만든다. 그래서 `tsc` 를 실행하기 전에 mod 를 한 번 로드해야 한다(예: `claude --plugin-dir .`). MCP 도구 타입은 일부러 뺐다. 이 목록은 컴퓨터마다 다르고, 크면 타입 검사가 한도를 넘는다.

설치한 플러그인은 설치할 때 만든 복사본을 실행한다. 그래서 폴더를 고쳐도 설치본에는 반영되지 않는다. 고친 내용을 바로 보려면 설치본을 끄고, 폴더를 hot reload 하는 세션에서 로드한다: `claude --plugin-dir <폴더>`, 또는 세션의 mods 폴더(`~/.claude/dev-mods/<세션 id>/`).

## 라이선스

[MIT](LICENSE)
