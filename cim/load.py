"""한전 CIM RDF/XML → 내부 계통 모델 변환·Neo4j 적재 (FR-01, 제안서 1단계)

RDF 파싱은 rdflib (pip install rdflib). 파일 크기·개수가 늘어도 같은 코드로 읽는다.

매핑 규칙은 cim/mapping.py, Neo4j 구조는 cim/graph.py 참고.

실행 (프로젝트 루트에서)
    python -m cim.load              적재 (같은 mRID는 갱신, 여러 번 실행해도 중복 없음)
    python -m cim.load --reset      이 변전소의 기존 데이터를 지우고 다시 적재
    python -m cim.load --dry-run    Neo4j 없이 변환 결과만 출력 (매핑 확인용)
    python -m cim.load --file other.xml
    python -m cim.load --file eq.xml tp.xml dl.xml   여러 파일로 나뉜 데이터(CGMES 등)는 한 번에 넘긴다
"""

import argparse
import os
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import rdflib

from cim import mapping
from cim.models import ONE_TERMINAL_TYPES, Feeder, Line, Node, Substation, SubstationGraph
from cim.topology import derived_id, trace_feeders

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
DEFAULT_FILE = "korean_distribution_cim.xml"

# 자동 배치 간격 (단선도 좌표 단위)
DX, DY = 120.0, 100.0

SUMMARY_LINES = 20  # 변환 결과 출력 때 보여줄 선로 수 (큰 계통에서 화면이 넘치지 않게)

# ───────────────────────────── 1. RDF 읽기 (rdflib) ─────────────────────────────
@dataclass
class CimObject:
    ref: str  # RDF 안 참조 키 (객체 URI. rdf:about 값, 또는 rdf:ID를 BASE_URI 기준으로 푼 값)
    cls: str  # CIM 클래스 이름
    attrs: dict[str, str]  # {"ACLineSegment.r": "0.256", "Terminal.ConnectivityNode": "<참조 키>", ...}

    @property
    def mrid(self) -> str:
        if self.attrs.get("IdentifiedObject.mRID"):
            return self.attrs["IdentifiedObject.mRID"]
        # mRID 속성이 없으면 URI에서 id 부분을 쓴다 (urn:uuid:xxx, ...#_xxx 둘 다)
        return self.ref.rsplit("#", 1)[-1].removeprefix("urn:uuid:").lstrip("_")


# 여러 파일로 나뉜 데이터(CGMES의 EQ·TP·DL 등)는 한 파일의 rdf:ID="_x"를 다른 파일이 rdf:about="#_x"로 덧붙인다.
# 파일마다 기준 주소가 다르면 같은 객체가 다른 URI가 되므로, 모든 파일을 같은 기준 주소로 읽는다.
BASE_URI = "urn:kepco:cim"

RDF_TYPE = rdflib.RDF.type


def _cim_local(uri) -> str | None:
    """CIM 네임스페이스 URI면 로컬 이름("ACLineSegment.r")을, 아니면 None.
    CIM 버전(cim16, cim17, CIM100 등)마다 네임스페이스 주소가 달라서 접두어로 판단한다."""
    text = str(uri)
    if not text.startswith(mapping.CIM_NS_PREFIX):
        return None
    return text.split("#", 1)[1] if "#" in text else None


def read_graph(paths: list[Path]) -> rdflib.Graph:
    """CIM RDF/XML 파일(여러 개 가능)을 하나의 rdflib 그래프로 합친다."""
    g = rdflib.Graph()
    for path in paths:
        g.parse(path, format="xml", publicID=BASE_URI)
        print(f"  {path.name}: 누적 트리플 {len(g):,}개")
    return g


def read_raw(paths: Path | list[Path]) -> dict[str, CimObject]:
    """CIM RDF의 모든 객체를 참조 키 → CimObject로 읽는다.
    rdflib이 중첩 정의, rdf:about/rdf:ID/rdf:resource, 여러 파일 병합을 모두 처리해 준다."""
    if isinstance(paths, Path):
        paths = [paths]
    g = read_graph(paths)

    objs: dict[str, CimObject] = {}
    for subj, cls_uri in g.subject_objects(RDF_TYPE):
        cls = _cim_local(cls_uri)
        if cls is not None:
            objs[str(subj)] = CimObject(str(subj), cls, {})

    for subj, pred, obj in g:
        target = objs.get(str(subj))
        key = _cim_local(pred)
        if target is None or key is None:
            continue
        if isinstance(obj, rdflib.Literal):
            target.attrs[key] = str(obj).strip()
        else:
            # 참조(URIRef)이거나 enum 값(예: ...#PhaseCode.ABC). 참조는 objs의 키와 같은 문자열이 된다
            target.attrs[key] = str(obj)
    return objs


