# 외부 접속 및 멀티기기 대응 계획서

## 1. 목적

Cloudflare Tunnel로 외부 기기에서 WikiSpeedRun에 접속할 수 있게 된 이후, 단순히 화면을 여는 것을 넘어 여러 사용자가 같은 조건에서 공정하게 겨루는 구조를 만든다.

현재 구현은 로컬 서버가 나무위키 문서를 정제하고, Cloudflare Tunnel이 같은 서버를 외부에 노출한다. 세션 랭킹도 서버 메모리에 쌓이므로 외부 사용자들이 같은 랭킹을 볼 수 있다. 다음 단계의 목표는 랭킹 공유를 넘어, 같은 라운드, 같은 출발/목표, 서버 기준 시간, 서버 검증 로그를 갖춘 가벼운 멀티플레이 플랫폼으로 확장하는 것이다.

## 2. 현재 상태

구현됨:

- Cloudflare Quick Tunnel 실행 스크립트
- 프로덕션 서버 단일 포트 제공: `http://127.0.0.1:3002`
- 나무위키 문서 fetch, 파싱, 캐시
- 캐주얼/연습 모드
- 아예랜덤
- 본문 링크 클릭 검증: `POST /api/run/event`
- 서버 세션 랭킹: `GET /api/rankings`
- 플레이어 식별: `POST /api/players`
- 서버 권위형 run 시작: `POST /api/runs`
- 서버 검증 링크 이동: `POST /api/runs/:runId/link`
- 서버 검증 뒤로가기: `POST /api/runs/:runId/back`
- 서버 확정 완주: `POST /api/runs/:runId/finish`
- 결과 이미지 저장
- 뒤로가기 포함 번호형 탑다운 이동 로그

현재 한계:

- 각 사용자가 직접 새 제시어를 받으면 서로 다른 판을 플레이할 수 있다.
- 새로고침 후 진행 중인 run을 자동 복구하는 UI 흐름은 아직 없다.
- 실시간 진행 상태 공유가 없다.
- 방장/관리자 제어가 없다.
- Cloudflare URL을 아는 사람이 모두 접속할 수 있다.

## 3. 제품 방향

권장 방향은 "로컬 호스트가 방장이 되는 외부 공유형 스피드런"이다.

서비스를 완전히 클라우드 서버로 옮기는 것이 아니라, 한 사람이 로컬에서 앱을 켜고 Cloudflare Tunnel로 링크를 공유한다. 다른 사용자들은 브라우저로 접속한다. 서버는 로컬 PC에 있지만, 게임 진행과 랭킹은 그 서버가 권위 있게 관리한다.

핵심 원칙:

- 같은 라운드는 같은 출발 문서와 목표 문서를 사용한다.
- 기록용 시간과 클릭 수는 서버 로그 기준으로 계산한다.
- 클라이언트는 "요청"만 하고, 서버가 플레이 상태를 확정한다.
- 랭킹은 서버가 켜진 세션 단위로 관리한다.
- 외부 공개 시 최소한 방 코드 또는 Cloudflare Access를 사용한다.

## 4. 목표 사용자 흐름

### 4.1 방장

1. 앱을 실행한다.
2. `외부 공유 시작` 또는 `npm run cloudflare:quick`을 실행한다.
3. 접속 URL과 방 코드를 공유한다.
4. 참가자가 들어오면 대기실에서 목록을 본다.
5. `새 라운드` 버튼으로 출발/목표를 생성한다.
6. `카운트다운 시작`을 누른다.
7. 모든 사용자가 같은 시간에 시작한다.
8. 완주 결과와 진행 상황을 관전한다.
9. 필요하면 `라운드 리셋`, `랭킹 초기화`, `참가자 정리`를 수행한다.

### 4.2 플레이어

1. Cloudflare URL로 접속한다.
2. 닉네임을 입력하고 방 코드로 입장한다.
3. 대기실에서 현재 라운드 정보를 본다.
4. 카운트다운 후 플레이를 시작한다.
5. 본문 링크, 이전 문서, 문서 내 찾기를 사용해 목표 문서로 이동한다.
6. 서버가 완주를 확정하면 세션 랭킹에 반영된다.
7. 결과 이미지와 이동 로그를 저장하거나 공유한다.

### 4.3 관전자

1. 방 링크로 접속한다.
2. 관전자 모드로 들어간다.
3. 참가자별 현재 문서, 클릭 수, 시간, 완주 여부를 본다.
4. 라운드 결과와 이동 로그를 확인한다.

## 5. 우선 개발 범위

### 5.1 1차: 서버 권위형 기록

목표: 랭킹 POST를 클라이언트 제출형에서 서버 로그 확정형으로 바꾼다.

작업:

