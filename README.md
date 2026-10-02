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
| 시뮬레이션 결과 형식 | `simulation/models.py` |
| 리포트 형식 | `ai_report/models.py` |
| 백엔드 → 각 모듈 함수 | `cim/graph.py`, `simulation/simulate.py`, `ai_report/report.py` |

구현되지 않은 함수는 `NotImplementedError`를 내고, API는 501을 돌려줍니다.

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
uvicorn backend.main:app --reload --port 8000

# 프론트엔드
cd frontend
npm run dev
```

http://localhost:5173 에 "서버 ok"가 보이면 정상입니다.
