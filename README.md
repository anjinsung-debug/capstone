# 배전계통 통합 분석 플랫폼

팀 으라차차: 안진성, 고영민, 최민준, 한승우

22.9kV 배전계통을 웹에서 단선도로 보고 편집하면, 조류 계산·고장 해석(4대 시뮬레이션: 전압 영향, 선로 과부하, 역조류, 단락용량 고장전류)을 자동으로 다시 돌려 결과를 단선도 위에 표시하고, AI가 진단·원인·솔루션 리포트로 설명해 주는 플랫폼입니다. 한전이 제공한 CIM XML 계통 데이터를 Neo4j에 적재해 사용합니다.

협업 규칙과 구현 상태는 [CONTRIBUTING.md](CONTRIBUTING.md), 한전 데이터 → CIM 매핑 기준은 [docs/cim_mapping.md](docs/cim_mapping.md)에 있습니다.

## 디렉토리 구성

| 폴더 | 역할 | 담당 |
|------|------|------|
| `frontend/` | 웹 화면 (React, Vite), 단선도 (Cytoscape.js) | 고영민, 최민준 |
| `backend/` | API 서버 (FastAPI) | 안진성, 한승우 |
| `cim/` | 한전 데이터 → CIM 변환, Neo4j 적재·조회·편집 저장 | 한승우 |
| `simulation/` | 계통 → OpenDSS 변환, 4대 시뮬레이션, 결과 그래프 (matplotlib) | 안진성 |
| `ai_report/` | LLM 리포트 생성 | 고영민, 최민준 |
| `data/` | 한전 제공 원본 CIM XML (공개 허락받은 파일만 git에 올림) | 공용 |
| `docs/` | OpenDSS 시뮬레이션 데이터 대응표, 전기·전자 용어표, 한전 데이터 → CIM 매핑 기준 | 공용 |

