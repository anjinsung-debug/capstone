"""CIM16 RDF/XML → 내부 계통 모델(cim/models.py) 매핑 스키마 (FR-01, 제안서 1단계)

load.py는 이 표를 따라 변환한다. 매핑 규칙을 바꿀 때는 이 파일만 고친다.
기준 데이터: data/korean_distribution_cim.xml (한전 가상 계통, 변전소 1·차단기 1·선로 11·부하 8·PV 4)

[클래스 매핑]
    CIM 클래스                     → 내부 모델
    Substation                     → Substation
    VoltageLevel                   → (저장 안 함) BaseVoltage가 22.9kV인지 검사만
    ConnectivityNode               → Node(type=bus)
    BusbarSection                  → Node(type=source), bus_id = 붙은 ConnectivityNode
    Breaker (컨테이너가 Substation) → Node(type=breaker) = 피더 하나의 시작점
    Breaker (그 외) / LoadBreakSwitch / Recloser / Disconnector / Fuse → Node(type=switch)
    ACLineSegment                  → Line(kind=line)
    EnergyConsumer                 → Node(type=load), bus_id
    SolarGeneratingUnit / PhotoVoltaicUnit → Node(type=pv), bus_id
    WindGeneratingUnit             → Node(type=wind), bus_id
    Terminal                       → 연결 정보 (아래 [위상 규칙])

[위상 규칙]
    - 단자 1개 설비(source·load·pv·wind): Terminal.ConnectivityNode → Node.bus_id
    - 단자 2개 개폐기(breaker·switch): 개폐기 노드 + 양쪽 bus와 잇는 Line(kind=switch, 길이·임피던스 0) 2개
    - ACLineSegment: 두 단자의 ConnectivityNode → Line.from_node_id / to_node_id
      방향(from=전원 쪽)은 source에서 너비 우선 탐색으로 정한다. Terminal.sequenceNumber(1→2)는 쓰지 않는다
      (이 데이터에서는 우연히 일치하지만 CIM 표준이 방향을 보장하지 않음)

[데이터에 없어 load.py가 만들어 내는 값]
    - Feeder: CIM XML에 없음. breaker 노드마다 피더 하나를 만들고, breaker 아래쪽으로 열린 개폐기를
      지나지 않고 닿는 노드·선로에 feeder_id를 붙인다. 피더 id = 새 UUID, 이름 = 차단기 이름
    - x, y: CIM XML에 좌표(DiagramObject)가 없음. source를 뿌리로 하는 트리 배치로 자동 계산
    - Substation.short_circuit_mva, x_r_ratio: 없음 → None (고장 해석은 값을 넣은 뒤에만)

[식별자]
    내부 id = cim:IdentifiedObject.mRID. rdf:about(urn:uuid:…)은 XML 안 참조용이라 mRID와 값이 다르다.
    참조(Terminal → 설비 등)는 rdf:about으로 따라간 뒤 대상의 mRID로 바꿔 저장한다.
"""

from dataclasses import dataclass
from typing import Callable, Literal

CIM_NS = "http://iec.ch/TC57/2013/CIM-schema-cim16#"  # 현재 데이터의 CIM 버전
# CIM 버전마다 네임스페이스 주소가 다르다 (cim16, cim17, CGMES 3.0의 CIM100 등). 이 접두어로 시작하면 CIM으로 본다
CIM_NS_PREFIX = "http://iec.ch/TC57/"
RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"

BASE_VOLTAGE_V = 22900.0  # VoltageLevel.BaseVoltage 허용값 (V)

Attrs = dict[str, str]  # 한 CIM 객체의 속성 원문 {"ACLineSegment.r": "0.256", ...}


# ───────────────────────────── 단위 변환 ─────────────────────────────
def w_to_kw(value: str, attrs: Attrs) -> float:
    return float(value) / 1000.0


def to_bool(value: str, attrs: Attrs) -> bool:
    return value.strip().lower() == "true"


def to_float(value: str, attrs: Attrs) -> float:
    return float(value)


def to_str(value: str, attrs: Attrs) -> str:
    return value


def per_km(value: str, attrs: Attrs) -> float:
    """CIM ACLineSegment.r/x는 구간 전체 임피던스(Ω). 내부 모델은 Ω/km이므로 길이로 나눈다."""
    length = float(attrs["Conductor.length"])
    if length <= 0:
        raise ValueError(f"선로 길이가 0 이하입니다: {attrs.get('IdentifiedObject.name')}")
    return float(value) / length


# ───────────────────────────── 매핑 표 ─────────────────────────────
@dataclass(frozen=True)
class FieldMap:
    cim: str  # CIM 속성 ("클래스.속성")
    field: str  # 내부 모델 필드
    convert: Callable[[str, Attrs], object] = to_float
    required: bool = True


