# 배전계통 통합 분석 플랫폼

팀 으라차차: 안진성, 고영민, 최민준, 한승우

이 README는 항상 현재 저장소의 디렉토리 구성과 작동 방식을 나타냅니다. 바꾸는 방법은 아래 [README 갱신 규칙](#readme-갱신-규칙)을 따릅니다.

## 디렉토리 구성

| 폴더 | 역할 | 담당 |
|------|------|------|
| `frontend/` | 웹 화면 (React, Vite) | 고영민, 최민준 |
| `backend/` | API 서버 (FastAPI) | 안진성, 한승우 |
| `cim/` | 한전 데이터 → CIM 변환, Neo4j 적재·조회·편집 | 한승우 |
| `simulation/` | OpenDSS 조류 계산 | 안진성 |
| `ai_report/` | LLM 리포트 생성 | 고영민, 최민준 |
| `data/` | 한전 데이터 보관 (git에 올라가지 않음) | 공용 |

```
capstone/
├── backend/
│   ├── main.py              앱 생성, 시작·종료 시 Neo4j 연결·해제, 미구현 함수 → 501
│   └── api/
│       ├── health.py        GET /api/health: 서버·Neo4j 상태
│       ├── grid.py          계통 조회·편집 API → cim/graph.py
│       ├── simulation.py    시뮬레이션 API → cim/graph.py, simulation/simulate.py
│       └── report.py        리포트 API → cim/graph.py, ai_report/report.py
├── cim/
│   ├── models.py            계통 데이터 형식 (Feeder, Node, Line, FeederGraph)
│   ├── graph.py             Neo4j 조회·편집 함수, Neo4j 구조 설명
│   ├── db.py                Neo4j 연결
│   └── schema.cypher        Neo4j 제약조건
├── simulation/
│   ├── models.py            시뮬레이션 결과 형식
│   └── simulate.py          조류 계산 함수
├── ai_report/
│   ├── models.py            리포트 형식 (진단, 원인, 솔루션)
│   └── report.py            리포트 생성 함수
├── frontend/
│   ├── src/
│   │   ├── main.jsx         React 시작점
│   │   ├── App.jsx          화면 (현재: 서버·Neo4j 상태 표시)
│   │   └── api/client.js    백엔드 API 호출 함수
│   ├── vite.config.js       /api 요청을 백엔드(localhost:8000)로 전달
│   └── package.json         프론트엔드 라이브러리
├── data/                    한전 원본 (git 제외)
├── docker-compose.yml       Neo4j 실행 설정
├── requirements.txt         Python 라이브러리
└── .env.example             접속 정보 양식 (.env로 복사해서 사용)
```

`.gitignore`, `frontend/index.html`, `frontend/.oxlintrc.json` 같은 기본 설정 파일은 생략했습니다.

## 구현 상태

| 기능 | 위치 | 상태 |
|------|------|------|
| 서버 실행, Neo4j 연결 | `backend/main.py`, `cim/db.py`, `backend/api/health.py` | 동작 |
| 프론트엔드 → 백엔드 API 호출 | `frontend/src/api/client.js` | 동작 |
| 한전 데이터 적재 | `cim/` | 없음 |
| 계통 조회·편집 | `cim/graph.py` | 틀만 있음 |
| 조류 계산 | `simulation/simulate.py` | 틀만 있음 |
| AI 리포트 | `ai_report/report.py` | 틀만 있음 |
| 단선도 화면, 편집 UI | `frontend/src/` | 없음 |

틀만 있는 함수는 `NotImplementedError`를 내고, 해당 API는 501을 돌려줍니다.

## 작동 방식

```
data/ (한전 원본) ──cim──▶ Neo4j
                              ▲
frontend ──HTTP──▶ backend ───┤ cim/graph.py (조회·편집)
                      │
                      ├──▶ simulation/simulate.py ──▶ 시뮬레이션 결과
                      └──▶ ai_report/report.py   ──▶ AI 리포트 (계통 정보 + 시뮬레이션 결과)
```

1. **적재** (FR-01, 02): `data/`의 한전 원본을 `cim`이 CIM 형식으로 변환해 Neo4j에 저장
2. **조회·편집** (FR-02, 05, 06, 07): 프론트엔드 → `backend/api/grid.py` → `cim/graph.py` → Neo4j
3. **시뮬레이션** (FR-03, 04): 프론트엔드 → `POST /api/feeders/{id}/simulations` → 백엔드가 `cim/graph.py`로 계통을 읽어 `simulation/simulate.py`에 넘김 → 결과를 프론트엔드가 단선도에 표시
4. **AI 리포트** (FR-08, 09): 프론트엔드가 받은 시뮬레이션 결과를 `POST /api/reports`로 보냄 → 백엔드가 `cim/graph.py`로 같은 계통 정보를 읽어 결과와 함께 `ai_report/report.py`에 넘김 → 진단·원인·솔루션 리포트 생성

### 편집 → 시뮬레이션 → 리포트

비전문가도 쓸 수 있도록, 시뮬레이션할 때마다 리포트로 설명을 보여 주는 방식으로 구현합니다.

```
편집 (노드 이동·추가·삭제 등) → 그때마다 해당 API 호출 → Neo4j에 바로 저장
시뮬레이션 요청 → 결과 도착 → 단선도에 바로 표시
                           └→ 프론트엔드가 자동으로 POST /api/reports → 리포트 도착하면 표시
```

- 시뮬레이션과 리포트 API를 나눈 이유: LLM 응답(수 초~수십 초)을 기다리지 않고 결과를 먼저 보여 주기 위해
- 리포트가 만들어지는 중에 새 시뮬레이션이 끝나면, 이전 리포트는 버리고 마지막 결과의 리포트만 표시
- 리포트에는 계통 정보(노드·선로 이름, 종류, 연결)가 함께 들어가므로 "어느 구간이 왜 문제인지"를 설명할 수 있음
- 시뮬레이션마다 LLM을 호출하므로 API 사용량을 확인하고, 한전 수치를 외부 LLM에 보내도 되는지 한전 측에 확인

## 폴더 간 연결

| 연결 | 정의된 곳 |
|------|-----------|
| 프론트엔드 → 백엔드 API | `frontend/src/api/client.js`, `backend/api/` (형식은 http://localhost:8000/docs) |
| 계통 데이터 형식, Neo4j 구조 | `cim/models.py`, `cim/graph.py`, `cim/schema.cypher` |
| Neo4j 연결 | `cim/db.py` (접속 정보는 `.env`) |
| 시뮬레이션 결과 형식 | `simulation/models.py` |
| 리포트 형식 | `ai_report/models.py` |
| 백엔드 → 각 모듈 함수 | `cim/graph.py`, `simulation/simulate.py`, `ai_report/report.py` |

### 공유 형식 파일 변경 규칙

`cim/models.py`, `simulation/models.py`, `ai_report/models.py`, `frontend/src/api/client.js`는 여러 폴더가 함께 쓰는 약속입니다.
이 파일을 바꿀 때는 먼저 팀에 알리고, PR로 영향받는 담당자의 확인을 받은 뒤 합칩니다.

### README 갱신 규칙

아래가 바뀌면 같은 PR에서 README도 함께 고칩니다.

| 바뀐 것 | 고칠 곳 |
|---------|---------|
| 파일·폴더 추가, 삭제, 이름 변경 | 디렉토리 구성 |
| 기능 구현 완료, 새 기능 추가 | 구현 상태 |
| API 경로, 데이터 흐름 | 작동 방식, 폴더 간 연결 |
| 실행 방법, 라이브러리, 환경 변수 | 실행, Neo4j 연결 |

## 한전 데이터 → CIM 모델 정하기

각자의 Neo4j에 같은 데이터를 넣으려면 `cim` 적재 코드가 먼저 있어야 하고, 그 전에 한전 데이터에서 쓸 항목을 정해야 합니다.

1. **한전 데이터 확인**: 받은 파일에 있는 항목(컬럼) 파악
2. **쓸 항목 정하기**: 한전 항목 → 모델 필드 대응표 작성
3. **`cim/models.py` 확정**: 대응표에 맞춰 필드 추가·삭제 (공유 형식 파일 변경 규칙대로)
4. **적재 코드 작성**: `data/`의 원본을 읽어 `cim/models.py` 형식으로 Neo4j에 저장

3번이 끝나면 형식이 정해지므로 각자 그 형식에 맞춰 개발할 수 있고, 실제 데이터 확인은 4번 이후에 가능합니다.

### 항목을 정하는 기준

| 쓰는 곳 | 필요한 정보 | 현재 모델 필드 (초안) |
|---------|-------------|----------------------|
| 시뮬레이션 (OpenDSS) | 전원 전압, 연결 관계, 선로 길이·임피던스, 부하 크기 | `base_kv`, `from_node_id`, `to_node_id`, `length_km`, `r_ohm_per_km`, `x_ohm_per_km`, `p_kw`, `q_kvar` |
| 단선도 화면 | 위치, 이름, 종류 | `x`, `y`, `name`, `type` |
| AI 리포트 | 노드·선로 이름, 종류, 연결 관계 (시뮬레이션 결과와 함께 사용) | `name`, `type`, `from_node_id`, `to_node_id` |

### 데이터를 받으면 확인할 것

- 선로가 저항·리액턴스 값으로 오는지, 전선 종류 코드로 오는지 (코드라면 임피던스 변환표 필요)
- 단선도 좌표가 있는지 (없으면 화면에서 자동 배치)
- 개폐기, 변압기처럼 현재 모델에 없는 설비가 있는지
- 부하가 kW·kvar로 오는지, 계약전력이나 시간대별 값으로 오는지

`cim` 담당이 정리하고, 시뮬레이션 담당과 프론트엔드 담당이 필요한 항목이 빠지지 않았는지 확인합니다.

### 각자 데이터 준비

1. 한전 파일을 자기 PC의 `data/`에 넣기 (git에 올리지 않고 따로 공유)
2. `cim` 적재 코드를 실행해 자기 PC의 Neo4j에 저장

같은 원본과 같은 적재 코드를 쓰므로 모두 같은 데이터를 갖게 됩니다. 웹에서 편집한 내용은 자기 DB에만 남고, 다시 적재하면 처음 상태로 돌아갑니다.

## 실행

필요한 것: Python 3.14, Node.js 24, Docker Desktop

아래 명령은 Windows PowerShell 기준입니다.

```powershell
# 처음 한 번
cp .env.example .env              # NEO4J_PASSWORD 입력
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd frontend
npm install
cd ..

# Neo4j (저장소 루트)
docker compose up -d

# 백엔드 (저장소 루트, 가상환경 활성화 후)
uvicorn backend.main:app --reload --port 8000 --env-file .env

# 프론트엔드
cd frontend
npm run dev
```

http://localhost:5173 에 "서버 ok, Neo4j connected"가 보이면 정상입니다.

## Neo4j 연결

| 항목 | 내용 |
|------|------|
| 실행 | `docker compose up -d` (Neo4j 5.26 + APOC). 끄기 `docker compose down`, 데이터까지 초기화 `docker compose down -v` |
| 접속 정보 | `.env`의 `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`. Docker와 백엔드(`--env-file .env`)가 같은 값을 읽음 |
| 코드에서 사용 | `from cim.db import get_driver`. 백엔드가 시작할 때 연결하고 종료할 때 닫음 |
| 연결 확인 | http://localhost:8000/api/health 의 `"neo4j": "connected"` |
| 웹 콘솔 | http://localhost:7474 (`.env`의 아이디·비밀번호로 로그인) |

처음 한 번, 그리고 `cim/schema.cypher`가 바뀌었을 때 제약조건을 적용합니다.

```bash
docker cp cim/schema.cypher capstone-neo4j:/tmp/schema.cypher
docker exec capstone-neo4j cypher-shell -u neo4j -p <비밀번호> -f /tmp/schema.cypher
```

DB 데이터는 각자 PC의 Docker 볼륨에 따로 저장됩니다.