```
capstone/
├── docs/
│   ├── opendss_simulation_data.md  시뮬레이션별 입력·가정·설정·결과 대응표
│   ├── electrical_glossary.md     전기·전자 용어표
│   └── cim_mapping.md             한전 데이터 → CIM 모델 항목·매핑 기준, 각자 데이터 준비
├── backend/
│   ├── main.py              앱 생성, 시작·종료 시 Neo4j 연결·해제, 오류 → HTTP 상태 (미구현 501, 없는 변전소 404, 잘못된 스냅샷·시뮬레이션 불가 422, 리포트 생성 실패 503)
│   └── api/
│       ├── health.py        GET /api/health: 서버·Neo4j 상태
│       ├── grid.py          변전소 계통 조회·스냅샷 저장 API → cim/graph.py
│       ├── simulation.py    시뮬레이션·그래프 API → cim/graph.py, simulation/simulate.py, simulation/plot.py
│       └── report.py        리포트 API → cim/graph.py, ai_report/report.py
├── cim/
│   ├── models.py            계통 데이터 형식 (Substation, Feeder, Node, Line, SubstationGraph, 편집 스냅샷)
│   ├── graph.py             Neo4j 변전소 목록·계통 조회·스냅샷 저장, 연결 특성 구분, Neo4j 구조 설명
│   ├── topology.py          위상 계산: 선로 방향(전원 쪽 = from)과 피더 소속 (load.py, graph.py가 같이 씀)
│   ├── mapping.py           CIM XML → 공통 모델 매핑 가이드 (클래스·속성 대응표, 단위 환산, 위상 규칙)
│   ├── load.py              한전 CIM XML → 공통 모델 변환·Neo4j 적재 (python -m cim.load)
│   ├── db.py                Neo4j 연결
│   └── schema.cypher        Neo4j 제약조건
├── simulation/
│   ├── models.py            시뮬레이션 결과 형식 (4대 시뮬레이션)
│   ├── dss.py               계통 → OpenDSS 스크립트 변환 (조류 계산용, 고장 해석용)
│   ├── simulate.py          조류 계산·고장 해석 함수 (자체 점검: python -m simulation.simulate)
│   └── plot.py              결과 그래프 함수 (matplotlib → PNG)
├── ai_report/
│   ├── models.py            리포트 형식 (진단, 원인, 솔루션)
│   └── report.py            리포트 생성: 판정 기준으로 문제 항목 계산 → 프롬프트 구성 → Claude 호출(tool use) → Report (자체 점검: python -m ai_report.report)
├── frontend/
│   ├── src/
│   │   ├── main.jsx         React 시작점
│   │   ├── App.jsx          화면 흐름: 변전소 선택 → 단선도 → 시뮬레이션 → 결과·그래프·리포트
│   │   ├── styles.css       다크모드 화면 스타일 (색은 맨 위 변수)
│   │   ├── components/
│   │   │   ├── Diagram.jsx      다크모드 단선도 뷰어·편집기 (Cytoscape.js), 결과 오버레이
│   │   │   ├── NavDrawer.jsx    왼쪽 편집 메뉴 (☰로 열기, 설비 7종 끌어다 놓기, 선로 그리기, 되돌리기·삭제)
│   │   │   ├── PropertyPanel.jsx 선택한 설비·선로·변전소 속성 편집, 계산값, 시뮬레이션 전 빠진 항목
│   │   │   ├── ResultPanel.jsx  단선도 위 건강도 요약 줄·범례, 결과 창(① 건강도 진단 ② 원인 분석 ③ 솔루션 제언·요소별 결과·기록 탭)
│   │   │   ├── HistoryChart.jsx 결과 기록(시점별) 작은 그래프들
│   │   │   ├── Modal.jsx, SubstationDialog.jsx  가운데 창, 새 변전소·이름 바꾸기 창
│   │   │   └── PopupWindow.jsx  결과를 브라우저 새 창으로 띄우기
│   │   ├── lib/
│   │   │   ├── graphEdit.js     편집 로직 (노드·선로 추가·삭제, 피더·선로 방향 정리, 저장 스냅샷)
│   │   │   └── overlay.js       시뮬레이션 결과 → 단선도 색·두께·화살표, 판정 기준
│   │   └── api/client.js    백엔드 API 호출 함수 (실패 시 백엔드의 이유를 메시지에 포함)
│   ├── mock/mock_server.py  프론트엔드 개발용 모의 백엔드 (Neo4j·OpenDSS·LLM 없이 한전 XML로 응답)
│   ├── vite.config.js       /api 요청을 백엔드(localhost:8000)로 전달
│   └── package.json         프론트엔드 라이브러리 (react, cytoscape)
├── data/                    한전 제공 원본 (korean_distribution_cim.xml, 출처 NOTICE.md)
├── CONTRIBUTING.md          협업 규칙, 구현 상태, 폴더 간 연결
├── docker-compose.yml       Neo4j 실행 설정
├── requirements.txt         Python 라이브러리
└── .env.example             접속 정보·API 키 양식 (.env로 복사해서 사용)
```

`.gitignore`, `frontend/index.html`, `frontend/.oxlintrc.json` 같은 기본 설정 파일은 생략했습니다.

## 작동 방식

**해석 범위**: 22.9kV 배전계통, 3상 평형(정상분 1상 등가), 방사형 계통, 한 시점 계산, 3상 단락만. 데이터 형식(`cim/models.py`)과 OpenDSS 변환(`simulation/dss.py`)이 이 범위를 전제로 합니다.

```
data/ (한전 원본 CIM XML) ──cim/load.py──▶ Neo4j
                                   ▲
frontend ──HTTP──▶ backend ────────┤ cim/graph.py (조회·스냅샷 저장)
                      │
                      ├──▶ simulation/simulate.py ──▶ 시뮬레이션 결과
                      │      └─ simulation/dss.py (계통 → OpenDSS 스크립트)
                      ├──▶ simulation/plot.py     ──▶ 결과 그래프 (PNG)
                      └──▶ ai_report/report.py   ──▶ AI 리포트 (계통 정보 + 시뮬레이션 결과)
```

