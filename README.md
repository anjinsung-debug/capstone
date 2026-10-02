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

http://localhost:5173 에 "서버 ok, Neo4j connected"가 보이면 정상입니다.