- 서버가 `playerId`를 발급한다. 완료
- 서버가 `runId`를 발급한다. 완료
- 플레이 시작 시 서버가 `startedAt`을 저장한다. 완료
- 모든 링크 이동과 뒤로가기를 서버에 이벤트로 저장한다. 완료
- 서버가 현재 문서와 routeSteps를 보관한다. 완료
- 완주 시 서버가 elapsedMs, clicks, score를 계산한다. 완료
- 랭킹 기록은 서버가 보유한 run 로그로만 생성한다. 완료
- 새로고침 후 active run 복구 UI를 추가한다. 남음

완료 기준:

- 클라이언트가 임의 routeSteps를 POST해 랭킹을 만들 수 없다.
- 새로고침 후에도 같은 `playerId`로 이어갈 수 있다.
- 서버가 꺼지면 모든 active run과 랭킹이 초기화된다.

### 5.2 2차: 방과 라운드

목표: 여러 기기가 같은 출발/목표를 공유한다.

작업:

- 기본 방 `main`을 만든다.
- 방 코드 생성 및 입장 API를 만든다.
- 방장 권한을 둔다.
- 방마다 `currentRound`를 저장한다.
- 라운드 상태를 `lobby`, `countdown`, `running`, `finished`로 관리한다.
- `새 라운드`, `아예랜덤 라운드`, `연습 라운드`를 서버에서 만든다.
- 참가자는 라운드 시작 전에는 문서를 못 누르게 한다.

완료 기준:

- 같은 방 참가자는 같은 start/target을 받는다.
- 이미 진행 중인 라운드에 늦게 들어온 사람은 관전 또는 다음 라운드 대기 상태가 된다.
- 방장이 새 라운드를 만들면 모든 사용자에게 반영된다.

### 5.3 3차: 실시간 상태 공유

목표: 누가 어디까지 갔는지 화면에서 바로 보인다.

처음에는 SSE(Server-Sent Events)를 추천한다.

이유:

- 서버에서 클라이언트로 상태를 뿌리기만 하면 된다.
- 채팅이나 양방향 제어가 없으면 WebSocket보다 단순하다.
- Express에서 구현이 쉽다.

작업:

- `GET /api/events` SSE 추가
- 랭킹 변경 이벤트
- 참가자 입장/퇴장 이벤트
- 현재 문서 변경 이벤트
- 라운드 상태 변경 이벤트

완료 기준:

- 다른 사용자가 완주하면 내 화면 랭킹이 즉시 바뀐다.
- 플레이어 목록에 현재 문서와 클릭 수가 표시된다.
- 새 라운드 생성이 모든 화면에 즉시 반영된다.

### 5.4 4차: 관리자/방장 패널

목표: 스트리머나 방장이 진행을 통제할 수 있다.

작업:

- 방장 PIN 또는 admin token
- 새 라운드
- 라운드 리셋
- 세션 랭킹 초기화
- 참가자 닉네임 정리
- 플레이어 강제 관전 전환
- 현재 Cloudflare URL/방 코드 복사

완료 기준:

- 방장만 라운드와 랭킹을 초기화할 수 있다.
- 일반 참가자는 관리자 API를 호출할 수 없다.

### 5.5 5차: 접근 제한

목표: 외부 URL 공개로 생기는 문제를 줄인다.

선택지:

- 간단 모드: 방 코드 입력
- 방송 모드: 관전은 공개, 플레이어는 방 코드 필요
- 비공개 모드: Cloudflare Access 이메일 로그인
- 운영 모드: 고정 도메인 + Cloudflare Access + 관리자 PIN

작업:

- 방 코드 없이는 플레이어 입장 불가
- 관전자 허용 여부 설정
- 닉네임 길이, 중복명, 금칙어 처리
- API rate limit
- 너무 많은 active run 제한

완료 기준:

- URL만 알아도 랭킹을 오염시키기 어렵다.
- 플레이어 수 제한을 넘으면 관전자로 들어간다.

## 6. 권장 아키텍처

```text
Browser / Mobile / Viewer
        |
        | HTTPS
        v
Cloudflare Tunnel
        |
        | http://127.0.0.1:3002
        v
Local WikiSpeedRun Server
        |
        | fetch/cache
        v
namu.wiki
```

서버 내부 상태:

```ts
type ServerState = {
  sessionStartedAt: string;
  players: Map<string, Player>;
  rooms: Map<string, Room>;
  activeRuns: Map<string, Run>;
  rankings: CompletionRecord[];
};
```

```ts
type Player = {
  id: string;
  name: string;
  role: "host" | "player" | "spectator";
  joinedAt: string;
  lastSeenAt: string;
  connected: boolean;
};
```