1. **적재** (FR-01, 02): `python -m cim.load` 실행 → `cim/load.py`가 `data/`의 한전 원본 CIM XML을 rdflib로 읽어(`read_raw`) 매핑 가이드(`cim/mapping.py`)대로 공통 모델로 변환하고(`to_substation_graphs`, 선로 방향·피더 소속은 `cim/topology.py`) Neo4j에 저장(`save_to_neo4j`). 웹이 아니라 명령어로 실행
2. **조회** (FR-02, 05): 변전소 단위로 읽음. `GET /api/substations` → `GET /api/substations/{id}` → `cim/graph.py`의 `get_substation`이 피더·노드·선로를 읽고, 좌표는 DiagramObject에서, `bus_id`는 `CONNECTED_TO` 관계에서 읽어 돌려줌
   - **편집 스냅샷 저장** (FR-06, 07, 제안서 4단계): 편집 중 새로 만든 노드·선로에는 프론트엔드가 `crypto.randomUUID()`로 UUID를 바로 할당 → 편집을 마치면 변전소 계통 전체(`SubstationSnapshot`, 형식은 `SubstationGraph`와 같음)를 `PUT /api/substations/{id}`로 보냄 → `save_substation`이 한 트랜잭션으로 저장
     - 이미 Neo4j에 있는 변전소만 저장할 수 있음 (없는 id는 404). 변전소 속성은 저장된 값을 그대로 쓰고, 스냅샷의 `substation`은 주소 id 확인에만 씀
     - 전원(source) 노드가 정확히 1개이고 그 `bus_id`가 스냅샷 안의 노드여야 저장됨 (아니면 422). 노드·선로 id 중복, 선로 양 끝 누락도 422
     - 주소의 id와 `substation.id`가 다르면 422 (`backend/api/grid.py`)
     - 서버가 다시 계산하는 값: 선로의 연결 특성(`kind`, `classify_connection`), 선로 방향(전원 쪽 = from)과 피더 소속(차단기마다 피더 하나, `cim/topology.py`). 스냅샷의 `feeders`는 쓰지 않음
     - 좌표는 설비 노드와 분리된 좌표 메타데이터 노드(DiagramObject)에 저장
     - 스냅샷에 없는 기존 피더·노드·선로와 연결이 끊긴 DiagramObject는 삭제 (가비지 컬렉션)
     - 응답으로 UUID → Neo4j element id 대응표(`element_ids`)를 돌려줌