@dataclass(frozen=True)
class ClassMap:
    target: Literal["substation", "node", "line", "check", "terminal"]
    node_type: str | None = None  # target=node일 때 Node.type. Breaker는 load.py가 컨테이너를 보고 정함
    terminals: int = 0  # 이 설비가 가져야 하는 Terminal 수 (검사용)
    fields: tuple[FieldMap, ...] = ()


IDENTITY = (
    FieldMap("IdentifiedObject.mRID", "id", to_str),
    FieldMap("IdentifiedObject.name", "name", to_str, required=False),  # 없으면 mRID 앞 8자리
)

SWITCH_FIELDS = IDENTITY + (
    FieldMap("Switch.normalOpen", "is_open", to_bool, required=False),  # 없으면 닫힘
    FieldMap("Switch.ratedCurrent", "rated_current_a", required=False),  # 양쪽 switch Line에 넣음
)

DER_FIELDS = IDENTITY + (
    # 출력 시계열이 없으므로 정격 출력을 한 시점 출력으로 쓴다. maxOperatingP, minOperatingP는 사용 안 함
    FieldMap("GeneratingUnit.nominalP", "p_kw", w_to_kw),
)

CLASS_MAP: dict[str, ClassMap] = {
    "Substation": ClassMap("substation", fields=IDENTITY),
    "VoltageLevel": ClassMap("check", fields=(FieldMap("VoltageLevel.BaseVoltage", "base_voltage_v"),)),
    "ConnectivityNode": ClassMap("node", "bus", fields=IDENTITY),
    "BusbarSection": ClassMap("node", "source", terminals=1, fields=IDENTITY),
    "Breaker": ClassMap("node", None, terminals=2, fields=SWITCH_FIELDS),
    "LoadBreakSwitch": ClassMap("node", "switch", terminals=2, fields=SWITCH_FIELDS),
    "Recloser": ClassMap("node", "switch", terminals=2, fields=SWITCH_FIELDS),
    "Disconnector": ClassMap("node", "switch", terminals=2, fields=SWITCH_FIELDS),
    "Fuse": ClassMap("node", "switch", terminals=2, fields=SWITCH_FIELDS),
    "ACLineSegment": ClassMap(
        "line",
        terminals=2,
        fields=IDENTITY
        + (
            # 이 데이터의 Conductor.length는 km 단위 (CIM 표준은 m지만 값이 0.5~1.5라 km로 판단)
            FieldMap("Conductor.length", "length_km"),
            FieldMap("ACLineSegment.r", "r_ohm_per_km", per_km),
            FieldMap("ACLineSegment.x", "x_ohm_per_km", per_km),
            # r0·x0(영상분)은 3상 단락만 다루므로 사용 안 함. 지락 해석을 넣으면 Line에 필드 추가
        ),
    ),
    "EnergyConsumer": ClassMap(
        "node",
        "load",
        terminals=1,
        fields=IDENTITY
        + (
            FieldMap("EnergyConsumer.p", "p_kw", w_to_kw),
            FieldMap("EnergyConsumer.q", "q_kvar", w_to_kw, required=False),
            # pfixed는 p와 같은 값이라 사용 안 함
        ),
    ),
    "SolarGeneratingUnit": ClassMap("node", "pv", terminals=1, fields=DER_FIELDS),
    "PhotoVoltaicUnit": ClassMap("node", "pv", terminals=1, fields=DER_FIELDS),
    "WindGeneratingUnit": ClassMap("node", "wind", terminals=1, fields=DER_FIELDS),
    "Terminal": ClassMap(
        "terminal",
        fields=(
            FieldMap("Terminal.ConductingEquipment", "equipment", to_str),  # rdf:about 참조
            FieldMap("Terminal.ConnectivityNode", "bus", to_str),  # rdf:about 참조
            FieldMap("ACDCTerminal.sequenceNumber", "sequence", lambda v, a: int(v), required=False),
        ),
    ),
}

# 설비가 속한 컨테이너 (Breaker 구분용: Substation이면 breaker, 아니면 switch)
CONTAINER_ATTR = "Equipment.EquipmentContainer"


def breaker_type(container_class: str | None) -> str:
    return "breaker" if container_class == "Substation" else "switch"


def map_fields(cim_class: str, attrs: Attrs) -> dict[str, object]:
    """CIM 객체 하나의 속성 원문을 내부 필드 dict로 바꾼다. 매핑 표에 없는 클래스는 KeyError."""
    out: dict[str, object] = {}
    for fm in CLASS_MAP[cim_class].fields:
        if fm.cim in attrs:
            out[fm.field] = fm.convert(attrs[fm.cim], attrs)
        elif fm.required:
            raise ValueError(f"{cim_class} {attrs.get('IdentifiedObject.mRID')}: {fm.cim} 값이 없습니다")
    if "id" in out and not out.get("name"):
        out["name"] = str(out["id"])[:8]
    return out
