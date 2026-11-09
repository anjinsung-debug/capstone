"""내부 계통 모델 → CIM16 RDF/XML 내보내기 (cim/load.py의 반대 방향)

편집하고 저장한 마지막 계통(cim/graph.py의 get_substation)을 한전 원본과 같은 형식의 CIM XML로 쓴다.
GET /api/substations/{id}/cim (backend/api/grid.py)

변환 규칙은 cim/mapping.py의 매핑 표를 거꾸로 따른다.
    Substation          → Substation + VoltageLevel (22.9kV, 원본처럼 BaseVoltage를 숫자로)
    Node(bus)           → ConnectivityNode
    Node(source)        → BusbarSection + Terminal 1개
    Node(load)          → EnergyConsumer + Terminal 1개 (kW·kvar → W·var)
    Node(pv / wind)     → SolarGeneratingUnit / WindGeneratingUnit + Terminal 1개 (kW → W)
    Node(breaker)       → Breaker (컨테이너 = Substation) + Terminal 2개
    Node(switch)        → LoadBreakSwitch (컨테이너 = VoltageLevel) + Terminal 2개
    Line(kind=line)     → ACLineSegment + Terminal 2개 (Ω/km × 길이 → 구간 전체 Ω, 길이는 원본처럼 km)
                          허용전류가 있으면 OperationalLimitSet + CurrentLimit
    Line(kind=switch)   → 따로 쓰지 않는다. 적재할 때 개폐기 하나를 "노드 + 연결선 2개"로 펼쳤으므로
                          개폐기 노드에 닿은 연결선 2개를 Terminal 2개로 다시 합친다.
                          연결선 반대쪽이 접속점이 아니라 다른 개폐기면 그 사이에 ConnectivityNode를 새로 만든다

식별자: IdentifiedObject.mRID = 내부 id (원본에서 온 설비는 원본 mRID 그대로). rdf:about = urn:uuid:<mRID>.
Terminal·VoltageLevel처럼 내부 모델에 없는 객체는 topology.derived_id로 만들어서 몇 번 내보내도 같은 값이 나온다.

CIM에 넣지 않는 값 (파일 맨 위 주석에 적는다): 단선도 좌표, 피더 이름, 변전소 모선 전압·단락용량·X/R, 분산전원 무효전력.
다시 적재하면 좌표는 자동 배치, 피더는 차단기에서 다시 만들고, 나머지는 시뮬레이션 가정값을 쓴다.

자체 점검 (프로젝트 루트에서, Neo4j 없이): python -m cim.export
    원본 XML → 적재 모델 → 내보내기 → 다시 읽기가 같은지, 편집한 계통도 다시 읽었을 때 같은지 확인
    python -m cim.export --out exported.xml   원본을 한 번 내보내 파일로 저장 (눈으로 비교할 때)
"""

import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

from cim import mapping
from cim.models import BASE_KV, ONE_TERMINAL_TYPES, Line, Node, SubstationGraph
from cim.topology import derived_id

CIM = mapping.CIM_NS
RDF = mapping.RDF_NS
XSD = "http://www.w3.org/2001/XMLSchema#"
ET.register_namespace("cim", CIM)
ET.register_namespace("rdf", RDF)

# 내부 Node.type → CIM 클래스 (mapping.CLASS_MAP의 반대. pv는 한전 원본이 쓰는 SolarGeneratingUnit)
NODE_CLASS = {
    "bus": "ConnectivityNode",
    "source": "BusbarSection",
    "load": "EnergyConsumer",
    "pv": "SolarGeneratingUnit",
    "wind": "WindGeneratingUnit",
    "breaker": "Breaker",
    "switch": "LoadBreakSwitch",
}


class ExportError(ValueError):
    """CIM으로 쓸 수 없는 계통 (예: 접속점에 안 붙은 부하, 한쪽만 연결된 개폐기). API에서는 422"""


def _about(mrid: str) -> str:
    return f"urn:uuid:{mrid}"