# ───────────────────────────── 2. 내부 모델로 변환 ─────────────────────────────
class _Builder:
    def __init__(self, objs: dict[str, CimObject]):
        self.objs = objs
        self.terminals: dict[str, list[tuple[int, str]]] = defaultdict(list)  # 설비 ref → [(순번, CN ref)]
        for o in objs.values():
            if o.cls == "Terminal":
                f = mapping.map_fields("Terminal", o.attrs)
                self.terminals[f["equipment"]].append((f.get("sequence", 0), f["bus"]))
        for lst in self.terminals.values():
            lst.sort()

    def substation_of(self, o: CimObject) -> CimObject | None:
        """컨테이너를 따라 올라가 소속 변전소를 찾는다 (설비 → VoltageLevel → Substation)."""
        seen = set()
        while o is not None and o.ref not in seen:
            seen.add(o.ref)
            if o.cls == "Substation":
                return o
            nxt = (
                o.attrs.get(mapping.CONTAINER_ATTR)
                or o.attrs.get("ConnectivityNode.ConnectivityNodeContainer")
                or o.attrs.get("VoltageLevel.Substation")
            )
            o = self.objs.get(nxt) if nxt else None
        return None

    def check(self) -> None:
        unknown = sorted({o.cls for o in self.objs.values()} - set(mapping.CLASS_MAP))
        if unknown:
            print(f"  [경고] 매핑 표에 없어 건너뛴 클래스: {', '.join(unknown)}")
        for o in self.objs.values():
            if o.cls == "VoltageLevel":
                v = mapping.map_fields("VoltageLevel", o.attrs)["base_voltage_v"]
                if abs(v - mapping.BASE_VOLTAGE_V) > 1:
                    raise ValueError(f"VoltageLevel {o.attrs.get('IdentifiedObject.name')}: 22.9kV가 아닙니다 ({v} V)")
            cm = mapping.CLASS_MAP.get(o.cls)
            if cm and cm.terminals and len(self.terminals.get(o.ref, [])) != cm.terminals:
                raise ValueError(
                    f"{o.cls} {o.attrs.get('IdentifiedObject.name')}: 단자가 {cm.terminals}개여야 하는데 "
                    f"{len(self.terminals.get(o.ref, []))}개입니다"
                )

    def build(self) -> list[SubstationGraph]:
        self.check()
        subs = [o for o in self.objs.values() if o.cls == "Substation"]
        if not subs:
            raise ValueError("CIM 파일에 Substation이 없습니다")
        groups: dict[str, list[CimObject]] = defaultdict(list)
        for o in self.objs.values():
            cm = mapping.CLASS_MAP.get(o.cls)
            if cm is None or cm.target not in ("node", "line"):
                continue
            sub = self.substation_of(o) or (subs[0] if len(subs) == 1 else None)
            if sub is None:
                print(f"  [경고] 소속 변전소를 알 수 없어 건너뜀: {o.cls} {o.attrs.get('IdentifiedObject.name')}")
                continue
            groups[sub.ref].append(o)
        return [self.build_substation(s, groups[s.ref]) for s in subs]

    def build_substation(self, sub_obj: CimObject, members: list[CimObject]) -> SubstationGraph:
        sub_id = sub_obj.mrid
        substation = Substation(**mapping.map_fields("Substation", sub_obj.attrs))
        mrid = lambda ref: self.objs[ref].mrid  # noqa: E731

        nodes: dict[str, dict] = {}
        lines: dict[str, dict] = {}
        line_switch_rating: dict[str, float | None] = {}

        for o in members:
            cm = mapping.CLASS_MAP[o.cls]
            f = mapping.map_fields(o.cls, o.attrs)
            terms = self.terminals.get(o.ref, [])

            if cm.target == "line":  # ACLineSegment
                f.update(substation_id=sub_id, kind="line",
                         from_node_id=mrid(terms[0][1]), to_node_id=mrid(terms[1][1]))
                lines[f["id"]] = f
                continue

            node_type = cm.node_type
            if o.cls == "Breaker":
                container = self.objs.get(o.attrs.get(mapping.CONTAINER_ATTR, ""))
                node_type = mapping.breaker_type(container.cls if container else None)
            rating = f.pop("rated_current_a", None)
            f.update(substation_id=sub_id, type=node_type, x=0.0, y=0.0)
            if node_type in ONE_TERMINAL_TYPES:
                f["bus_id"] = mrid(terms[0][1])
            if node_type == "switch":
                f.setdefault("is_open", False)
            else:
                f.pop("is_open", None)  # 모델 규칙: is_open은 switch만 (차단기는 닫힌 것으로 본다)
            nodes[f["id"]] = f

            if node_type in ("breaker", "switch"):  # 개폐기 노드 ↔ 양쪽 접속점을 잇는 switch 선로
                for seq, cn_ref in terms:
                    lid = derived_id(f["id"], "terminal", str(seq))
                    lines[lid] = dict(
                        id=lid, substation_id=sub_id, name=f"{f['name']}_단자{seq}", kind="switch",
                        from_node_id=mrid(cn_ref), to_node_id=f["id"],
                        length_km=0.0, r_ohm_per_km=0.0, x_ohm_per_km=0.0, rated_current_a=rating,
                    )
                    line_switch_rating[lid] = rating

        sources = [n for n in nodes.values() if n["type"] == "source"]
        if len(sources) != 1:
            raise ValueError(f"변전소 {substation.name}: 전원(BusbarSection)이 {len(sources)}개입니다. 1개여야 합니다")

        feeders = self.trace(sources[0], nodes, lines, sub_id)
        self.layout(sources[0], nodes, lines)

        return SubstationGraph(
            substation=substation,
            feeders=feeders,
            nodes=[Node(**n) for n in nodes.values()],
            lines=[Line(**l) for l in lines.values()],
        )

    # ── 위상 탐색: 선로 방향(from=전원 쪽)과 피더 소속을 정한다 (cim/topology.py) ──
    def trace(self, source: dict, nodes: dict, lines: dict, sub_id: str) -> list[Feeder]:
        feeders, warnings = trace_feeders(source, nodes, lines, sub_id)
        for w in warnings:
            print(f"  [경고] {w}")
        return feeders

    # ── 단선도 자동 배치: 전원을 뿌리로 하는 위→아래 트리 ──
    def layout(self, source: dict, nodes: dict, lines: dict) -> None:
        children: dict[str, list[str]] = defaultdict(list)
        children[source["id"]].append(source["bus_id"])
        for l in lines.values():
            children[l["from_node_id"]].append(l["to_node_id"])
        for n in nodes.values():  # 단자 1개 설비는 자기 접속점의 자식 잎으로 배치
            if n.get("bus_id") and n["type"] != "source":
                children[n["bus_id"]].append(n["id"])

        next_x = [0.0]
        placed: set[str] = set()

        def place(nid: str, depth: int) -> float:
            placed.add(nid)
            kids = [k for k in children.get(nid, []) if k not in placed]
            # 선로로 이어진 자식을 먼저, 부하·PV 잎을 나중에 (가지가 곧게 뻗도록)
            kids.sort(key=lambda k: nodes[k]["type"] in ONE_TERMINAL_TYPES)
            xs = [place(k, depth + 1) for k in kids if k not in placed]
            if xs:
                x = (xs[0] + xs[-1]) / 2
            else:
                x = next_x[0]
                next_x[0] += DX
            nodes[nid]["x"], nodes[nid]["y"] = x, depth * DY
            return x

        place(source["id"], 0)
        max_y = max((n["y"] for n in nodes.values()), default=0.0)
        for n in nodes.values():  # 닿지 않은 노드는 맨 아래 한 줄에
            if n["id"] not in placed:
                n["x"], n["y"] = next_x[0], max_y + 2 * DY
                next_x[0] += DX


