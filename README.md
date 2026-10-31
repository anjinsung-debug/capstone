# 배전계통 통합 분석 플랫폼

팀 으라차차: 안진성, 고영민, 최민준, 한승우

22.9kV 배전계통을 웹에서 단선도로 보고 편집하면, 4대 시뮬레이션(전압 영향, 선로 과부하, 역조류, 단락용량 고장전류)을 자동으로 다시 돌려 결과를 단선도 위에 표시하고, AI가 진단·원인·솔루션 리포트로 설명해 주는 플랫폼입니다. 한전이 제공한 CIM XML 계통 데이터를 Neo4j에 적재해 사용합니다.

## 디렉토리 구성

| 폴더 | 역할 | 담당 |
|------|------|------|
| `frontend/` | 웹 화면 (React, Vite), 단선도 (Cytoscape.js) | 고영민, 최민준 |
| `backend/` | API 서버 (FastAPI) | 안진성, 한승우 |
| `cim/` | 한전 데이터 → CIM 변환, Neo4j 적재·조회·편집 저장 | 한승우 |
| `simulation/` | 계통 → OpenDSS 변환, 4대 시뮬레이션, 선택한 날짜의 24시간 계산, 결과 그래프 (matplotlib) | 안진성 |
| `ai_report/` | LLM 리포트 생성 | 고영민, 최민준 |
| `data/` | 한전 제공 원본 CIM XML, 2025년 시간대별 가상 배율 (공개 허락받은 파일만 git에 올림) | 공용 |
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
│   ├── daily.py             선택한 날짜의 시간별 배율 적용·24시간 계산
│   ├── der.py               분산전원 연결 전후 비교, 연계 가능 최대치 (자체 점검: python -m simulation.der)
│   └── plot.py              결과 그래프 (matplotlib → PNG)
├── ai_report/
│   ├── models.py            리포트 형식 (진단, 원인, 솔루션)
│   └── report.py            Claude(또는 Gemini)로 리포트 생성 (자체 점검: python -m ai_report.report)
├── frontend/
│   ├── src/
│   │   ├── App.jsx          화면 흐름: 변전소 선택 → 단선도 → 자동 저장·시뮬레이션 → 결과·리포트
│   │   ├── components/      Diagram(단선도), NavDrawer(편집 메뉴), PropertyPanel(속성), ResultPanel(결과), HistoryChart, Modal, SubstationDialog, PopupWindow
│   │   ├── lib/             graphEdit.js(편집 로직), overlay.js(결과 → 단선도 표시)
│   │   ├── api/client.js    백엔드 API 호출
│   │   └── main.jsx, styles.css
│   ├── mock/mock_server.py  Neo4j·OpenDSS·LLM 없이 화면 개발용 모의 백엔드
│   └── vite.config.js       /api 요청을 백엔드(localhost:8000)로 전달
├── data/                    계통 XML·시간대별 가상 배율 (korean_distribution_cim.xml, profile_2025.csv, 출처 NOTICE.md)
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

해석 범위: 22.9kV, 3상 평형, 방사형 계통, 한 시점 계산 및 선택한 날짜의 24시간 분석, 고장은 3상 단락·1선 지락·2선 지락.

```
data/ (한전 원본 CIM XML) ──cim/load.py──▶ Neo4j
                                   ▲
frontend ──HTTP──▶ backend ────────┤ cim/graph.py (조회·스냅샷 저장)
                      ├──▶ simulation/simulate.py ──▶ 시뮬레이션 결과 (dss.py로 OpenDSS 변환)
                      ├──▶ simulation/daily.py    ──▶ 선택한 날짜의 24시간 결과 (simulate.py를 24번 호출)
                      ├──▶ simulation/der.py      ──▶ 분산전원 전후 비교·연계 가능 최대치 (simulate.py를 여러 번 호출)
                      ├──▶ simulation/plot.py     ──▶ 결과 그래프 (PNG)
                      └──▶ ai_report/report.py   ──▶ AI 리포트
```