```ts
type Room = {
  id: string;
  code: string;
  hostPlayerId: string;
  currentRoundId: string | null;
  createdAt: string;
  settings: {
    allowSpectators: boolean;
    requireRoomCode: boolean;
    maxPlayers: number;
  };
};
```

```ts
type Round = {
  id: string;
  roomId: string;
  mode: "casual" | "practice";
  allRandom: boolean;
  start: string;
  target: string;
  status: "lobby" | "countdown" | "running" | "finished";
  createdAt: string;
  startsAt: string | null;
};
```

```ts
type Run = {
  id: string;
  roomId: string;
  roundId: string;
  playerId: string;
  status: "ready" | "running" | "finished" | "abandoned";
  startedAt: string | null;
  finishedAt: string | null;
  currentTitle: string;
  routeSteps: RouteStep[];
};
```

## 7. API 설계안

### 플레이어

- `POST /api/players`
  - 닉네임을 받고 `playerId` 발급
  - 브라우저는 `playerId`를 localStorage에 저장

- `PATCH /api/players/:playerId`
  - 닉네임 변경
  - heartbeat 갱신

### 방

- `GET /api/session`
  - 서버 시작 시각, 기본 방, 현재 라운드, 랭킹 요약 반환

- `POST /api/rooms`
  - 방 생성

- `POST /api/rooms/:roomId/join`
  - 방 코드와 playerId 검증

- `POST /api/rooms/:roomId/reset-rankings`
  - 방장 전용

### 라운드

- `POST /api/rooms/:roomId/rounds`
  - 새 라운드 생성
  - 캐주얼, 연습, 아예랜덤 선택

- `POST /api/rounds/:roundId/countdown`
  - 카운트다운 시작

- `POST /api/rounds/:roundId/start`
  - 서버 기준 시작

- `POST /api/rounds/:roundId/finish`
  - 라운드 종료 또는 강제 종료

### 플레이 로그

- `POST /api/runs`
  - playerId, roomId, roundId로 run 시작

- `POST /api/runs/:runId/link`
  - 현재 문서에서 다음 문서로 이동 요청
  - 서버가 outgoingLinks 검증
  - 성공하면 서버 routeSteps에 추가

- `POST /api/runs/:runId/back`
  - 서버가 이전 문서로 되돌림
  - 뒤로가기 routeStep 추가

- `POST /api/runs/:runId/finish`
  - 서버가 currentTitle과 target을 비교
  - 완료 시 ranking record 생성

### 실시간

- `GET /api/events`
  - SSE
  - event types:
    - `session`
    - `player:update`
    - `round:update`
    - `run:update`
    - `ranking:update`

## 8. UI 계획

### 대기실

추가할 요소:

- 접속 URL 복사
- 방 코드 복사
- 내 역할: 방장/플레이어/관전자
- 현재 라운드 카드
- 참가자 목록
- 시작 대기 상태
- 방장 컨트롤

### 인게임

추가할 요소:

- 서버 기준 카운트다운
- 서버 기준 기록 시간
- 다른 플레이어 진행 상태
- 현재 라운드 상태
- 관전자일 때 클릭 비활성화

### 결과

추가할 요소:

- 서버 인증 기록 배지
- 방/라운드 ID
- 내 순위
- 같은 라운드 참가자 결과 비교
- 라운드별 이동 로그 비교

## 9. 공정성 강화안

서버가 믿어도 되는 정보:

- 서버가 발급한 runId
- 서버가 저장한 startedAt
- 서버가 검증한 link/back 이벤트
- 서버가 계산한 elapsedMs, clicks, score

서버가 믿으면 안 되는 정보:

- 클라이언트가 제출한 최종 routeSteps
- 클라이언트가 제출한 elapsedMs
- 클라이언트가 제출한 score
- 클라이언트가 임의로 바꾼 currentTitle

검증 규칙:

- link 이벤트는 현재 문서의 outgoingLinks에 있어야 한다.
- back 이벤트는 서버 run stack에 이전 문서가 있을 때만 허용한다.
- finish는 currentTitle이 target과 같을 때만 허용한다.
- 이미 finished인 run은 추가 이벤트를 받지 않는다.
- practice mode는 랭킹에 저장하지 않는다.

## 10. Cloudflare 운영 고려사항

Quick Tunnel:

- 테스트와 임시 공유에 적합
- 실행할 때마다 URL 변경
- 계정/도메인 없이 사용 가능
- 장시간 운영 보장 없음

Named Tunnel:

- 방송, 반복 사용, 고정 주소에 적합
- Cloudflare 도메인 필요
- Public hostname 설정 가능
- Cloudflare Access 적용 가능

권장 운영 모드:

- 친구 테스트: Quick Tunnel + 방 코드
- 방송 테스트: Named Tunnel + 플레이어 방 코드 + 관전 공개
- 비공개 대회: Named Tunnel + Cloudflare Access + 방장 PIN

