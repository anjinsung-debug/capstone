# 배전계통 통합 분석 플랫폼

팀 으라차차: 안진성, 고영민, 최민준, 한승우

이 README는 항상 현재 저장소의 디렉토리 구성과 작동 방식을 나타냅니다. 바꾸는 방법은 아래 [README 갱신 규칙](#readme-갱신-규칙)을 따릅니다.

## 디렉토리 구성

| 폴더 | 역할 | 담당 |
|------|------|------|
| `frontend/` | 웹 화면 (React, Vite), 단선도 (Cytoscape.js) | 고영민, 최민준 |
| `backend/` | API 서버 (FastAPI) | 안진성, 한승우 |
| `cim/` | 한전 데이터 → CIM 변환, Neo4j 적재·조회·편집 저장 | 한승우 |
| `simulation/` | 계통 → OpenDSS 변환, 4대 시뮬레이션, 결과 그래프 (matplotlib) | 안진성 |
| `ai_report/` | LLM 리포트 생성 | 고영민, 최민준 |
| `data/` | 한전 제공 원본 CIM XML (공개 허락받은 파일만 git에 올림) | 공용 |
| `docs/` | OpenDSS 시뮬레이션 데이터 대응표, 전기·전자 용어표 | 공용 |

```
capstone/
├── docs/
│   ├── opendss_simulation_data.md  시뮬레이션별 입력·가정·설정·결과 대응표
│   └── electrical_glossary.md     전기·전자 용어표
├── backend/
│   ├── main.py              앱 생성, 시작·종료 시 Neo4j 연결·해제, 오류 → HTTP 상태 (미구현 501, 없는 변전소 404, 잘못된 스냅샷·시뮬레이션 불가 422)
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
│   └── report.py            리포트 생성 함수
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
├── docker-compose.yml       Neo4j 실행 설정
├── requirements.txt         Python 라이브러리
└── .env.example             접속 정보·API 키 양식 (.env로 복사해서 사용)
```

`.gitignore`, `frontend/index.html`, `frontend/.oxlintrc.json` 같은 기본 설정 파일은 생략했습니다.

## 협업 규칙

### 담당 폴더 규칙

각자 위 표에서 자신이 담당한 폴더의 코드만 수정합니다.
다른 담당자의 폴더를 고쳐야 할 때는 직접 수정하지 않고 그 담당자에게 요청합니다.
README, `requirements.txt`, `docker-compose.yml`, `.env.example` 같은 공용 파일은 아래 공유 형식 파일과 같은 방식으로 팀에 알리고 PR로 합칩니다.

### 공유 형식 파일 변경 규칙

`cim/models.py`, `simulation/models.py`, `ai_report/models.py`, `frontend/src/api/client.js`는 여러 폴더가 함께 쓰는 약속입니다.
이 파일을 바꿀 때는 먼저 팀에 알리고, PR로 영향받는 담당자의 확인을 받은 뒤 합칩니다.

### 주석 규칙

Claude Code가 코드를 읽고 맥락을 파악하거나 우리에게 되물을 수 있도록, 코드에 이유와 연결 관계를 주석으로 남깁니다 (2026-10-09 팀 합의).

| 표시 | 쓰는 곳 | 예시 |
|------|---------|------|
| 파일 맨 위 설명 | 이 파일이 하는 일, 담당, 연결된 다른 파일 | `cim/graph.py`, `frontend/src/App.jsx` 머리말 |
| `ponytail:` | 일부러 단순하게 만든 부분 + 언제 바꿀지 | `# ponytail: OpenDSS 엔진은 프로세스에 하나라 … 느려지면 요청별 프로세스로 분리` |
| `구현 참고 (이름):` | 다른 담당자가 알아야 하거나 확인해 줘야 할 것 | `// 구현 참고 (한승우 확인 필요): …` |
| `<파일>의 <함수>와 같은 규칙` | 다른 폴더와 값·규칙을 맞춘 곳 (바꾸면 같이 고칠 곳) | `// simulation/dss.py의 check_complete와 같은 규칙` |

### README 갱신 규칙

아래가 바뀌면 같은 PR에서 README도 함께 고칩니다.

| 바뀐 것 | 고칠 곳 |
|---------|---------|
| 파일·폴더 추가, 삭제, 이름 변경 | 디렉토리 구성 |
| 기능 구현 완료, 새 기능 추가 | 구현 상태 |
| API 경로, 데이터 흐름 | 작동 방식, 폴더 간 연결 |
| 실행 방법, 라이브러리, 환경 변수 | 실행, Neo4j 연결 |

## 구현 상태

| 기능 | 위치 | 상태 |
|------|------|------|
| 서버 실행, Neo4j 연결 | `backend/main.py`, `cim/db.py`, `backend/api/health.py` | 동작 |
| 계통 입력 검사 (선로 양 끝, `bus_id` 대상, 개폐기만 `is_open`) | `cim/models.py` | 동작 (API 요청·응답 시 자동 검사, 잘못되면 422). 저장 API는 여기에 더해 전원 1개를 요구 (`cim/graph.py`) |
| 계통 완성 검사 (전원 1개, 피더별 차단기 1개, 부하·분산전원 출력·`bus_id`) | `simulation/dss.py`의 `check_complete` | 동작 (시뮬레이션 직전, 부족하면 422와 빠진 항목) |
| 프론트엔드 → 백엔드 API 호출 | `frontend/src/api/client.js` | 동작 |
| 한전 데이터 적재 | `cim/load.py`, `cim/mapping.py` | 동작 (`--dry-run`이면 Neo4j 없이 변환 결과만 출력) |
| 변전소 계통 조회 | `cim/graph.py`의 `list_substations`, `get_substation` | 동작 (없는 변전소는 404) |
| 편집 스냅샷 저장 (4단계) | `cim/graph.py`의 `save_substation` | 동작 (이미 있는 변전소만, 전원 노드 1개 필요) |
| 연결 특성 자동 구분 (위상 형성 논리) | `cim/graph.py`의 `classify_connection` | 동작 (차단기·개폐기에 닿으면 `switch`, 그 외 `line`) |
| OpenDSS 스크립트 변환 (2단계) | `simulation/dss.py` | 동작 |
| 4대 시뮬레이션 (3단계) | `simulation/simulate.py` | 동작 (한전 CIM XML로 자체 점검 통과: 역조류 방향, 루프 검출, 정전 구간, 오류 처리 포함) |
| 결과 그래프 (matplotlib) | `simulation/plot.py` | 동작 (전압 프로파일, 선로별 조류·역조류·과부하) |
| AI 리포트 | `ai_report/report.py` | 틀만 있음 |
| 화면 흐름 (선택 → 시뮬레이션 → 결과·리포트) | `frontend/src/App.jsx` | 동작 (리포트 API 구현 전에는 501 메시지 표시) |
| 다크모드 단선도 표시 (Cytoscape.js) | `frontend/src/components/Diagram.jsx` | 동작 (설비 종류별 모양·색, 직각 선로, 붙임선 점선) |
| 단선도 편집 UI | `Diagram.jsx`, `NavDrawer.jsx`, `PropertyPanel.jsx`, `lib/graphEdit.js` | 동작 (☰ 메뉴에서 설비 끌어다 놓기, 선로 그리기, 격자·가이드라인 정렬, 속성 편집, 삭제, 되돌리기, 변전소 이름 바꾸기, **바꿀 때마다 자동 저장 → 자동 재계산**. 진짜 백엔드는 이미 있는 변전소만 저장하므로 "새 변전소"는 모의 서버에서만 저장됨) |
| 결과 오버레이 | `Diagram.jsx`, `lib/overlay.js` | 동작 (전압 색, 부하율 굵기, 역조류·조류 방향 화살표, 정전 흐림, 고장전류 표시 전환, 차단기 옆 피더 송출 MW·MVAr) |
| 결과·그래프·리포트 표시 | `frontend/src/components/ResultPanel.jsx`, `lib/overlay.js` | 동작 (제안서 슬라이드 8·10~13 기준: 단선도 표시 모드 건강도/① 전압/② 과부하/③ 역조류/④ 단락용량, 계통건강도 진단표(정상·주의·위험), 원인 분석, 솔루션 제언, 요소별 결과와 위치 이동 버튼, 시점별 기록. AI 해설은 버튼으로 생성) |
| 프론트엔드 모의 백엔드 | `frontend/mock/mock_server.py` | 동작 (조회·저장·근사 시뮬레이션·그래프·예시 리포트. Neo4j·Docker 없이 화면 개발용, 진짜 백엔드와 다른 점은 파일 맨 위 설명) |

틀만 있는 함수는 `NotImplementedError`를 내고, 해당 API는 501을 돌려줍니다. 없는 변전소는 `SubstationNotFound`로 404, 규칙에 맞지 않는 편집 스냅샷은 `InvalidSnapshot`으로 422를 돌려줍니다. 시뮬레이션이 계산할 수 없는 계통(미완성, 루프, 잘못된 값, 수렴 실패)은 `SimulationError`로 422와 이유를 돌려줍니다 (`backend/main.py`).

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

## 폴더 간 연결

| 연결 | 정의된 곳 |
|------|-----------|
| 프론트엔드 → 백엔드 API | `frontend/src/api/client.js`, `backend/api/` (형식은 http://localhost:8000/docs) |
| 계통 데이터 형식, Neo4j 구조 | `cim/models.py`, `cim/graph.py`, `cim/schema.cypher` |
| 선로 방향·피더 소속 계산 | `cim/topology.py`의 `trace_feeders` (`cim/load.py` 적재, `cim/graph.py` 저장이 같이 씀) |
| Neo4j 연결 | `cim/db.py` (접속 정보는 `.env`) |
| 한전 데이터 → Neo4j 적재 | `cim/load.py` (명령어 `python -m cim.load`, `cim/mapping.py` 대응표대로 `cim/models.py` 형식으로 저장) |
| 시뮬레이션 결과 형식 | `simulation/models.py` |
| 리포트 형식 | `ai_report/models.py` |
| 백엔드 → 각 모듈 함수 | `cim/graph.py`, `simulation/simulate.py`, `simulation/plot.py`, `ai_report/report.py` |
| 시뮬레이션 → OpenDSS 변환 | `simulation/simulate.py` → `simulation/dss.py`의 `to_dss_script`, `fault_study_script` |
| 화면 → 화면 부품 | `frontend/src/App.jsx` → `components/Diagram.jsx`(단선도), `components/ResultPanel.jsx`(결과·그래프·리포트) |

## 한전 데이터 → CIM 모델 정하기

원본 데이터는 한전이 제공한 가상 계통의 CIM16 XML(`data/korean_distribution_cim.xml`)입니다. 변전소 1개, 배전선로 1개(이진트리, 선로 11·부하 8·태양광 4)이고, 출처는 `data/NOTICE.md`에 있습니다. 매핑 가이드(CIM 클래스·속성 → 공통 모델 필드 대응표)는 한전에서 받지 않고 팀이 CIM 기준으로 작성했으며 `cim/mapping.py`에 있습니다.

1. **매핑 가이드** (`cim/mapping.py`): CIM 클래스·속성 → `cim/models.py` 필드 대응표, 단위 환산, XML에 없는 값의 출처. 매핑 규칙을 바꿀 때는 이 파일만 고침
2. **`cim/models.py`**: 대응표에 필요한 필드가 없으면 추가 (공유 형식 파일 변경 규칙대로)
3. **적재 코드** (`cim/load.py`): `read_raw`(CIM XML 읽기), `to_substation_graphs`(대응표대로 변환), `save_to_neo4j`(저장)

### 항목을 정하는 기준

| 쓰는 곳 | 필요한 정보 | 현재 모델 필드 |
|---------|-------------|----------------|
| 조류 계산·전압 영향 | 기준 전압, 변전소 모선 전압, 연결 관계(선로, 설비가 붙은 접속점), 선로 길이·정상분 임피던스, 부하 크기(3상 합계, 한 시점) | `BASE_KV`(22.9 고정), `Substation.source_voltage_pu`, `from_node_id`, `to_node_id`, `bus_id`, `length_km`, `r_ohm_per_km`, `x_ohm_per_km`, `p_kw`, `q_kvar` |
| 선로 과부하 | 선로 허용전류 | `Line.rated_current_a` |
| 역조류 | 분산전원(태양광·풍력) 출력, 평소 조류 방향 | `type`이 `pv`·`wind`인 노드의 `p_kw`·`q_kvar`, 선로의 `from_node_id`(전원 쪽) |
| 3상 단락 고장전류 | 변전소 전원 3상 단락용량, X/R | `Substation.short_circuit_mva`, `Substation.x_r_ratio` |
| 단선도 화면 | 위치, 이름, 종류, 변전소 출구 차단기(CB), 개폐기 열림·닫힘, 소속 피더 | `x`, `y`(DiagramObject), `name`, `type`(`breaker`·`switch` 포함), `is_open`, `feeder_id` |
| AI 리포트 | 설비 이름·종류·연결 관계 (시뮬레이션 결과와 함께 사용) | `name`, `type`, `kind`, `from_node_id`, `to_node_id` |

현재 모델은 제안서 요구를 반영해 두었고, 남은 설계 항목은 모두 아래 기본값으로 정했습니다. CIM XML과 형태가 다른 부분은 매핑 가이드에 적고 `cim/load.py`에서 변환합니다.

| 항목 | 기본값 | 코드 |
|------|--------|------|
| 계통 구조 | 방사형 (열린 개폐기로 끊은 뒤 기준) | `cim/models.py` 설명 |
| 설비 종류 | source·breaker·switch·bus·load·pv·wind 7종 (변압기 없음). 개폐기(`switch`)는 열림·닫힘(`is_open`)을 가짐 | `NodeType`, `Node.is_open` |
| 설비 연결 | 단자 1개 설비(source·load·pv·wind)는 선로 없이 `bus_id`로 접속점(`bus`)에 붙음 (CIM `Terminal.ConnectivityNode`, Neo4j `CONNECTED_TO`). 차단기·개폐기·접속점끼리는 선로(`Line`)로 연결 | `Node.bus_id`, `ONE_TERMINAL_TYPES` |
| 연결 특성 | 차단기·개폐기에 닿은 연결은 `switch`(OpenDSS `Line switch=yes`), 그 외 `line`. 열린 개폐기에 닿은 연결은 끊고 계산 | `LineKind`, `classify_connection` |
| 판정 기준 | 전압 0.95~1.05 pu (OpenDSS 기본 정상 범위), 부하율 100% 초과면 과부하 | `simulation/models.py`의 `VOLTAGE_MIN_PU`, `VOLTAGE_MAX_PU`, `OVERLOAD_PCT` |
| Neo4j 이름 | 내부 이름(`Node`, `LINE`)을 쓰고 CIM 클래스는 주석으로 대응 | `cim/models.py`, `cim/graph.py` |

현재 모델의 구조:

- 해석 범위: 22.9kV(`BASE_KV`), 3상 평형, 방사형, 한 시점, 3상 단락만. 전력은 3상 합계, 임피던스는 정상분, 선로 정전용량은 무시
- 선로의 `from_node_id`는 전원 쪽. 조류가 to → from으로 흐르면 역조류
- 허용전류·단락용량이 없으면 시뮬레이션이 가정값(`simulation/dss.py`의 `DEFAULT_*`)으로 계산
- 설비 종류: 변전소 전원(`source`), 출구 차단기(`breaker`), 선로 중간 개폐기(`switch`, 열림·닫힘 `is_open`), 접속점(`bus`), 부하(`load`), 분산전원 태양광(`pv`)·풍력(`wind`). CIM 클래스 대응은 `cim/models.py` 주석
- 좌표(x, y)는 설비 속성과 분리된 좌표 메타데이터 노드(DiagramObject)에 저장
- 변전소 하나에 피더 여러 개, 피더는 출구 차단기 하나에서 시작

### 매핑 결과 요약 (자세한 표는 `cim/mapping.py`)

- 클래스: `ConnectivityNode` → `bus`, `BusbarSection` → `source`, 변전소 안 `Breaker` → `breaker`(피더 시작점), 그 밖의 `Breaker`·`LoadBreakSwitch`·`Recloser`·`Disconnector`·`Fuse` → `switch`, `ACLineSegment` → 선로, `EnergyConsumer` → `load`, `SolarGeneratingUnit`·`PhotoVoltaicUnit` → `pv`, `WindGeneratingUnit` → `wind`
- 단위 환산: 전력은 W·var → kW·kvar (÷1000), 임피던스는 구간 전체 Ω → Ω/km (÷ 길이). `Conductor.length`는 값 범위로 보아 km
- 위상: 단자 1개 설비는 `bus_id`, 차단기·개폐기는 양쪽 접속점과 길이 0인 `switch` 선로 2개로 연결. 선로 방향(전원 쪽 = from)은 전원에서 너비 우선 탐색으로 정함
- `id`는 `IdentifiedObject.mRID`
- XML에 없어 만들어 내는 값: 피더(차단기마다 하나, 열린 개폐기 전까지 소속), 단선도 좌표(전원을 뿌리로 한 트리 배치), 태양광 한 시점 출력(정격 `nominalP` 사용)
- XML에 없어 비워 두는 값: 변전소 3상 단락용량·X/R, 선로 허용전류. 시뮬레이션은 이 값이 없으면 가정값(300 MVA, X/R 10, 400 A)으로 계산

시뮬레이션 담당과 프론트엔드 담당은 필요한 항목이 빠지지 않았는지 확인합니다.

### 각자 데이터 준비

1. `git pull`로 `data/korean_distribution_cim.xml` 받기 (저장소에 포함)
2. 저장소 루트에서 `python -m cim.load` 실행해 자기 PC의 Neo4j에 저장 (다시 적재할 때는 `--reset`)

같은 원본과 같은 적재 코드를 쓰므로 모두 같은 데이터를 갖게 됩니다. 웹에서 편집한 내용은 자기 DB에만 남고, 다시 적재하면 처음 상태로 돌아갑니다.

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