def to_substation_graphs(objs: dict[str, CimObject]) -> list[SubstationGraph]:
    return _Builder(objs).build()


# ───────────────────────────── 3. Neo4j 적재 ─────────────────────────────
NODE_PROPS = ("id", "substation_id", "feeder_id", "name", "type", "p_kw", "q_kvar", "is_open")
LINE_PROPS = ("id", "substation_id", "feeder_id", "name", "kind",
              "length_km", "r_ohm_per_km", "x_ohm_per_km", "rated_current_a")


def ensure_schema(session) -> None:
    text = (Path(__file__).parent / "schema.cypher").read_text(encoding="utf-8")
    body = "\n".join(l for l in text.splitlines() if not l.strip().startswith("//"))
    for stmt in body.split(";"):
        if stmt.strip():
            session.run(stmt)


def _write_graph(tx, g: SubstationGraph, reset: bool) -> None:
    sid = g.substation.id
    if reset:
        tx.run("""
            MATCH (n:Node {substation_id: $sid})
            OPTIONAL MATCH (n)-[:HAS_DIAGRAM]->(d:DiagramObject)
            DETACH DELETE n, d""", sid=sid)
        tx.run("MATCH (f:Feeder {substation_id: $sid}) DETACH DELETE f", sid=sid)

    tx.run("MERGE (s:Substation {id: $p.id}) SET s += $p", p=g.substation.model_dump())
    tx.run("""
        MATCH (s:Substation {id: $sid})
        UNWIND $rows AS p
        MERGE (f:Feeder {id: p.id}) SET f += p
        MERGE (s)-[:HAS_FEEDER]->(f)""",
        sid=sid, rows=[f.model_dump() for f in g.feeders])

    tx.run("""
        UNWIND $rows AS row
        MERGE (n:Node {id: row.p.id}) SET n += row.p
        MERGE (n)-[:HAS_DIAGRAM]->(d:DiagramObject)
        SET d.x = row.x, d.y = row.y""",
        rows=[{"p": {k: getattr(n, k) for k in NODE_PROPS}, "x": n.x, "y": n.y} for n in g.nodes])

    tx.run("""
        UNWIND $rows AS row
        MATCH (n:Node {id: row.id})
        OPTIONAL MATCH (n)-[old:CONNECTED_TO]->()
        DELETE old
        WITH DISTINCT n, row
        MATCH (b:Node {id: row.bus_id})
        MERGE (n)-[:CONNECTED_TO]->(b)""",
        rows=[{"id": n.id, "bus_id": n.bus_id} for n in g.nodes if n.bus_id])

    # 방향이 바뀌었을 수 있으므로 같은 id의 선로를 지우고 새로 만든다
    tx.run("""
        UNWIND $rows AS row
        OPTIONAL MATCH ()-[old:LINE {id: row.p.id}]-()
        DELETE old
        WITH DISTINCT row
        MATCH (a:Node {id: row.from_id}), (b:Node {id: row.to_id})
        CREATE (a)-[l:LINE]->(b) SET l = row.p""",
        rows=[{"p": {k: getattr(l, k) for k in LINE_PROPS}, "from_id": l.from_node_id, "to_id": l.to_node_id}
              for l in g.lines])