class _Writer:
    def __init__(self, g: SubstationGraph):
        self.g = g
        self.root = ET.Element(f"{{{RDF}}}RDF")
        self.vl_id = derived_id(g.substation.id, "voltage_level")

    # ── XML 한 객체 쓰기 ──
    def obj(self, cls: str, mrid: str, name: str | None = None) -> ET.Element:
        el = ET.SubElement(self.root, f"{{{CIM}}}{cls}", {f"{{{RDF}}}about": _about(mrid)})
        if name is not None:
            self.literal(el, "IdentifiedObject.name", name)
        self.literal(el, "IdentifiedObject.mRID", mrid)
        return el

    @staticmethod
    def literal(el: ET.Element, prop: str, value: str | float | int | bool, xsd: str | None = None) -> None:
        child = ET.SubElement(el, f"{{{CIM}}}{prop}")
        if xsd:
            child.set(f"{{{RDF}}}datatype", XSD + xsd)
        child.text = str(value).lower() if isinstance(value, bool) else str(value)

    @staticmethod
    def ref(el: ET.Element, prop: str, mrid: str) -> None:
        ET.SubElement(el, f"{{{CIM}}}{prop}", {f"{{{RDF}}}resource": _about(mrid)})

    def terminal(self, equipment_id: str, cn_id: str, seq: int) -> None:
        el = self.obj("Terminal", derived_id(equipment_id, "cim_terminal", str(seq)))
        self.ref(el, "Terminal.ConductingEquipment", equipment_id)
        self.ref(el, "Terminal.ConnectivityNode", cn_id)
        self.literal(el, "ACDCTerminal.sequenceNumber", seq, "integer")

    # ── 계통 전체 ──
    def write(self) -> ET.Element:
        g = self.g
        nodes = {n.id: n for n in g.nodes}
        errors: list[str] = []

        self.obj("Substation", g.substation.id, g.substation.name)  # 속성 없이 이름·mRID만
        vl = self.obj("VoltageLevel", self.vl_id, f"{BASE_KV}kV_배전레벨")
        self.ref(vl, "VoltageLevel.Substation", g.substation.id)
        self.literal(vl, "VoltageLevel.BaseVoltage", mapping.BASE_VOLTAGE_V, "float")

        # 개폐기 노드 → 양쪽 단자가 닿는 ConnectivityNode id. 연결선 반대쪽이 개폐기면 연결선 id로 접속점을 새로 만든다
        switch_cns: dict[str, list[tuple[bool, str]]] = defaultdict(list)  # 개폐기 id → [(개폐기가 from 쪽인지, CN id)]
        switch_rating: dict[str, float] = {}
        extra_cns: list[Line] = []
        for line in g.lines:
            if self.kind(line, nodes) != "switch":
                continue
            ends = [(line.from_node_id, line.to_node_id), (line.to_node_id, line.from_node_id)]
            if all(nodes[a].type in ("breaker", "switch") for a, _ in ends):
                extra_cns.append(line)
                cn = derived_id(line.id, "cim_connectivity_node")
                for sw, _ in ends:
                    switch_cns[sw].append((sw == line.from_node_id, cn))
            else:
                sw, cn = next((a, b) for a, b in ends if nodes[a].type in ("breaker", "switch"))
                switch_cns[sw].append((sw == line.from_node_id, cn))
            if line.rated_current_a is not None:
                for sw, _ in ends:
                    if nodes[sw].type in ("breaker", "switch"):
                        switch_rating.setdefault(sw, line.rated_current_a)

        for n in g.nodes:
            if n.type == "bus":
                cn = self.obj("ConnectivityNode", n.id, n.name)
                self.ref(cn, "ConnectivityNode.ConnectivityNodeContainer", self.vl_id)
        for line in extra_cns:
            cn = self.obj("ConnectivityNode", derived_id(line.id, "cim_connectivity_node"), line.name)
            self.ref(cn, "ConnectivityNode.ConnectivityNodeContainer", self.vl_id)

        for n in g.nodes:
            if n.type == "bus":
                continue
            el = self.obj(NODE_CLASS[n.type], n.id, n.name)
            self.ref(el, mapping.CONTAINER_ATTR, g.substation.id if n.type == "breaker" else self.vl_id)
            if n.type in ONE_TERMINAL_TYPES:
                errors += self.one_terminal(el, n)
            else:
                errors += self.two_terminal(el, n, switch_cns[n.id], switch_rating.get(n.id))

        for line in g.lines:
            if self.kind(line, nodes) == "line":
                errors += self.line(line)

        if errors:
            raise ExportError("CIM으로 내보낼 수 없습니다: " + "; ".join(errors))
        return self.root

    @staticmethod
    def kind(line: Line, nodes: dict[str, Node]) -> str:
        """저장된 계통은 서버가 kind를 채우지만, 없으면 cim/graph.py의 classify_connection과 같은 규칙"""
        if line.kind:
            return line.kind
        return "switch" if {"breaker", "switch"} & {nodes[line.from_node_id].type, nodes[line.to_node_id].type} else "line"

    def one_terminal(self, el: ET.Element, n: Node) -> list[str]:
        errors = []
        if n.bus_id is None:
            errors.append(f"{n.name}이(가) 접속점에 연결되어 있지 않습니다")
        if n.type == "load":
            if n.p_kw is None:
                errors.append(f"부하 {n.name}의 소비 전력(kW)이 비어 있습니다")
            else:
                self.literal(el, "EnergyConsumer.p", n.p_kw * 1000.0, "float")
            if n.q_kvar is not None:
                self.literal(el, "EnergyConsumer.q", n.q_kvar * 1000.0, "float")
        elif n.type in ("pv", "wind"):
            if n.p_kw is None:
                errors.append(f"분산전원 {n.name}의 출력(kW)이 비어 있습니다")
            else:
                self.literal(el, "GeneratingUnit.nominalP", n.p_kw * 1000.0, "float")
        if n.bus_id is not None:
            self.terminal(n.id, n.bus_id, 1)
        return errors

    def two_terminal(self, el: ET.Element, n: Node, cns: list[tuple[bool, str]], rating: float | None) -> list[str]:
        if n.type == "switch":
            self.literal(el, "Switch.normalOpen", n.is_open, "boolean")
        else:
            self.literal(el, "Switch.normalOpen", False, "boolean")  # 차단기는 닫힌 것으로 본다 (load.py와 같음)
        if rating is not None:
            self.literal(el, "Switch.ratedCurrent", rating, "float")
        if len(cns) != 2:
            return [f"{n.name}은(는) 양쪽에 하나씩 연결되어야 합니다 (지금 연결 {len(cns)}개)"]
        # 단자 1 = 전원 쪽 (개폐기가 연결선의 to 쪽), 단자 2 = 말단 쪽
        for seq, (_, cn) in enumerate(sorted(cns, key=lambda c: c[0]), start=1):
            self.terminal(n.id, cn, seq)
        return []

    def line(self, line: Line) -> list[str]:
        if line.length_km <= 0:
            return [f"선로 {line.name}의 길이가 0 이하입니다 ({line.length_km} km)"]
        el = self.obj("ACLineSegment", line.id, line.name)
        self.ref(el, mapping.CONTAINER_ATTR, self.vl_id)
        self.literal(el, "Conductor.length", line.length_km, "float")  # 원본처럼 km (cim/mapping.py 참고)
        self.literal(el, "ACLineSegment.r", line.r_ohm_per_km * line.length_km, "float")
        self.literal(el, "ACLineSegment.x", line.x_ohm_per_km * line.length_km, "float")
        if line.r0_ohm_per_km is not None:
            self.literal(el, "ACLineSegment.r0", line.r0_ohm_per_km * line.length_km, "float")
        if line.x0_ohm_per_km is not None:
            self.literal(el, "ACLineSegment.x0", line.x0_ohm_per_km * line.length_km, "float")
        self.terminal(line.id, line.from_node_id, 1)
        self.terminal(line.id, line.to_node_id, 2)
        if line.rated_current_a is not None:
            set_id = derived_id(line.id, "cim_limit_set")
            ls = self.obj("OperationalLimitSet", set_id, f"{line.name}_허용전류")
            self.ref(ls, "OperationalLimitSet.Equipment", line.id)
            cl = self.obj("CurrentLimit", derived_id(line.id, "cim_current_limit"), f"{line.name}_허용전류")
            self.ref(cl, "OperationalLimit.OperationalLimitSet", set_id)
            self.literal(cl, "CurrentLimit.value", line.rated_current_a, "float")
        return []


