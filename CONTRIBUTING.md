# 협업 가이드

프로젝트 개요·실행 방법·파일 구성은 [README](README.md)에 있습니다. 이 문서는 함께 개발할 때의 규칙과 개발 현황을 담습니다.

## 협업 규칙

### 담당 폴더 규칙

각자 [README의 디렉토리 구성](README.md#디렉토리-구성) 표에서 자신이 담당한 폴더의 코드만 수정합니다.
다른 담당자의 폴더를 고쳐야 할 때는 직접 수정하지 않고 그 담당자에게 요청합니다.
README, 이 문서, `docs/`, `requirements.txt`, `docker-compose.yml`, `.env.example` 같은 공용 파일은 아래 공유 형식 파일과 같은 방식으로 팀에 알리고 PR로 합칩니다.

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

### 문서 갱신 규칙

아래가 바뀌면 같은 PR에서 문서도 함께 고칩니다.

| 바뀐 것 | 고칠 곳 |
|---------|---------|
| 파일·폴더 추가, 삭제, 이름 변경 | README의 디렉토리 구성 |
| 기능 구현 완료, 새 기능 추가 | 이 문서의 구현 상태 |
| API 경로, 데이터 흐름 | README의 작동 방식, `docs/how_it_works.md`, 이 문서의 폴더 간 연결 |
| 실행 방법, 라이브러리, 환경 변수 | README의 실행 |
| CIM 매핑 규칙, 모델 항목 | `docs/cim_mapping.md` |

## 구현 상태

| 기능 | 위치 | 상태 |
|------|------|------|
| 서버 실행, Neo4j 연결 | `backend/main.py`, `cim/db.py`, `backend/api/health.py` | 동작 |
| 계통 입력 검사 (선로 양 끝, `bus_id` 대상, 개폐기만 `is_open`) | `cim/models.py` | 동작 (API 요청·응답 시 자동 검사, 잘못되면 422). 저장 API는 여기에 더해 전원 1개를 요구 (`cim/graph.py`) |
| 계통 완성 검사 (전원 1개, 피더별 차단기 1개, 부하·분산전원 출력·`bus_id`) | `simulation/dss.py`의 `check_complete` | 동작 (시뮬레이션 직전, 부족하면 422와 빠진 항목) |
| 프론트엔드 → 백엔드 API 호출 | `frontend/src/api/client.js` | 동작 |
| 한전 데이터 적재 | `cim/load.py`, `cim/mapping.py` | 동작 (`--dry-run`이면 Neo4j 없이 변환 결과만 출력) |
| 변전소 계통 조회 | `cim/graph.py`의 `list_substations`, `get_substation` | 동작 (없는 변전소는 404) |
| 편집 스냅샷 저장 (4단계) | `cim/graph.py`의 `save_substation` | 동작 (없는 변전소는 새로 만듦, 전원 노드 1개 필요. 이미 있는 변전소는 이름만 바뀜) |
| 연결 특성 자동 구분 (위상 형성 논리) | `cim/graph.py`의 `classify_connection` | 동작 (차단기·개폐기에 닿으면 `switch`, 그 외 `line`) |
| OpenDSS 스크립트 변환 (2단계) | `simulation/dss.py` | 동작 |
| 4대 시뮬레이션 (3단계) | `simulation/simulate.py` | 동작 (한전 CIM XML로 자체 점검 통과: 역조류 방향, 루프 검출, 정전 구간, 오류 처리 포함) |
| 결과 그래프 (matplotlib) | `simulation/plot.py` | 동작 (전압 프로파일, 선로별 조류·역조류·과부하) |
| AI 리포트 | `ai_report/report.py` | 동작 (프로토타입. 확정된 점검 결과를 코드가 계산해 LLM에 넘기고, 실패하면 503과 이유. 실제 API 호출은 `ANTHROPIC_API_KEY`가 있는 환경에서 `python -m ai_report.report --call`로 확인) |
| 화면 흐름 (선택 → 시뮬레이션 → 결과·리포트) | `frontend/src/App.jsx` | 동작 (편집하면 자동 저장 후 자동 재계산, AI 리포트는 결과 창 버튼으로 생성하고 실패하면 이유를 "AI 리포트 실패" 메시지로 표시) |
| 다크모드 단선도 표시 (Cytoscape.js) | `frontend/src/components/Diagram.jsx` | 동작 (설비 종류별 모양·색, 직각 선로, 붙임선 점선) |
| 단선도 편집 UI | `Diagram.jsx`, `NavDrawer.jsx`, `PropertyPanel.jsx`, `lib/graphEdit.js` | 동작 (☰ 메뉴에서 설비 끌어다 놓기, 선로 그리기, 격자·가이드라인 정렬, 속성 편집, 삭제, 되돌리기, 변전소 이름 바꾸기, **바꿀 때마다 자동 저장 → 자동 재계산**. "새 변전소"도 진짜 백엔드에 저장됨) |
| 결과 오버레이 | `Diagram.jsx`, `lib/overlay.js` | 동작 (전압 색, 부하율 굵기, 역조류·조류 방향 화살표, 정전 흐림, 고장전류 표시 전환, 차단기 옆 피더 송출 MW·MVAr) |
| 결과·그래프·리포트 표시 | `frontend/src/components/ResultPanel.jsx`, `lib/overlay.js` | 동작 (제안서 슬라이드 8·10~13 기준: 단선도 표시 모드 건강도/① 전압/② 과부하/③ 역조류/④ 단락용량, 계통건강도 진단표(정상·주의·위험), 원인 분석, 솔루션 제언, 요소별 결과와 위치 이동 버튼, 시점별 기록. AI 해설은 버튼으로 생성) |
| 프론트엔드 모의 백엔드 | `frontend/mock/mock_server.py` | 동작 (조회·저장·근사 시뮬레이션·그래프·예시 리포트. Neo4j·Docker 없이 화면 개발용, 진짜 백엔드와 다른 점은 파일 맨 위 설명) |

틀만 있는 함수는 `NotImplementedError`를 내고, 해당 API는 501을 돌려줍니다. 없는 변전소는 `SubstationNotFound`로 404, 규칙에 맞지 않는 편집 스냅샷은 `InvalidSnapshot`으로 422를 돌려줍니다. 시뮬레이션이 계산할 수 없는 계통(미완성, 루프, 잘못된 값, 수렴 실패)은 `SimulationError`로 422와 이유를 돌려줍니다. 리포트를 만들 수 없을 때(API 키 없음, AI 호출 실패, 응답 형식 오류)는 `ReportError`로 503과 이유를 돌려줍니다 (`backend/main.py`).

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
| 화면 → 화면 부품 | `frontend/src/App.jsx` → `components/Diagram.jsx`(단선도·범례), `components/ResultPanel.jsx`(결과·그래프·리포트) |
