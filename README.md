# 배전계통 통합 분석 플랫폼 (CIM · Neo4j · OpenDSS · LLM)

> **팀 으라차차** — 안진성, 고영민, 최민준, 한승우

CIM 표준 기반 배전계통 데이터를 Neo4j(Graph DB)에 적재하고, OpenDSS 시뮬레이션 결과를 웹 단선도에 오버레이로 표시하며,
LLM이 **진단 → 원인 → 대안** 리포트를 자동 생성하는 통합 플랫폼입니다.

## 전체 흐름

```
한전 22.9kV 데이터 ──(FR-01)──▶ CIM 매핑 ──(FR-02)──▶ Neo4j
                                                        │
                        ┌────────────(FR-03)────────────┘
                        ▼
              OpenDSS 스크립트 생성 ──(FR-04)──▶ 조류 계산 / 결과 추출
                                                        │
      웹 단선도 (Cytoscape.js) ◀──(FR-05)── 결과 오버레이 ◀┘
         │  ▲                                           │
 (FR-06/07) 편집·UUID·실시간 저장                  (FR-08/09) LLM 리포트
```

## 기술 스택

사용 언어는 **Python**(프론트엔드 외 전부)과 **JavaScript**(프론트엔드) 두 가지입니다.

| 영역 | 폴더 | 언어 | 기술 |
|------|------|------|------|
| 프론트엔드 | `frontend/` | JavaScript (Node 24) | React, Vite, Cytoscape.js (`cytoscape-edgehandles`로 선로 편집) |
| 백엔드 | `backend/` | Python 3.14 | FastAPI, Uvicorn, Pydantic |
| 데이터 | `cim/` | Python 3.14 | pandas, openpyxl, neo4j 공식 드라이버 |
| DB | `backend/infra/` | Cypher | Neo4j 5.26 Community + APOC (Docker) |
| 시뮬레이션 | `simulation/` | Python 3.14 | OpenDSSDirect.py |
| AI 리포트 | `ai_report/` | Python 3.14 | Anthropic Claude API (`anthropic` SDK, 구조화 출력) |
| 테스트 | 각 모듈 `tests/` | Python 3.14 | pytest |

### 모듈 간 연결

- **프론트엔드 ↔ 백엔드**: HTTP + JSON으로 통신합니다. 주고받는 주소와 JSON 형식은 API 정의서로 합의하고,
  백엔드 실행 중 http://localhost:8000/docs 에서 FastAPI가 자동 생성한 API 문서를 확인할 수 있습니다.
- **백엔드 ↔ 나머지 모듈**: `cim`, `simulation`, `ai_report`는 모두 Python이라 백엔드가 직접 import해서 호출합니다.
- **LLM 호출은 백엔드에서만** 합니다. API 키는 백엔드 `.env`에만 두고 프론트엔드 코드에는 넣지 않습니다.

## 역할별 디렉토리

| 역할 | 경로 | 내용 | 관련 요구사항 | 담당 |
|------|------|------|---------------|------|
| FE | [`frontend/`](frontend/) | 웹 단선도 (Cytoscape.js), 결과 오버레이, 드래그&드롭 편집 | FR-05, FR-06 | 고영민, 최민준 |
| BE | [`backend/`](backend/) | API 서버 (계통 조회/편집, UUID 발급, 시뮬레이션·리포트 연동), 실행 환경 | FR-02, FR-04, FR-06~FR-08 | 안진성, 한승우 |
| 데이터 (CIM/Neo4j) | [`cim/`](cim/) | 한전 제공 데이터 → CIM 매핑·검증, Neo4j 스키마·적재 | FR-01, FR-02 | 한승우 |
| 시뮬레이션 (OpenDSS) | [`simulation/`](simulation/) | Neo4j → OpenDSS 스크립트 변환, 실행, 결과 추출, 회귀 테스트 | FR-03, FR-04 | 안진성 |
| AI 리포트/프롬프트 | [`ai_report/`](ai_report/) | 결과 수치 → 프롬프트 매핑, LLM 호출, 3단계 리포트 템플릿 | FR-08, FR-09 | 고영민, 최민준 |