def not_exported(g: SubstationGraph) -> list[str]:
    """CIM에 넣지 않는 값 중 이 계통에 실제로 들어 있는 것 (파일 맨 위 주석)"""
    s = g.substation
    out = ["단선도 좌표 (다시 적재하면 자동 배치)", "피더 이름 (다시 적재하면 출구 차단기 이름)"]
    if s.source_voltage_pu != 1.0:
        out.append(f"변전소 모선 전압 {s.source_voltage_pu} pu")
    if s.short_circuit_mva is not None:
        out.append(f"변전소 3상 단락용량 {s.short_circuit_mva} MVA")
    if s.x_r_ratio is not None:
        out.append(f"변전소 X/R {s.x_r_ratio}")
    if any(n.type in ("pv", "wind") and n.q_kvar for n in g.nodes):
        out.append("분산전원 무효전력 (q_kvar)")
    return out


def to_cim_xml(g: SubstationGraph) -> bytes:
    """계통 하나를 CIM16 RDF/XML(UTF-8)로. 쓸 수 없는 계통이면 ExportError (이유를 모두 모아서)"""
    root = _Writer(g).write()
    root.insert(0, ET.Comment(" 내보내지 않은 값: " + ", ".join(not_exported(g)) + " "))
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"


# ───────────────────────────── 자체 점검 ─────────────────────────────
def _normalized(g: SubstationGraph) -> dict:
    """다시 읽었을 때 같아야 하는 내용만 (좌표 제외, 실수는 반올림, 개폐기 연결선은 id 대신 양 끝으로)"""
    def r(v):
        return round(v, 9) if isinstance(v, float) else v

    nodes = {n.id: {k: r(v) for k, v in n.model_dump(exclude={"x", "y", "feeder_id"}).items()} for n in g.nodes}
    lines = {l.id: {k: r(v) for k, v in l.model_dump(exclude={"feeder_id"}).items()} for l in g.lines if l.kind == "line"}
    switch_lines = sorted((tuple(sorted((l.from_node_id, l.to_node_id))), l.rated_current_a) for l in g.lines if l.kind == "switch")
    return {"substation": (g.substation.id, g.substation.name), "nodes": nodes, "lines": lines, "switch_lines": switch_lines}


