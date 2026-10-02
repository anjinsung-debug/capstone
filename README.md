# 배전계통 통합 분석 플랫폼

팀 으라차차: 안진성, 고영민, 최민준, 한승우

## 폴더 구성

| 폴더 | 역할 | 담당 |
|------|------|------|
| `frontend/` | 웹 화면 (React, Vite) | 고영민, 최민준 |
| `backend/` | API 서버 (FastAPI) | 안진성, 한승우 |
| `cim/` | 한전 데이터 → CIM 변환, Neo4j 적재 | 한승우 |
| `simulation/` | OpenDSS 조류 계산 | 안진성 |
| `ai_report/` | LLM 리포트 생성 | 고영민, 최민준 |
| `data/` | 한전 데이터 보관 (git에 올라가지 않음) | 공용 |

## 전체 흐름

```
data/ (한전 원본) ──cim──▶ Neo4j
                              ▲
frontend ──HTTP──▶ backend ───┤ cim/graph.py (조회·편집)
                      │
                      ├──▶ simulation/simulate.py ──▶ 시뮬레이션 결과
                      └──▶ ai_report/report.py   ──▶ AI 리포트
```

1. **적재** (FR-01, 02): `data/`의 한전 원본을 `cim`이 CIM 형식으로 변환해 Neo4j에 저장
2. **조회·편집** (FR-02, 05, 06, 07): 프론트엔드 → `backend/api/grid.py` → `cim/graph.py` → Neo4j
3. **시뮬레이션** (FR-03, 04): 프론트엔드 → `POST /api/feeders/{id}/simulations` → 백엔드가 `cim/graph.py`로 계통을 읽어 `simulation/simulate.py`에 넘김 → 결과를 프론트엔드가 단선도에 표시
4. **AI 리포트** (FR-08, 09): 프론트엔드가 받은 시뮬레이션 결과를 `POST /api/reports`로 보냄 → `ai_report/report.py`가 진단·원인·솔루션 리포트 생성

## 폴더 간 연결

| 연결 | 정의된 곳 |
|------|-----------|
| 프론트엔드 → 백엔드 API | `frontend/src/api/client.js`, `backend/api/` (형식은 http://localhost:8000/docs) |
| 계통 데이터 형식, Neo4j 구조 | `cim/models.py`, `cim/graph.py`, `cim/schema.cypher` |
| Neo4j 연결 | `cim/db.py` (접속 정보는 `.env`) |
| 시뮬레이션 결과 형식 | `simulation/models.py` |
| 리포트 형식 | `ai_report/models.py` |
| 백엔드 → 각 모듈 함수 | `cim/graph.py`, `simulation/simulate.py`, `ai_report/report.py` |

구현되지 않은 함수는 `NotImplementedError`를 내고, API는 501을 돌려줍니다.

### 공유 형식 파일 변경 규칙

`cim/models.py`, `simulation/models.py`, `ai_report/models.py`, `frontend/src/api/client.js`는 여러 폴더가 함께 쓰는 약속입니다.
이 파일을 바꿀 때는 먼저 팀에 알리고, PR로 영향받는 담당자의 확인을 받은 뒤 합칩니다.

## 실행

필요한 것: Python 3.14, Node.js 24, Docker Desktop

```bash
# 처음 한 번
cp .env.example .env              # NEO4J_PASSWORD 입력
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd frontend && npm install && cd ..

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