3. **시뮬레이션** (FR-03, 04): 프론트엔드 → `POST /api/substations/{id}/simulations` → 백엔드가 `cim/graph.py`로 계통을 읽어 `simulation/simulate.py`에 넘김 → `simulation/dss.py`가 OpenDSS 스크립트로 변환 → `simulate.py`가 실행해 결과 반환 → 결과를 프론트엔드가 단선도에 표시
   - **OpenDSS 변환** (`dss.py`): 접속점·차단기·개폐기 노드가 OpenDSS 버스가 되고, 전원·부하·분산전원은 `bus_id`의 버스에 붙음. 열린 개폐기에 닿은 선로는 `enabled=no`로 끊어 그 아래 구간은 전압 0
   - **계산 순서** (`simulate.py`): 방사형 검사·실제 조류 방향 찾기 → 조류 계산 → 전압·선로 조류·손실·피더 송출 전력 → 고장 해석 → 지점별 3상 단락 전류
     - 완성·방사형 검사 (`dss.py`의 `check_complete`, `trace`): 전원 1개·피더별 차단기 1개·출력·`bus_id`가 빠졌거나, 전원에서 닫힌 선로를 따라가다 루프가 있으면 422. 같은 탐색으로 각 선로의 실제 전원 쪽과 전원으로부터 거리를 구함
     - 역조류는 저장된 `from_node_id`가 아니라 실제 전원 쪽 기준으로 판정 (편집 중 선을 거꾸로 그려도 맞게 나옴). `p_kw` 부호는 저장된 from → to 기준
     - 전원에서 닿지 않는 노드(열린 개폐기 아래)는 정전: `energized=False`, 전압 0, 고장전류 없음. 저전압과 구분
     - OpenDSS 명령 오류·수렴 실패는 계산을 멈추고 422로 알림 (잘못된 결과가 그래프·리포트로 넘어가지 않음)
     - 조류 계산 때 전원 임피던스는 거의 0으로 두어 변전소 모선 전압이 `source_voltage_pu`로 유지되고, 고장 해석 직전에만 `short_circuit_mva`·`x_r_ratio`를 넣음
     - 데이터에 없는 값은 가정값으로 계산 (`dss.py`의 `DEFAULT_*`): 단락용량 300 MVA, X/R 10, 허용전류 400 A. 실제 값이 데이터에 있으면 그 값이 우선. 가정값으로 낸 고장전류·부하율은 실제 설비 기준이 아님
     - 태양광·풍력은 인버터 전원으로 보고 고장 전류 기여를 정격의 약 1.2배로 계산 (`Xdp=1`)
     - OpenDSS 엔진은 프로세스에 하나라 동시 요청은 차례로 처리
   - **4대 시뮬레이션** (제안서 3단계): 결과 형식(`simulation/models.py`)에 아래 항목이 있음

     | 시뮬레이션 | 결과 필드 |
     |-----------|-----------|
     | 전압 영향 | `NodeResult.voltage_pu` (정전 구간은 `energized=False`, 저전압과 구분) |
     | 선로 과부하 | `LineResult.loading_pct` (허용전류 대비 %) |
     | 역조류 | `LineResult.reverse_flow` |
     | 단락용량 고장전류 | `NodeResult.fault_current_ka` |
     | 변전소 출구 차단기(CB) 옆 피더별 송출 전력 | `SimulationResult.feeders` (`FeederResult.p_kw`, `q_kvar`, 화면에는 MW·MVAr 황색 표시) |

   - **결과 그래프**: 프론트엔드가 받은 결과를 `POST /api/plots`로 보냄 → 백엔드가 계통 정보와 함께 `simulation/plot.py`에 넘김 → matplotlib으로 그린 PNG를 받아 화면에 표시
     - 위: 변전소로부터 거리별 전압 프로파일 (정상 범위 밖은 빨간 점, 정전 구간은 그리지 않음) / 아래: 선로별 유효전력 조류 (역조류 주황, 과부하 빨강, 부하율 %)
4. **AI 리포트** (FR-08, 09): 프론트엔드가 받은 시뮬레이션 결과를 `POST /api/reports`로 보냄 → 백엔드가 `cim/graph.py`로 같은 계통 정보를 읽어 결과와 함께 `ai_report/report.py`에 넘김 → 진단·원인·솔루션 리포트 생성
   - **확정된 사실은 코드가 계산** (`check_findings`): 저전압·과전압·과부하·역조류·정전 항목과 건강도 등급(양호·주의·개선 필요)을 `simulation/models.py`의 판정 기준으로 먼저 정해 프롬프트에 "확정된 점검 결과"로 넣음. LLM은 이 사실을 쉬운 말로 풀어 설명만 하고 등급을 바꾸지 않음 (환각 대응, 제안서 10장)
   - **프롬프트** (`build_prompt`): 확정된 점검 결과, 피더별 송출 전력, 부하·분산전원이 붙은 접속점, 지점별 전압·단락전류, 선로별 연결·부하율·조류. 표가 길면(120줄 초과) 문제가 큰 순으로 자름
   - **형식 고정**: Claude tool use(`submit_report`)로 진단 1개, 원인 목록, 솔루션 목록을 받음. 형식이 어긋나면 `ReportError`
   - **가정값 표시**: 허용전류·단락용량이 데이터에 없어 `simulation/dss.py`의 `DEFAULT_*`로 계산된 경우 그 사실을 프롬프트에 넣어 리포트에 "가정값 기준"이라고 밝히게 함
   - 모델은 `.env`의 `ANTHROPIC_MODEL`, 없으면 `DEFAULT_MODEL`. 회의록의 "사용할 Claude 모델"이 정해지면 바꿈

### 편집 → 시뮬레이션 → 리포트

비전문가도 쓸 수 있도록, 시뮬레이션할 때마다 리포트로 설명을 보여 줍니다. 이 화면 흐름은 `frontend/src/App.jsx`에 있습니다.