def _reload(xml: bytes, tmp_dir) -> SubstationGraph:
    from cim.load import read_raw, to_substation_graphs

    path = Path(tmp_dir) / "exported.xml"
    path.write_bytes(xml)
    (g,) = to_substation_graphs(read_raw(path))
    return g


def _edited(g: SubstationGraph) -> SubstationGraph:
    """편집을 흉내 낸 계통: 부하 값 수정, 선로 허용전류·영상분 수정, 개폐기(열림) + 접속점 + 태양광 추가"""
    d = g.model_dump()
    load = next(n for n in d["nodes"] if n["type"] == "load")
    load["p_kw"], load["q_kvar"] = 1234.5, 321.0
    line = next(l for l in d["lines"] if l["kind"] == "line")
    line["rated_current_a"], line["r0_ohm_per_km"], line["x0_ohm_per_km"] = 520.0, None, None
    end_bus = line["to_node_id"]
    sid = d["substation"]["id"]
    sw, bus, pv = (derived_id("export_test", k) for k in ("switch", "bus", "pv"))
    d["nodes"] += [
        dict(id=sw, substation_id=sid, name="LBS_테스트", type="switch", x=0, y=0, is_open=True),
        dict(id=bus, substation_id=sid, name="CN_테스트", type="bus", x=0, y=0),
        dict(id=pv, substation_id=sid, name="PV_테스트", type="pv", x=0, y=0, p_kw=750.0, bus_id=bus),
    ]
    for i, (a, b) in enumerate([(end_bus, sw), (sw, bus)]):
        d["lines"].append(dict(id=derived_id("export_test", "sw_line", str(i)), substation_id=sid, name=f"테스트{i}",
                               kind="switch", from_node_id=a, to_node_id=b, length_km=0.0, r_ohm_per_km=0.0,
                               x_ohm_per_km=0.0, rated_current_a=400.0))
    return SubstationGraph.model_validate(d)


