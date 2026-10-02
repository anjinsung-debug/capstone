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

## 폴더 간 연결

| 연결 | 정의된 곳 |
|------|-----------|
| 프론트엔드 → 백엔드 API | `frontend/src/api/client.js`, `backend/app/api/` (형식은 http://localhost:8000/docs) |
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
uvicorn backend.app.main:app --reload --port 8000

# 프론트엔드
cd frontend
npm run dev
```

http://localhost:5173 에 "서버 ok"가 보이면 정상입니다.
