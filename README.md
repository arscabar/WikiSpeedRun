# WikiSpeedRun

나무위키 문서 링크만 눌러 출발 문서에서 목표 문서까지 최대한 빠르게 도달하는 로컬 전용 스피드런 앱입니다.

주소창 입력, 검색, 브라우저 뒤로 가기 같은 우회 동작을 막고, 서비스 내부에서 정제한 본문 링크만 클릭할 수 있게 만든 것이 핵심입니다.

![desktop race](docs/images/desktop-live.png)

## 주요 기능

- 나무위키 랜덤 문서를 기반으로 출발어와 목적어 자동 생성
- 본문 내부 링크만 클릭 가능한 자체 브라우저 UI
- 시간, 클릭 수, 점수, 칭호 기록
- 클릭 우선, 시간 우선, 점수 우선 로컬 랭킹
- 이동 경로 그래프와 결과 공유 문구/이미지 생성
- 데스크톱/모바일 반응형 UI
- Electron 기반 Windows EXE 패키징

## 화면

### 대기실

![desktop entry](docs/images/desktop-entry.png)

### 플레이 중

![desktop live](docs/images/desktop-live.png)

### 완주 결과

![desktop finish](docs/images/desktop-finish.png)

### 모바일

![mobile finish](docs/images/mobile-finish.png)

## 로컬 실행

```powershell
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:3001`을 엽니다.

개발 서버는 Vite 프론트엔드와 로컬 API 서버를 함께 실행합니다.

## 프로덕션 웹 실행

```powershell
npm run build
npm run server
```

브라우저에서 `http://127.0.0.1:3002`를 엽니다.

## Windows EXE 빌드

```powershell
npm install
npm run dist:win
```

빌드가 끝나면 아래 파일이 생성됩니다.

- `release/WikiSpeedRun-0.1.0-portable.exe`
- `release/WikiSpeedRun-win32-x64/WikiSpeedRun.exe`

portable EXE 하나만 실행해도 내부 Node 서버와 Electron 창이 함께 실행됩니다.

## API

- `GET /api/health`
- `GET /api/challenge?mode=daily`
- `GET /api/challenge?mode=infinite`
- `GET /api/challenge?mode=room`
- `GET /api/article?title=사과`
- `POST /api/run/event`

문서 파싱 결과는 `data/cache/articles`에 12시간 캐시됩니다.

## 점수와 칭호

```text
score = max(0, 100000 - clicks * 4000 - elapsedSeconds * 35)
```

- `90000+`: 레전드 러너
- `75000+`: 스피드러너
- `55000+`: 루트 파인더
- `30000+`: 완주자
- 그 외: 기록 보존

## 검증

최근 로컬 검증 결과입니다.

- `npm run build`: 통과
- Windows portable EXE 실행: 통과
- UI 완주 3회: `사과 -> 사과나무`, 1클릭 완주
- 랜덤 제시어 5회: 시작/목표 모두 실제 나무위키 문서로 확인
- 모드 전환: 오늘의 도전, 무한 모드, 사설 방 통과
- 공유 문구, 결과 이미지, 랭킹 정렬, 방 코드 버튼 통과
- 모바일 390x844: 가로 overflow 없음
- 브라우저 콘솔 오류: 0개
- `npm run stress -- 20`: 20/20 통과

## 프로젝트 방향

이 프로젝트는 별도 서버에 공개 배포하기보다, 스트리머나 친구들이 로컬에서 공정하게 실행하는 프로그램형 사용성을 목표로 합니다.

나무위키를 iframe으로 직접 넣지 않고, 로컬 서버가 문서를 가져와 본문과 링크를 정제한 뒤 게임 UI에서만 렌더링합니다. 이렇게 하면 주소창 조작, 검색, 뒤로 가기 같은 우회 동작을 앱 레벨에서 제어할 수 있습니다.