if __name__ == "__main__":
    import argparse
    import tempfile

    from cim.load import DATA_DIR, DEFAULT_FILE, read_raw, to_substation_graphs

    parser = argparse.ArgumentParser(description="CIM 내보내기 자체 점검")
    parser.add_argument("--out", help="원본을 내보낸 결과를 저장할 파일 (선택)")
    args = parser.parse_args()

    (original,) = to_substation_graphs(read_raw(DATA_DIR / DEFAULT_FILE))
    xml = to_cim_xml(original)
    with tempfile.TemporaryDirectory() as tmp:
        # 1. 원본 왕복: 같은 mRID, 같은 값, 같은 피더
        again = _reload(xml, tmp)
        assert _normalized(again) == _normalized(original), "원본 왕복 결과가 다릅니다"
        assert [f.model_dump() for f in again.feeders] == [f.model_dump() for f in original.feeders]
        assert to_cim_xml(again) == xml, "다시 내보낸 XML이 처음과 다릅니다 (id가 결정적이지 않음)"
        print(f"  [통과] 원본 왕복: 노드 {len(again.nodes)}, 선로 {len(again.lines)} 그대로")

        # 2. 편집한 계통 왕복: 수정한 값, 새 개폐기(열림)·접속점·태양광, 선로 허용전류(CurrentLimit)가 살아 있어야 함
        edited = _edited(original)
        again = _reload(to_cim_xml(edited), tmp)
        assert _normalized(again) == _normalized(edited), "편집한 계통의 왕복 결과가 다릅니다"
        print("  [통과] 편집한 계통 왕복: 부하 값, 허용전류 520A, 영상분 없음, 열린 개폐기, 새 태양광")

        # 3. 개폐기끼리 바로 이은 연결 → 사이에 접속점이 생기고 위상은 같음
        d = edited.model_dump()
        sw = derived_id("export_test", "switch")
        sw2 = derived_id("export_test", "switch2")
        d["nodes"].append(dict(id=sw2, substation_id=d["substation"]["id"], name="LBS_테스트2", type="switch", x=0, y=0))
        last = d["lines"][-1]  # sw → bus 연결선을 sw → sw2 → bus로
        d["lines"].append(dict(last, id=derived_id("export_test", "sw_line", "2"), from_node_id=sw2))
        last["to_node_id"] = sw2
        again = _reload(to_cim_xml(SubstationGraph.model_validate(d)), tmp)
        assert len(again.nodes) == len(d["nodes"]) + 1 and sum(n.type == "switch" for n in again.nodes) == 2
        print("  [통과] 개폐기끼리 이은 연결: 사이에 접속점 1개 추가")

        # 4. 내보낼 수 없는 계통은 이유를 모두 모아 ExportError
        d = edited.model_dump()
        d["nodes"].append(dict(id="dangling", substation_id=d["substation"]["id"], name="떠 있는 부하", type="load", x=0, y=0))
        try:
            to_cim_xml(SubstationGraph.model_validate(d))
            raise AssertionError("ExportError가 나야 합니다")
        except ExportError as e:
            assert "떠 있는 부하이(가) 접속점" in str(e) and "소비 전력" in str(e)
        print("  [통과] 접속점에 안 붙은 부하 → ExportError")

    if args.out:
        Path(args.out).write_bytes(xml)
        print(f"  저장: {args.out}")
    print("CIM 내보내기 자체 점검 통과")
