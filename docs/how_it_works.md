# 작동 방식 상세

전체 구조와 화면 흐름은 [README의 작동 방식](../README.md#작동-방식)에 있습니다. 이 문서는 단계별 세부 규칙입니다.

**해석 범위**: 22.9kV 배전계통, 3상 평형(정상분 1상 등가), 방사형 계통, 한 시점 계산, 고장은 3상 단락·1선 지락·2선 지락. 데이터 형식(`cim/models.py`)과 OpenDSS 변환(`simulation/dss.py`)이 이 범위를 전제로 합니다.

## 단계별 규칙

1. **적재** (FR-01, 02): `python -m cim.load` 실행 → `cim/load.py`가 `data/`의 한전 원본 CIM XML을 rdflib로 읽어(`read_raw`) 매핑 가이드(`cim/mapping.py`)대로 공통 모델로 변환하고(`to_substation_graphs`, 선로 방향·피더 소속은 `cim/topology.py`) Neo4j에 저장(`save_to_neo4j`). 웹이 아니라 명령어로 실행
2. **조회** (FR-02, 05): 변전소 단위로 읽음. `GET /api/substations` → `GET /api/substations/{id}` → `cim/graph.py`의 `get_substation`이 피더·노드·선로를 읽고, 좌표는 DiagramObject에서, `bus_id`는 `CONNECTED_TO` 관계에서 읽어 돌려줌
   - **편집 스냅샷 저장** (FR-06, 07, 제안서 4단계): 편집 중 새로 만든 노드·선로에는 프론트엔드가 `crypto.randomUUID()`로 UUID를 바로 할당 → 편집을 마치면 변전소 계통 전체(`SubstationSnapshot`, 형식은 `SubstationGraph`와 같음)를 `PUT /api/substations/{id}`로 보냄 → `save_substation`이 한 트랜잭션으로 저장
     - 없는 변전소 id면 새로 만듦 (이때만 이름·모선 전압 0.9~1.1 pu·단락용량·X/R을 검사해서 받음). 이미 있는 변전소는 이름만 스냅샷 값으로 바꾸고(빈 이름이면 유지), 모선 전압·단락용량·X/R은 시뮬레이션 결과를 바꾸므로 저장된 값을 그대로 씀 (화면에서도 읽기 전용)
     - 전원(source) 노드가 정확히 1개이고 그 `bus_id`가 스냅샷 안의 노드여야 저장됨 (아니면 422). 노드·선로 id 중복, 선로 양 끝 누락도 422
     - 주소의 id와 `substation.id`가 다르면 422 (`backend/api/grid.py`)
     - 서버가 다시 계산하는 값: 선로의 연결 특성(`kind`, `classify_connection`), 선로 방향(전원 쪽 = from)과 피더 소속(차단기마다 피더 하나, `cim/topology.py`). 스냅샷의 `feeders`는 쓰지 않음
     - 좌표는 설비 노드와 분리된 좌표 메타데이터 노드(DiagramObject)에 저장
     - 스냅샷에 없는 기존 피더·노드·선로와 연결이 끊긴 DiagramObject는 삭제 (가비지 컬렉션)
     - 응답으로 UUID → Neo4j element id 대응표(`element_ids`)를 돌려줌
3. **시뮬레이션** (FR-03, 04): 프론트엔드 → `POST /api/substations/{id}/simulations` → 백엔드가 `cim/graph.py`로 계통을 읽어 `simulation/simulate.py`에 넘김 → `simulation/dss.py`가 OpenDSS 스크립트로 변환 → `simulate.py`가 실행해 결과 반환 → 결과를 프론트엔드가 단선도에 표시
   - **지금 시각 기준**: 편집 화면은 기본으로 `?date=오늘&hour=지금 시`를 붙여 부름 → 백엔드가 그 시각 배율(`data/profile_2025.csv`, 2026년 이후는 2025년 같은 요일)을 부하·태양광에 곱해 계산 (`simulation/daily.py`의 `graph_at`). 정각이 지나면 화면이 다시 계산함. 요약 줄의 "최대 조건"을 누르면 date·hour 없이 불러 저장된 값 그대로(부하 = 최대부하, 태양광 = 설비용량) 계산. AI 리포트도 같은 date·hour를 보내 프롬프트의 kW를 같은 시각 값으로 맞춤. 실측 실시간 값이 아니라 가상 패턴의 같은 시각 값임
   - **OpenDSS 변환** (`dss.py`): 접속점·차단기·개폐기 노드가 OpenDSS 버스가 되고, 전원·부하·분산전원은 `bus_id`의 버스에 붙음. 열린 개폐기에 닿은 선로는 `enabled=no`로 끊어 그 아래 구간은 전압 0
   - **계산 순서** (`simulate.py`): 방사형 검사·실제 조류 방향 찾기 → 조류 계산 → 전압·선로 조류·손실·피더 송출 전력 → 고장 해석(부하는 끄고 계산) → 지점별 3상 단락·1선 지락·2선 지락 전류
     - 완성·방사형 검사 (`dss.py`의 `check_complete`, `trace`): 전원 1개·피더별 차단기 1개·출력·`bus_id`가 빠졌거나, 전원에서 닫힌 선로를 따라가다 루프가 있으면 422. 같은 탐색으로 각 선로의 실제 전원 쪽과 전원으로부터 거리를 구함
     - 역조류는 저장된 `from_node_id`가 아니라 실제 전원 쪽 기준으로 판정 (편집 중 선을 거꾸로 그려도 맞게 나옴). `p_kw` 부호는 저장된 from → to 기준
     - 전원에서 닿지 않는 노드(열린 개폐기 아래)는 정전: `energized=False`, 전압 0, 고장전류 없음. 저전압과 구분
     - OpenDSS 명령 오류·수렴 실패는 계산을 멈추고 422로 알림 (잘못된 결과가 그래프·리포트로 넘어가지 않음)
     - 조류 계산 때 전원 임피던스는 거의 0으로 두어 변전소 모선 전압이 `source_voltage_pu`로 유지되고, 고장 해석 직전에만 `short_circuit_mva`·`x_r_ratio`를 넣음
     - 데이터에 없는 값은 가정값으로 계산 (`dss.py`의 `DEFAULT_*`): 단락용량 300 MVA, X/R 10, 허용전류 400 A, 차단기 정격 차단전류 25 kA. 실제 값이 데이터에 있으면 그 값이 우선. 가정값으로 낸 고장전류·부하율은 실제 설비 기준이 아님
     - 태양광·풍력은 인버터 전원으로 보고 고장 전류 기여를 정격의 약 1.2배로 계산 (`Xdp=1`)
     - OpenDSS 엔진은 프로세스에 하나라 동시 요청은 차례로 처리
   - **4대 시뮬레이션** (제안서 3단계): 결과 형식(`simulation/models.py`)에 아래 항목이 있음

     | 시뮬레이션 | 결과 필드 |
     |-----------|-----------|
     | 전압 영향 | `NodeResult.voltage_pu` (정전 구간은 `energized=False`, 저전압과 구분) |
     | 선로 과부하 | `LineResult.loading_pct` (허용전류 대비 %) |
     | 역조류 (전원 반대쪽으로 1 kW 이상, 그보다 작으면 계산 오차로 무시) | `LineResult.reverse_flow` |
     | 역조류가 정상인지 (부하율 ≤ 100% + 그 피더 차단기 차단 가능, 10/26 회의 기준. 역조류가 아니면 None) | `LineResult.reverse_flow_ok` |
     | 단락용량 고장전류 | `NodeResult.fault_current_ka` |
     | 1선 지락 전류 (선로 영상분 r0·x0, 화면 선로 속성의 "영상분 저항 R0·리액턴스 X0"에서 고침, 비우면 정상분 × 3) | `NodeResult.ground_fault_current_ka` |
     | 2선 지락 전류 (고장 난 두 상 중 큰 상전류) | `NodeResult.double_ground_fault_current_ka` |
     | 출구 차단기가 고장전류(3상 단락·1선 지락·2선 지락 중 큰 값)를 끊을 수 있는지 (≤ 25 kA) | `FeederResult.breaker_interruptible` (역조류 정상 판정 조건, 10/26 회의) |
     | 변전소 출구 차단기(CB) 옆 피더별 송출 전력 | `SimulationResult.feeders` (`FeederResult.p_kw`, `q_kvar`, 화면에는 MW·MVAr 황색 표시) |

   - **결과 그래프**: 화면(결과 자세히 → ② 원인 분석)은 받은 결과로 전압 프로파일·선로별 조류를 직접 그림 (`frontend/src/components/ProfileChart.jsx`, 어두운 화면 색에 맞춤). 그리는 규칙은 `simulation/plot.py`와 같음
     - `POST /api/plots`(백엔드가 matplotlib PNG를 돌려줌)는 남아 있지만 지금 화면은 부르지 않음
   - **결과 기록 (편집 기록 × 하루 시간대)**: 편집 후 다시 계산해 기록이 쌓일 때마다 화면이 `POST /api/substations/{id}/simulations/daily`를 불러 고른 날의 24시간 곡선을 그 기록에 붙임 (`HistoryChart.jsx`). 백엔드는 `data/profile_2025.csv`(2025년 1년치)에서 그날 24시간 배율을 부하(p_kw·q_kvar)·태양광(p_kw)에 곱해 24번 계산하고 `{ profile, hours: [{ hour, load_mult, pv_mult, result }] }`로 돌려줌. 계통 데이터의 부하는 최대부하, 태양광은 설비용량으로 봄 (가상 패턴, 실측 아님)
     - **날짜 고르기**: 기록 탭 위 달력에서 2025-01-01 ~ 오늘 중 하루를 고름 (본문 `{ date, graph }`). 배율 데이터가 2025년 것뿐이라 2026년 이후 날은 2025년 같은 시기(±3일)의 같은 요일 배율을 씀 (응답 `profile.source_date`). 날짜를 바꾸면 기록마다 그 편집 시점 계통(`graph`)을 새 날짜로 다시 계산함
     - 백엔드: `backend/api/simulation.py`의 `run_daily_simulation` → `simulation/daily.py`의 `simulate_daily`가 `simulate()`를 24번 부름 (모의 백엔드도 같은 `simulate_daily`에 근사 계산만 넘김). 백엔드가 이 주소를 모르면(404) 화면은 편집 시점 값만 기록함
     - 위: 변전소로부터 거리별 전압 프로파일 (정상 범위 밖은 빨간 점, 정전 구간은 그리지 않음) / 아래: 선로별 유효전력 조류 (역조류 주황, 과부하 빨강, 부하율 %)
   - **분산전원 영향** (`simulation/der.py`, 10/26 중간 발표 요청)
     - 연결 전후 비교 (`compare_der`, `POST .../simulations/der-comparison`): 태양광·풍력 노드를 모두 뺀 계통과 지금 계통을 `simulate()`로 계산. 출력을 0으로 두지 않고 노드를 빼야 고장전류 기여도 빠짐. 각각의 핵심 숫자(`DerSummary`: 분산전원 출력 합, 피더 송출, 손실, 최저·최고 전압, 최대 부하율, 역조류 선로 수, 최대 고장전류)를 같이 줌
     - 연계 가능 최대치 (`hosting_capacity`, `POST .../simulations/hosting-capacity?bus_id=&target_kw=`): 접속점에 태양광 노드를 하나 더 붙여 출력을 키우며 연계 기준 위반이 처음 생기는 출력을 이분 탐색 (10 kW 단위, 0~20 MW)
       - 연계 기준: 접속점 전압 ≤ 1.05 pu, 선로 부하율 ≤ 100%, 출구 차단기 차단 가능. 역조류 자체는 회의 기준대로 위반 아님. 저전압은 태양광이 늘수록 나아지므로 보지 않음
       - 결과: `max_kw`, 그 다음 출력에서 생기는 위반(`limited_by`: 무엇 때문에 막히는지), `target_kw`를 주면 그때의 위반과 과부하 선로마다 필요한 허용전류(`required_rated_current_a`)
       - 지금 계통이 이미 위반이면 0, 20 MW까지 괜찮으면 20 MW와 빈 `limited_by`
     - 둘 다 `date`·`hour`를 주면 `graph_at`으로 그 시각 배율을 곱한 계통으로 계산. 추가하는 태양광 kW는 그 시각 출력으로 봄
4. **AI 리포트** (FR-08, 09): 프론트엔드가 받은 시뮬레이션 결과를 `POST /api/reports`로 보냄 → 백엔드가 `cim/graph.py`로 같은 계통 정보를 읽어 결과와 함께 `ai_report/report.py`에 넘김 → 진단·원인·솔루션 리포트 생성
   - **확정된 사실은 코드가 계산** (`check_findings`): 저전압·과전압·과부하·역조류·정전 항목과 건강도 등급(정상·주의·위험)을 화면 진단표(`frontend/src/lib/overlay.js`의 `healthCheck`)와 같은 규칙으로 먼저 정해 프롬프트에 "확정된 점검 결과"로 넣음. LLM은 이 사실을 쉬운 말로 풀어 설명만 하고 등급을 바꾸지 않음 (환각 대응, 제안서 10장)
   - **프롬프트** (`build_prompt`): 확정된 점검 결과, 피더별 송출 전력, 부하·분산전원이 붙은 접속점, 지점별 전압·단락전류, 선로별 연결·부하율·조류. 표가 길면(120줄 초과) 문제가 큰 순으로 자름
   - **형식 고정**: Claude tool use(`submit_report`)로 진단 1개, 원인 목록, 솔루션 목록을 받음. 형식이 어긋나면 `ReportError`
   - **가정값 표시**: 허용전류·단락용량이 데이터에 없어 `simulation/dss.py`의 `DEFAULT_*`로 계산된 경우 그 사실을 프롬프트에 넣어 리포트에 "가정값 기준"이라고 밝히게 함
   - 모델은 `.env`의 `ANTHROPIC_MODEL`, 없으면 `DEFAULT_MODEL`. 회의록의 "사용할 Claude 모델"이 정해지면 바꿈

## 편집 → 시뮬레이션 → 리포트 설계 이유

- 시뮬레이션과 리포트 API를 나눈 이유: LLM 응답(수 초~수십 초)을 기다리지 않고 결과를 먼저 보여 주기 위해
- 리포트를 자동으로 만들지 않는 이유: 편집할 때마다 다시 계산되므로, 매번 LLM을 부르면 비용·시간이 너무 든다
- 리포트가 만들어지는 중에 새 시뮬레이션이 끝나거나 변전소를 바꾸면, 이전 결과·그래프·리포트는 버리고 마지막 요청의 것만 표시 (`App.jsx`의 `runId`)
- 리포트에는 계통 정보(설비 이름·종류·연결)와 해석 수치(전압 pu, 선로 부하율, 고장전류, 역조류, 피더별 송출 전력)가 구조화된 텍스트로 들어가므로 "어느 구간이 왜 문제인지"를 설명할 수 있음
- 시뮬레이션마다 LLM을 호출하므로 API 사용량을 확인하고, 한전 수치를 외부 LLM에 보내도 되는지 한전 측에 확인