def save_to_neo4j(graphs: list[SubstationGraph], reset: bool = False) -> None:
    from cim import db

    with db.get_driver().session() as session:
        ensure_schema(session)
        for g in graphs:
            session.execute_write(_write_graph, g, reset)
            print(f"  적재 완료: {g.substation.name} (피더 {len(g.feeders)}, 노드 {len(g.nodes)}, 선로 {len(g.lines)})")


# ───────────────────────────── 실행 ─────────────────────────────
def summarize(g: SubstationGraph) -> None:
    by_type: dict[str, int] = defaultdict(int)
    for n in g.nodes:
        by_type[n.type] += 1
    print(f"\n[{g.substation.name}] 피더 {[f.name for f in g.feeders]}")
    print("  노드:", dict(by_type))
    print(f"  선로: line {sum(l.kind == 'line' for l in g.lines)}, switch {sum(l.kind == 'switch' for l in g.lines)}")
    print(f"  부하 합계 {sum(n.p_kw or 0 for n in g.nodes if n.type == 'load'):.0f} kW, "
          f"PV 합계 {sum(n.p_kw or 0 for n in g.nodes if n.type == 'pv'):.0f} kW")
    names = {n.id: n.name for n in g.nodes}
    for l in g.lines[:SUMMARY_LINES]:
        print(f"  {names[l.from_node_id]} → {names[l.to_node_id]}  "
              f"[{l.kind}] {l.length_km} km, {l.r_ohm_per_km:.3f}+j{l.x_ohm_per_km:.3f} Ω/km")
    if len(g.lines) > SUMMARY_LINES:
        print(f"  ... 외 선로 {len(g.lines) - SUMMARY_LINES}개")


def load(paths: list[Path], reset: bool = False, dry_run: bool = False) -> list[SubstationGraph]:
    print(f"[{', '.join(p.name for p in paths)}] 읽는 중...")
    graphs = to_substation_graphs(read_raw(paths))
    for g in graphs:
        summarize(g)
    if not dry_run:
        save_to_neo4j(graphs, reset=reset)
    return graphs


def _read_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="한전 CIM XML → Neo4j 적재")
    parser.add_argument("--file", nargs="+", default=[DEFAULT_FILE],
                        help=f"data/ 안의 파일 이름, 여러 개 가능 (기본 {DEFAULT_FILE})")
    parser.add_argument("--reset", action="store_true", help="이 변전소의 기존 데이터를 지우고 적재")
    parser.add_argument("--dry-run", action="store_true", help="Neo4j에 쓰지 않고 변환 결과만 출력")
    args = parser.parse_args()
    paths = [Path(f) if Path(f).is_absolute() else DATA_DIR / f for f in args.file]

    if args.dry_run:
        load(paths, dry_run=True)
    else:
        from cim import db

        _read_env_file(ROOT_DIR / ".env")
        db.connect()
        try:
            load(paths, reset=args.reset)
        finally:
            db.close()