## 11. 장애/엣지 케이스

네트워크 끊김:

- player heartbeat가 끊기면 disconnected로 표시
- run은 일정 시간 유지
- 재접속 시 playerId로 복구

새로고침:

- active run이 있으면 현재 문서와 로그를 서버에서 복원
- 라운드가 끝났으면 결과 화면으로 이동

늦은 입장:

- 라운드 진행 중이면 관전 또는 다음 라운드 대기
- 방장이 허용하면 중도 참가 가능 옵션 제공

동시 클릭:

- run 상태에 navigation lock을 둔다.
- 같은 run에서 동시에 들어온 이벤트는 순서대로 처리한다.

나무위키 fetch 실패:

- 사용자에게 실패 문서 표시
- 같은 문서 요청은 캐시 또는 in-flight promise로 합친다.
- 일정 횟수 실패 시 라운드 재생성 안내

악성 요청:

- playerId 없는 랭킹/런 이벤트 거부
- 너무 빠른 이벤트 rate limit
- routeSteps 길이 제한
- 닉네임 sanitize

## 12. 구현 순서

### Phase 1: 서버 권위형 run

1. `POST /api/players` 추가
2. `POST /api/runs` 추가
3. `POST /api/runs/:runId/link` 추가
4. `POST /api/runs/:runId/back` 추가
5. `POST /api/runs/:runId/finish` 추가
6. 프론트의 기존 `navigateToArticle`, `goBackArticle`, 완주 저장을 run API 기반으로 교체
7. 랭킹 POST 직접 제출 제거

### Phase 2: 기본 방과 공유 라운드

1. 기본 방 상태 추가
2. currentRound API 추가
3. 대기실에서 현재 라운드 표시
4. 새 라운드 생성 버튼 추가
5. 참가자 모두 같은 라운드로 시작

### Phase 3: SSE 실시간 동기화

1. SSE 연결 추가
2. ranking update 이벤트
3. player progress 이벤트
4. round update 이벤트
5. 기존 5초 폴링 제거 또는 fallback으로 유지

### Phase 4: 방장 패널

1. 방장 PIN 생성
2. 라운드 생성/리셋/종료
3. 랭킹 초기화
4. 참가자 관리

### Phase 5: 접근 제한과 운영 모드

1. 방 코드 필수 옵션
2. 관전자 공개 옵션
3. 최대 플레이어 수
4. Cloudflare Access 문서 보강

## 13. 테스트 계획

API 테스트:

- 플레이어 생성
- run 시작
- 정상 link
- 잘못된 link 거부
- back 이벤트
- finish 성공
- finish 중복 거부
- practice mode 랭킹 제외
- 서버 재시작 시 세션 랭킹 초기화

UI 테스트:

- 두 브라우저 컨텍스트가 같은 라운드를 받는지
- 한쪽 완주가 다른 쪽 랭킹에 반영되는지
- 뒤로가기 포함 경로가 서버 로그와 결과 이미지에 일치하는지
- 모바일에서 대기실/라운드/랭킹이 깨지지 않는지

Cloudflare 테스트:

- Quick Tunnel 외부 URL 접속
- 외부 URL의 `/api/session`, `/api/rankings` 확인
- 두 기기에서 같은 라운드 시작
- Cloudflare 연결 종료 시 UI 오류 처리

## 14. MVP 성공 기준

외부 멀티기기 MVP는 아래를 만족하면 성공으로 본다.

- 방장이 Cloudflare URL을 공유한다.
- 두 명 이상이 같은 방에 입장한다.
- 방장이 새 라운드를 만들면 모두 같은 start/target을 본다.
- 서버 카운트다운 후 동시에 시작한다.
- 모든 이동과 뒤로가기가 서버 로그에 저장된다.
- 완주 기록은 서버가 계산해서 세션 랭킹에 넣는다.
- 다른 기기에서도 랭킹과 진행 상태가 갱신된다.
- 결과 이미지에는 번호형 이동 로그가 포함된다.

## 15. 당장 다음 작업 추천

Phase 1의 핵심 서버 권위형 run은 반영되었다. 다음 구현은 Phase 2의 기본 방과 공유 라운드로 넘어가는 것이 좋다.

가장 먼저 할 작업:

1. 기본 방 `main` 상태 추가
2. 서버에 `currentRound` 추가
3. 모든 사용자가 같은 currentRound를 받게 변경
4. 방장만 `새 라운드`를 만들 수 있게 제한
5. 라운드 시작 전 대기 상태와 카운트다운 추가
6. 늦게 들어온 사용자는 관전 또는 다음 라운드 대기 상태로 분리

이 단계가 끝나면 외부 사용자가 같은 제시어로 함께 겨루는 구조가 잡힌다.