> 문서(요구사항 분석서, 설계서, 회의록 등, 담당: 안진성·고영민·한승우)는 [Notion](https://app.notion.com/p/3e88a37a2d348066b4ecce17929f7389)에서 관리합니다.
> [`data/`](data/)는 코드 없이 데이터 파일만 저장하는 공용 폴더입니다.

### 팀원별 담당 폴더

| 팀원 | 담당 폴더 |
|------|-----------|
| 안진성 | `backend/`, `simulation/` |
| 고영민 | `frontend/`, `ai_report/` |
| 최민준 | `frontend/`, `ai_report/` |
| 한승우 | `backend/`, `cim/` |

## 디렉토리 구조

```
capstone/
├── frontend/                # [FE] 웹 단선도 — FR-05, FR-06
│   ├── public/              #   정적 파일 (index.html, 아이콘 등)
│   └── src/
│       ├── graph/           #   Cytoscape.js 단선도 렌더링, 스타일·레이아웃
│       ├── overlay/         #   시뮬레이션 결과(유효/무효 전력 등) 오버레이 표시
│       ├── editor/          #   노드/선로 드래그&드롭 편집
│       ├── components/      #   공통 UI 컴포넌트, AI 리포트 뷰어
│       └── api/             #   백엔드 API 호출 클라이언트
│
├── backend/                 # [BE] API 서버 — FR-02, FR-04, FR-06~FR-08
│   ├── app/
│   │   ├── api/             #   라우터 (계통 조회/편집, 시뮬레이션 실행, 리포트 요청)
│   │   ├── core/            #   설정, Neo4j 연결, 공통 유틸
│   │   ├── schemas/         #   요청/응답 데이터 모델
│   │   └── services/        #   비즈니스 로직 (cim·simulation·ai_report 모듈 연동)
│   ├── infra/               #   실행 환경 (Neo4j docker-compose.yml)
│   └── tests/               #   테스트
│
├── cim/                     # [데이터] CIM 매핑 / Neo4j 적재 코드 — FR-01, FR-02
│   ├── mapping/             #   한전 데이터 필드 ↔ CIM 클래스/속성 매핑 테이블
│   ├── converter/           #   한전 데이터 → CIM 변환 코드
│   ├── validation/          #   변환 결과 검증 스크립트, 예외 케이스 목록
│   ├── cypher/              #   Neo4j 스키마·제약조건·인덱스 정의 (.cypher)
│   ├── loader/              #   CIM 데이터 → Neo4j 적재 (위상·연결·좌표 포함)
│   └── tests/               #   테스트
│
├── simulation/              # [시뮬레이션] OpenDSS 연동 — FR-03, FR-04
│   ├── converter/           #   Neo4j 조회 결과 → OpenDSS 스크립트(.dss) 생성
│   ├── runner/              #   OpenDSS 실행, 결과(유효/무효 전력, 전압 등) 추출
│   ├── results/             #   실행 산출물 (git 제외)
│   └── tests/regression/    #   기준 계통 대비 변환 정확도 회귀 테스트
│
├── ai_report/               # [AI] LLM 자동 해설 리포트 — FR-08, FR-09
│   ├── prompts/             #   시뮬레이션 수치 → 프롬프트 매핑 규칙
│   ├── templates/           #   리포트 템플릿 (① 진단 → ② 원인 → ③ 솔루션)
│   ├── client/              #   LLM API 호출 모듈
│   └── tests/               #   테스트
│
├── data/                    # 데이터 파일 저장소 (코드 없음)
│   ├── raw/                 #   한전 제공 22.9kV 배전계통 데이터(가공본) (⚠ git 제외)
│   ├── output/              #   CIM 변환 결과 (CIM XML/RDF, CSV 등) (⚠ git 제외)
│   └── samples/             #   개발·테스트용 가상 샘플 계통 (한전 데이터 금지)
│
├── .env.example             # 환경 변수 양식 (복사해서 .env로 사용)
├── .gitignore               # git 제외 목록 (.env, 한전 데이터, 산출물 등)
└── .gitattributes           # 줄바꿈(LF) 통일 설정
```

> 빈 폴더에 있는 `.gitkeep`은 폴더를 git에 올리기 위한 빈 파일입니다. 폴더에 실제 파일이 생기면 지워도 됩니다.

## 개발 단계

1. **데이터 표준화 / DB 구축** — 한전 제공 22.9kV 데이터 분석 → CIM 매핑 → Neo4j 적재
2. **시뮬레이션 연동** — DB 쿼리 → OpenDSS 스크립트 변환 → 조류 계산 / 결과 추출
3. **웹 시각화** — Cytoscape.js 단선도 → 결과 오버레이
4. **웹 편집 / 동기화** — 드래그&드롭 편집 → UUID 발급 → 실시간 저장
5. **LLM 리포트** — 수치 매핑 → API 호출 → 리포트 생성 / 표출

## 일정 및 산출물

| 기간 | 작업 | 산출물 |
|------|------|--------|
| 9월 | 개발 환경 구축, 요구사항 정의 | 요구사항 분석서 |
| 9월 ~ 10월 | 시스템 구조·UI·DB 설계 | 시스템 설계서 |
| 10월 ~ 11월 | 핵심 기능 구현, FE/BE 개발 | API 정의서, 기능 명세서 |
| 11월 ~ 12월 | 단위 디버깅, 통합 테스트 | 통합 테스트 결과서 |
| 12월 | 최종 시연, 보고서 작성 | 최종 결과 보고서 |

## 시작하기

### 0. 준비물

| 도구 | 버전 | 설치 |
|------|------|------|
| Git | 최신 | https://git-scm.com |
| Python | **3.14** | https://www.python.org/downloads/ (설치 시 "Add python.exe to PATH" 체크) |
| Node.js | **24 LTS** | https://nodejs.org |
| Docker Desktop | 최신 | https://www.docker.com/products/docker-desktop/ |

### 1. 저장소 받기 / 환경 변수

```bash
git clone https://github.com/anjinsung-debug/capstone.git
cd capstone
cp .env.example .env   # .env를 열어 NEO4J_PASSWORD(8자 이상), LLM API 키 등 입력
```

### 2. Python 가상환경 (backend, cim, simulation, ai_report 공통)

저장소 루트에 가상환경 하나를 만들어 모든 Python 모듈이 함께 씁니다.

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows (Mac/Linux: source .venv/bin/activate)
python -m pip install -r requirements.txt
```

패키지를 추가하면 `requirements.txt`에 버전과 함께 적고 커밋합니다 (예: `pandas==3.0.6`).

### 3. Neo4j 실행 (Docker)

[Docker Desktop](https://www.docker.com/products/docker-desktop/)을 설치하고 실행한 뒤, 저장소 루트에서:

> 모든 명령에 `--env-file .env`가 필요합니다. 빠뜨리면 `required variable NEO4J_PASSWORD is missing` 오류가 납니다.

```bash
# 실행 (처음 한 번은 이미지 다운로드로 시간이 걸림)
docker compose -f backend/infra/docker-compose.yml --env-file .env up -d

# 상태 확인 / 로그 보기
docker compose -f backend/infra/docker-compose.yml --env-file .env ps
docker compose -f backend/infra/docker-compose.yml --env-file .env logs -f neo4j

# 중지 (데이터는 유지됨)
docker compose -f backend/infra/docker-compose.yml --env-file .env down

# 중지 + DB 데이터 전부 삭제 (초기화)
docker compose -f backend/infra/docker-compose.yml --env-file .env down -v
```

- 웹 콘솔: http://localhost:7474 (`.env`의 `NEO4J_USER` / `NEO4J_PASSWORD`로 로그인)
- 코드 접속 주소: `bolt://localhost:7687`
- DB 데이터는 Docker 볼륨에 저장되어 각자 PC에만 있습니다. 공유 데이터는 `cim/loader`로 다시 적재합니다.

### 4. 백엔드 실행 (FastAPI)

가상환경을 활성화한 상태로 **저장소 루트에서**:

```bash
uvicorn backend.app.main:app --reload --port 8000
```

- 상태 확인: http://localhost:8000/api/health → `{"status":"ok","neo4j":"connected"}`
- API 문서: http://localhost:8000/docs
- 테스트: `python -m pytest backend`

### 5. 프론트엔드 실행 (React + Vite)

```bash
cd frontend
npm install        # 처음 한 번, package.json이 바뀌었을 때
npm run dev
```

- 화면: http://localhost:5173 (백엔드 상태와 예시 단선도가 보이면 성공)
- `/api`로 시작하는 요청은 Vite가 백엔드(8000번 포트)로 전달합니다.

> ⚠ **한전 제공 데이터는 외부 공개 금지입니다.** 이 저장소는 공개(public) 상태이므로
> `data/raw/`(한전 데이터)와 `data/output/`(변환 결과), `.env`는 절대 커밋하지 않습니다.
> 데이터 파일은 별도 공유 드라이브로 주고받고, 커밋 전에 `git status`로 데이터 파일이 섞이지 않았는지 확인하세요.

## 협업 규칙

### 브랜치

- `main` — 항상 실행 가능한 상태 유지. **직접 push 하지 않고 PR로만 병합**합니다.
- 작업 브랜치 — `타입/파트-작업내용` 형식, 영어 소문자와 `-` 사용

| 타입 | 용도 | 예시 |
|------|------|------|
| `feature/` | 새 기능 | `feature/sim-opendss-runner`, `feature/fe-overlay` |
| `fix/` | 버그 수정 | `fix/cim-voltage-mapping` |
| `docs/` | README 등 문서 수정 | `docs/readme-setup` |

파트 이름: `fe`, `be`, `cim`, `sim`, `ai`

### 작업 순서

```bash
# 1. 최신 main 받기
git checkout main
git pull

# 2. 작업 브랜치 만들기
git checkout -b feature/sim-opendss-runner

# 3. 작업 후 커밋 (커밋 전에 git status로 데이터 파일이 없는지 확인)
git add .
git commit -m "feat: OpenDSS 조류 계산 실행 함수 추가"

# 4. GitHub에 올리기
git push -u origin feature/sim-opendss-runner
```

5. GitHub에서 **Pull Request** 생성 → 팀원 1명 이상 확인 후 main에 병합
6. 병합된 브랜치는 삭제하고, 다음 작업은 다시 1번부터

### 커밋 메시지

`타입: 무엇을 했는지` 형식으로 한글로 작성합니다.

| 타입 | 용도 | 예시 |
|------|------|------|
| `feat` | 기능 추가 | `feat: 단선도 노드 드래그 편집 추가` |
| `fix` | 버그 수정 | `fix: 선로 임피던스 단위 변환 오류 수정` |
| `refactor` | 동작 변화 없는 코드 개선 | `refactor: Neo4j 조회 쿼리 함수 분리` |
| `test` | 테스트 추가/수정 | `test: OpenDSS 변환 회귀 테스트 추가` |
| `docs` | 문서 수정 | `docs: README 실행 방법 추가` |
| `chore` | 설정, 패키지 등 기타 | `chore: requirements.txt에 neo4j 추가` |

### 기타

- 다른 파트 폴더를 수정해야 하면 담당자에게 먼저 알립니다.
- 충돌(conflict)이 나서 해결이 어려우면 혼자 덮어쓰지 말고 해당 파일 담당자와 함께 해결합니다.
- 한전 데이터, `.env`, 용량이 큰 파일은 커밋하지 않습니다.