1. **적재**: `python -m cim.load`가 한전 CIM XML을 공통 모델로 바꿔 Neo4j에 저장
2. **조회·편집**: 변전소 계통을 단선도로 보고 설비·선로를 편집하면 계통 전체를 `PUT /api/substations/{id}`로 자동 저장
3. **한 시점 시뮬레이션**: 저장된 계통을 OpenDSS로 계산해 전압, 선로 부하율, 역조류, 고장전류(3상 단락·1선 지락·2선 지락), 피더별 송출 전력을 단선도에 표시. 출구 차단기가 고장전류를 끊을 수 있는지(정격 차단전류 25kA 가정)도 판정 (역조류 정상 조건: 선로 용량 이내 + 차단 가능, 선로마다 `reverse_flow_ok`로 판정. 1 kW 미만 반대 방향 조류는 역조류로 보지 않음). 편집 화면은 기본으로 오늘 날짜·현재 시각의 배율을 적용하며, "최대 조건"을 선택하면 저장된 부하·태양광 값을 그대로 사용
4. **24시간 분석**: 기록 탭에서 날짜 하나를 선택하면 `POST /api/substations/{id}/simulations/daily`로 그날의 0~23시를 계산. 시간별 부하·태양광 배율을 적용해 기존 한 시점 계산 함수를 24번 실행하고, 편집 전후 계통의 하루 곡선을 비교
5. **분산전원 영향** (10/26 중간 발표 요청, 화면 연결 전):
   - 연결 전후 비교 `POST /api/substations/{id}/simulations/der-comparison`: 태양광·풍력을 모두 뺀 계통과 지금 계통을 계산해 출력 합, 송출 전력, 전압 범위, 최대 부하율, 역조류 선로 수, 최대 고장전류를 나란히 돌려줌
   - 연계 가능 최대치 `POST /api/substations/{id}/simulations/hosting-capacity?bus_id=&target_kw=`: 접속점에 태양광을 몇 kW까지 더 붙일 수 있는지 이분 탐색(10 kW 단위, 최대 20 MW)으로 찾고, 막는 원인(과전압 1.05 pu, 선로 과부하 100%, 차단기 차단 불가)과 목표 용량을 붙일 때 늘려야 할 선로 허용전류를 돌려줌. 역조류 자체는 회의 기준대로 막는 원인으로 보지 않음
   - 둘 다 `date`·`hour`를 주면 그 시각 배율로 계산 (없으면 최대 조건)
6. **AI 리포트**: 버튼을 누르면 시뮬레이션 결과를 AI(Claude, 선택 시 Gemini)에 넘겨 진단·원인·솔루션 리포트 생성

24시간 분석의 날짜·데이터 기준:

- 화면의 초기 선택 날짜는 오늘이며, 2025년 1월 1일부터 오늘까지 선택할 수 있습니다. API 요청에서 날짜를 생략할 때의 기본값은 `2025-05-26`입니다.
- `data/profile_2025.csv`는 2025년 1년치(8,760시간) **가상 패턴이며 실측 데이터가 아닙니다**. 2026년 이후 날짜는 2025년 같은 월·일 근처(±3일)의 같은 요일 패턴을 사용하고, 해당 연도 안에서 찾지 못하면 같은 월·일을 사용합니다. 실제 배율을 가져온 날짜는 응답의 `profile.source_date`에 담습니다.
- 부하의 유효·무효전력에는 부하 배율을, 태양광의 유효전력에는 태양광 배율을 곱합니다. 풍력 출력은 그대로 유지합니다. 야간 태양광 배율이 0이어도 고장 해석을 위해 설비용량의 0.01%를 남깁니다.
- 날짜를 바꾸면 각 기록 당시의 계통으로 24시간 결과를 다시 계산합니다. 미연결 설비가 있거나 주요 결과 지표가 직전 기록과 같으면 새 기록을 생략하며, 결과 기록은 브라우저 메모리에 최대 100개까지 보관합니다.

화면 흐름:

```
변전소 선택 → 단선도 표시 → 바로 시뮬레이션
편집 → 0.8초 동안 더 안 고치면 자동 저장 → 계산에 영향을 주는 값이 바뀌었으면 자동 시뮬레이션
결과 도착 → 단선도 오버레이·요약 갱신, 결과 그래프 자동 생성
기록 탭에서 날짜 선택 → 각 기록 계통의 0~23시 계산 → 24시간 곡선 비교
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

http://localhost:5173 왼쪽 위의 "● 서버 ● DB"가 둘 다 초록이면 정상입니다 (모의 서버는 "DB (모의)"). Neo4j 웹 콘솔은 http://localhost:7474 입니다.

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
| `AI_PROVIDER` | (선택) AI 리포트 서비스. `anthropic`(기본) 또는 `gemini`(시험용 무료 키 용도, 팀 합의 전까지 기본값은 Claude) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | (선택) `AI_PROVIDER=gemini`일 때만 사용. 모델을 비우면 `GEMINI_DEFAULT_MODEL` |
| `AI_TIMEOUT_SEC` | (선택) AI 응답 최대 대기 시간(초). 비우면 120 |

## 참고자료

- IEC 61970/61968 Common Information Model (CIM) 전력 표준 스펙 문서
- OpenDSS (Open Distribution System Simulator) 공식 명령어 매뉴얼, 미국전력연구원(EPRI)
- https://github.com/1004aiteam-power/open_dss_project : 동작 원리 및 예시 코드 (변전소 2, 배전선로 2)
