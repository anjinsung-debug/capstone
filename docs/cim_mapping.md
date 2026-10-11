# 한전 데이터 → CIM 모델 정하기

원본 데이터는 한전이 제공한 가상 계통의 CIM16 XML(`data/korean_distribution_cim.xml`)입니다. 변전소 1개, 배전선로 1개(이진트리, 선로 11·부하 8·태양광 4)이고, 출처는 `data/NOTICE.md`에 있습니다. 매핑 가이드(CIM 클래스·속성 → 공통 모델 필드 대응표)는 한전에서 받지 않고 팀이 CIM 기준으로 작성했으며 `cim/mapping.py`에 있습니다.

1. **매핑 가이드** (`cim/mapping.py`): CIM 클래스·속성 → `cim/models.py` 필드 대응표, 단위 환산, XML에 없는 값의 출처. 매핑 규칙을 바꿀 때는 이 파일만 고침
2. **`cim/models.py`**: 대응표에 필요한 필드가 없으면 추가 ([공유 형식 파일 변경 규칙](../CONTRIBUTING.md#공유-형식-파일-변경-규칙)대로)
3. **적재 코드** (`cim/load.py`): `read_raw`(CIM XML 읽기), `to_substation_graphs`(대응표대로 변환), `save_to_neo4j`(저장)

## 항목을 정하는 기준

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

## 매핑 결과 요약 (자세한 표는 `cim/mapping.py`)

- 클래스: `ConnectivityNode` → `bus`, `BusbarSection` → `source`, 변전소 안 `Breaker` → `breaker`(피더 시작점), 그 밖의 `Breaker`·`LoadBreakSwitch`·`Recloser`·`Disconnector`·`Fuse` → `switch`, `ACLineSegment` → 선로, `EnergyConsumer` → `load`, `SolarGeneratingUnit`·`PhotoVoltaicUnit` → `pv`, `WindGeneratingUnit` → `wind`
- 단위 환산: 전력은 W·var → kW·kvar (÷1000), 임피던스는 구간 전체 Ω → Ω/km (÷ 길이). `Conductor.length`는 값 범위로 보아 km
- 위상: 단자 1개 설비는 `bus_id`, 차단기·개폐기는 양쪽 접속점과 길이 0인 `switch` 선로 2개로 연결. 선로 방향(전원 쪽 = from)은 전원에서 너비 우선 탐색으로 정함
- `id`는 `IdentifiedObject.mRID`
- XML에 없어 만들어 내는 값: 피더(차단기마다 하나, 열린 개폐기 전까지 소속), 단선도 좌표(전원을 뿌리로 한 트리 배치), 태양광 한 시점 출력(정격 `nominalP` 사용)
- XML에 없어 비워 두는 값: 변전소 3상 단락용량·X/R, 선로 허용전류. 시뮬레이션은 이 값이 없으면 가정값(300 MVA, X/R 10, 400 A)으로 계산

시뮬레이션 담당과 프론트엔드 담당은 필요한 항목이 빠지지 않았는지 확인합니다.

## 각자 데이터 준비

1. `git pull`로 `data/korean_distribution_cim.xml` 받기 (저장소에 포함)
2. 저장소 루트에서 `python -m cim.load` 실행해 자기 PC의 Neo4j에 저장 (다시 적재할 때는 `--reset`)

같은 원본과 같은 적재 코드를 쓰므로 모두 같은 데이터를 갖게 됩니다. 웹에서 편집한 내용은 자기 DB에만 남고, 다시 적재하면 처음 상태로 돌아갑니다.