```
변전소 선택 → GET /api/substations/{id} → 다크모드 단선도 표시 (Diagram.jsx) → 바로 시뮬레이션
편집 (노드 추가·이동·삭제, 선로 그리기, 속성) → 새 설비에 UUID 할당
   → 0.8초 동안 더 안 고치면 자동으로 PUT /api/substations/{id}
   → 계산에 영향을 주는 값이 바뀌었으면 자동으로 시뮬레이션 (위치만 옮겼으면 다시 계산하지 않음)
결과 도착 → 단선도 위 요약 줄·오버레이 갱신, 결과 기록(시점별)에 한 줄 추가
         └→ 자동으로 POST /api/plots → 그래프 도착하면 결과 창에 표시
결과 창의 "AI 리포트 만들기" 버튼 → POST /api/reports → 리포트 표시
```

- 시뮬레이션과 리포트 API를 나눈 이유: LLM 응답(수 초~수십 초)을 기다리지 않고 결과를 먼저 보여 주기 위해
- 리포트를 자동으로 만들지 않는 이유: 편집할 때마다 다시 계산되므로, 매번 LLM을 부르면 비용·시간이 너무 든다
- 리포트가 만들어지는 중에 새 시뮬레이션이 끝나거나 변전소를 바꾸면, 이전 결과·그래프·리포트는 버리고 마지막 요청의 것만 표시 (`App.jsx`의 `runId`)
- 리포트에는 계통 정보(설비 이름·종류·연결)와 해석 수치(전압 pu, 선로 부하율, 고장전류, 역조류, 피더별 송출 전력)가 구조화된 텍스트로 들어가므로 "어느 구간이 왜 문제인지"를 설명할 수 있음
- 시뮬레이션마다 LLM을 호출하므로 API 사용량을 확인하고, 한전 수치를 외부 LLM에 보내도 되는지 한전 측에 확인

## 실행

필요한 것: Python 3.14, Node.js 24, Docker Desktop

아래 명령은 Windows PowerShell 기준입니다.

```powershell
# 처음 한 번
cp .env.example .env              # NEO4J_PASSWORD, ANTHROPIC_API_KEY 입력
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd frontend
npm install
cd ..

# Neo4j (저장소 루트)
docker compose up -d

# 데이터 적재 (저장소 루트·가상환경 활성화 후). --dry-run이면 Neo4j 없이 변환 결과만 출력
python -m cim.load

# 시뮬레이션 자체 점검 (Neo4j 불필요, 한전 CIM XML로 조류 계산·고장 해석 실행)
python -m simulation.simulate

# 백엔드 (저장소 루트, 가상환경 활성화 후)
uvicorn backend.main:app --reload --port 8000 --env-file .env

# 프론트엔드
cd frontend
npm run dev

# (선택) Neo4j·Docker 없이 화면만 개발할 때: 위 백엔드 대신 모의 백엔드 실행
python frontend/mock/mock_server.py
```

http://localhost:5173 에 "서버 ok, Neo4j connected"가 보이면 정상입니다. 변전소 목록이 비어 있으면 `python -m cim.load`로 데이터를 먼저 적재합니다.

`.env` 항목

| 항목 | 쓰는 곳 |
|------|---------|
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` | Docker(Neo4j), 백엔드, `python -m cim.load` |
| `ANTHROPIC_API_KEY` | AI 리포트 (`ai_report/report.py`). 백엔드만 읽으며, 프론트엔드 코드에는 넣지 않음 |
| `ANTHROPIC_MODEL` | (선택) AI 리포트에 쓸 모델 이름. 비우면 `DEFAULT_MODEL` |

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

## 참고자료

- IEC 61970/61968 Common Information Model (CIM) 전력 표준 스펙 문서
- OpenDSS (Open Distribution System Simulator) 공식 명령어 매뉴얼, 미국전력연구원(EPRI)
- https://github.com/1004aiteam-power/open_dss_project : 동작 원리 및 예시 코드 (변전소 2, 배전선로 2)
