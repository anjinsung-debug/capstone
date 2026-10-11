# 배전계통 통합 분석 플랫폼

팀 으라차차: 안진성, 고영민, 최민준, 한승우

22.9kV 배전계통을 웹에서 단선도로 보고 편집하면, 4대 시뮬레이션(전압 영향, 선로 과부하, 역조류, 단락용량 고장전류)을 자동으로 다시 돌려 결과를 단선도 위에 표시하고, AI가 진단·원인·솔루션 리포트로 설명해 주는 플랫폼입니다. 한전이 제공한 CIM XML 계통 데이터를 Neo4j에 적재해 사용합니다.

## 디렉토리 구성

| 폴더 | 역할 | 담당 |
|------|------|------|
| `frontend/` | 웹 화면 (React, Vite), 단선도 (Cytoscape.js) | 고영민, 최민준 |
| `backend/` | API 서버 (FastAPI) | 안진성, 한승우 |
| `cim/` | 한전 데이터 → CIM 변환, Neo4j 적재·조회·편집 저장 | 한승우 |
| `simulation/` | 계통 → OpenDSS 변환, 4대 시뮬레이션, 결과 그래프 (matplotlib) | 안진성 |
| `ai_report/` | LLM 리포트 생성 | 고영민, 최민준 |
| `data/` | 한전 제공 원본 CIM XML (공개 허락받은 파일만 git에 올림) | 공용 |
| `docs/` | 작동 방식 상세, CIM 매핑 기준, OpenDSS 데이터 대응표, 용어표 | 공용 |

```
capstone/
├── backend/
│   ├── main.py              앱 생성, Neo4j 연결, 오류 → HTTP 상태
│   └── api/                 health.py, grid.py(계통 조회·저장), simulation.py(시뮬레이션·그래프), report.py(리포트)
├── cim/
│   ├── models.py            계통 데이터 형식
│   ├── graph.py             Neo4j 계통 조회·스냅샷 저장
│   ├── topology.py          선로 방향·피더 소속 계산
│   ├── mapping.py           CIM XML → 공통 모델 매핑 가이드
│   ├── load.py              한전 CIM XML → Neo4j 적재 (python -m cim.load)
│   ├── db.py                Neo4j 연결
│   └── schema.cypher        Neo4j 제약조건
├── simulation/
│   ├── models.py            시뮬레이션 결과 형식
│   ├── dss.py               계통 → OpenDSS 스크립트 변환
│   ├── simulate.py          조류 계산·고장 해석 (자체 점검: python -m simulation.simulate)
│   └── plot.py              결과 그래프 (matplotlib → PNG)
├── ai_report/
│   ├── models.py            리포트 형식 (진단, 원인, 솔루션)
│   └── report.py            Claude로 리포트 생성 (자체 점검: python -m ai_report.report)
├── frontend/
│   ├── src/
│   │   ├── App.jsx          화면 흐름: 변전소 선택 → 단선도 → 자동 저장·시뮬레이션 → 결과·리포트
│   │   ├── components/      Diagram(단선도), NavDrawer(편집 메뉴), PropertyPanel(속성), ResultPanel(결과), HistoryChart, Modal, SubstationDialog, PopupWindow
│   │   ├── lib/             graphEdit.js(편집 로직), overlay.js(결과 → 단선도 표시)
│   │   ├── api/client.js    백엔드 API 호출
│   │   └── main.jsx, styles.css
│   ├── mock/mock_server.py  Neo4j·OpenDSS·LLM 없이 화면 개발용 모의 백엔드
│   └── vite.config.js       /api 요청을 백엔드(localhost:8000)로 전달
├── data/                    한전 제공 원본 (korean_distribution_cim.xml, 출처 NOTICE.md)
├── docs/
│   ├── how_it_works.md      작동 방식 상세 (저장·시뮬레이션·리포트 규칙)
│   ├── cim_mapping.md       한전 데이터 → CIM 모델 매핑 기준, 각자 데이터 준비
│   ├── opendss_simulation_data.md  시뮬레이션별 입력·가정·설정·결과 대응표
│   └── electrical_glossary.md     전기·전자 용어표
├── CONTRIBUTING.md          협업 규칙, 구현 상태, 폴더 간 연결
├── docker-compose.yml       Neo4j 실행 설정
├── requirements.txt         Python 라이브러리
└── .env.example             접속 정보·API 키 양식
```

## 작동 방식

해석 범위: 22.9kV, 3상 평형, 방사형 계통, 한 시점 계산, 3상 단락만.

```
data/ (한전 원본 CIM XML) ──cim/load.py──▶ Neo4j
                                   ▲
frontend ──HTTP──▶ backend ────────┤ cim/graph.py (조회·스냅샷 저장)
                      ├──▶ simulation/simulate.py ──▶ 시뮬레이션 결과 (dss.py로 OpenDSS 변환)
                      ├──▶ simulation/plot.py     ──▶ 결과 그래프 (PNG)
                      └──▶ ai_report/report.py   ──▶ AI 리포트
```

1. **적재**: `python -m cim.load`가 한전 CIM XML을 공통 모델로 바꿔 Neo4j에 저장
2. **조회·편집**: 변전소 계통을 단선도로 보고 설비·선로를 편집하면 계통 전체를 `PUT /api/substations/{id}`로 자동 저장
3. **시뮬레이션**: 저장된 계통을 OpenDSS로 계산해 전압, 선로 부하율, 역조류, 고장전류, 피더별 송출 전력을 단선도에 표시
4. **AI 리포트**: 시뮬레이션 결과를 Claude에 넘겨 진단·원인·솔루션 리포트 생성

화면 흐름:

```
변전소 선택 → 단선도 표시 → 바로 시뮬레이션
편집 → 0.8초 동안 더 안 고치면 자동 저장 → 계산에 영향을 주는 값이 바뀌었으면 자동 시뮬레이션
결과 도착 → 단선도 오버레이·요약 갱신, 결과 그래프 자동 생성
"AI 리포트 만들기" 버튼 → 리포트 표시
```

단계별 세부 규칙은 [docs/how_it_works.md](docs/how_it_works.md)에 있습니다.

## 실행

필요한 것: Python 3.14, Node.js 24, Docker Desktop (Windows PowerShell 기준)

```powershell
# 처음 한 번
cp .env.example .env              # NEO4J_PASSWORD, ANTHROPIC_API_KEY 입력
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd frontend; npm install; cd ..

# Neo4j 실행 (끄기: docker compose down, 데이터 초기화: docker compose down -v)
docker compose up -d

# 데이터 적재 (--dry-run이면 Neo4j 없이 변환 결과만 출력, --reset이면 다시 적재)
python -m cim.load

# 백엔드
uvicorn backend.main:app --reload --port 8000 --env-file .env

# 프론트엔드
cd frontend
npm run dev

# (선택) Neo4j·Docker 없이 화면만 개발할 때: 백엔드 대신 모의 백엔드
python frontend/mock/mock_server.py
```

<<<<<<< HEAD
http://localhost:5173 에 "서버 ok, Neo4j connected"가 보이면 정상입니다. Neo4j 웹 콘솔은 http://localhost:7474 입니다.
=======
http://localhost:5173 에 "서버 ok, Neo4j connected"가 보이면 정상입니다. 변전소 목록이 비어 있으면 `python -m cim.load`로 데이터를 먼저 적재합니다.

`.env` 항목

| 항목 | 쓰는 곳 |
|------|---------|
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` | Docker(Neo4j), 백엔드, `python -m cim.load` |
| `ANTHROPIC_API_KEY` | AI 리포트 (`ai_report/report.py`). 백엔드만 읽으며, 프론트엔드 코드에는 넣지 않음 |
| `ANTHROPIC_MODEL` | (선택) AI 리포트에 쓸 모델 이름. 비우면 `DEFAULT_MODEL` |
| `AI_PROVIDER` | (선택) AI 리포트에 쓸 서비스. `anthropic`(기본) 또는 `gemini`. Gemini는 시험용 무료 키를 쓰려는 용도이며 팀 합의 전까지 기본값은 Claude |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | (선택) `AI_PROVIDER=gemini`일 때만 사용. 모델을 비우면 `GEMINI_DEFAULT_MODEL` |

## Neo4j 연결

| 항목 | 내용 |
|------|------|
| 실행 | `docker compose up -d` (Neo4j 5.26 + APOC). 끄기 `docker compose down`, 데이터까지 초기화 `docker compose down -v` |
| 접속 정보 | `.env`의 `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`. Docker와 백엔드(`--env-file .env`)가 같은 값을 읽음 |
| 코드에서 사용 | `from cim.db import get_driver`. 백엔드가 시작할 때 연결하고 종료할 때 닫음 |
| 연결 확인 | http://localhost:8000/api/health 의 `"neo4j": "connected"` |
| 웹 콘솔 | http://localhost:7474 (`.env`의 아이디·비밀번호로 로그인) |
>>>>>>> 071089b5833513961db60cbcf930c0c633eca7b9

처음 한 번, 그리고 `cim/schema.cypher`가 바뀌었을 때 제약조건을 적용합니다.

```bash
docker cp cim/schema.cypher capstone-neo4j:/tmp/schema.cypher
docker exec capstone-neo4j cypher-shell -u neo4j -p <비밀번호> -f /tmp/schema.cypher
```

| `.env` 항목 | 쓰는 곳 |
|------|---------|
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` | Docker(Neo4j), 백엔드, `python -m cim.load` |
| `ANTHROPIC_API_KEY` | AI 리포트. 백엔드만 읽으며 프론트엔드 코드에는 넣지 않음 |
| `ANTHROPIC_MODEL` | (선택) AI 리포트 모델 이름. 비우면 `DEFAULT_MODEL` |

## 참고자료

- IEC 61970/61968 Common Information Model (CIM) 전력 표준 스펙 문서
- OpenDSS (Open Distribution System Simulator) 공식 명령어 매뉴얼, 미국전력연구원(EPRI)
- https://github.com/1004aiteam-power/open_dss_project : 동작 원리 및 예시 코드 (변전소 2, 배전선로 2)
