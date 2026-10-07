"""한전 CIM16 XML → 내부 계통 모델 변환·Neo4j 적재 (FR-01, 제안서 1단계)

매핑 규칙은 cim/mapping.py, Neo4j 구조는 cim/graph.py 참고.

실행 (프로젝트 루트에서)
    python -m cim.load              적재 (같은 mRID는 갱신, 여러 번 실행해도 중복 없음)
    python -m cim.load --reset      이 변전소의 기존 데이터를 지우고 다시 적재
    python -m cim.load --dry-run    Neo4j 없이 변환 결과만 출력 (매핑 확인용)
    python -m cim.load --file other.xml
"""

import argparse
import os
import uuid
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path

from cim import mapping
from cim.models import ONE_TERMINAL_TYPES, Feeder, Line, Node, Substation, SubstationGraph

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
DEFAULT_FILE = "korean_distribution_cim.xml"

# 원본에 없는 객체(피더, 개폐기 연결선)의 id. mRID에서 결정적으로 만들어서 다시 적재해도 같은 id가 나온다
_ID_NS = uuid.UUID("6f1c2a4e-5b7d-4e8a-9c3f-2d1e0b9a8c7d")

# 자동 배치 간격 (단선도 좌표 단위)
DX, DY = 120.0, 100.0

_C = "{%s}" % mapping.CIM_NS
_R = "{%s}" % mapping.RDF_NS


def derived_id(*parts: str) -> str:
    return str(uuid.uuid5(_ID_NS, ":".join(parts)))


# ───────────────────────────── 1. XML 읽기 ─────────────────────────────
@dataclass
class CimObject:
    ref: str  # XML 안 참조 키 (rdf:about 또는 "#" + rdf:ID)
    cls: str  # CIM 클래스 이름
    attrs: dict[str, str]  # {"ACLineSegment.r": "0.256", "Terminal.ConnectivityNode": "<참조 키>", ...}

    @property
    def mrid(self) -> str:
        return self.attrs.get("IdentifiedObject.mRID") or self.ref.removeprefix("urn:uuid:").lstrip("#")


def _ref_of(el: ET.Element) -> str | None:
    if el.get(_R + "about"):
        return el.get(_R + "about")
    if el.get(_R + "ID"):
        return "#" + el.get(_R + "ID")
    return None


def read_raw(path: Path) -> dict[str, CimObject]:
    """RDF/XML의 모든 CIM 객체를 참조 키 → CimObject로 읽는다. 중첩 정의와 rdf:resource 참조를 모두 처리한다."""
    root = ET.parse(path).getroot()
    objs: dict[str, CimObject] = {}
    for el in root.iter():
        ref = _ref_of(el)
        if ref is None or not el.tag.startswith(_C):
            continue
        obj = objs.setdefault(ref, CimObject(ref, el.tag[len(_C):], {}))
        for ch in el:
            if not ch.tag.startswith(_C):
                continue
            key = ch.tag[len(_C):]
            if ch.get(_R + "resource"):
                obj.attrs[key] = ch.get(_R + "resource")
            elif len(ch) and _ref_of(ch[0]):
                obj.attrs[key] = _ref_of(ch[0])
            elif ch.text is not None:
                obj.attrs[key] = ch.text.strip()
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

    # ── 위상 탐색: 선로 방향(from=전원 쪽)과 피더 소속을 정한다 ──
    def trace(self, source: dict, nodes: dict, lines: dict, sub_id: str) -> list[Feeder]:
        adj: dict[str, list[str]] = defaultdict(list)  # 노드 id → 닿은 선로 id
        for l in lines.values():
            adj[l["from_node_id"]].append(l["id"])
            adj[l["to_node_id"]].append(l["id"])

        feeders: list[Feeder] = []
        feeder_of: dict[str, str | None] = {source["bus_id"]: None}
        queue = deque([source["bus_id"]])
        used: set[str] = set()
        loops = 0
        while queue:
            cur = queue.popleft()
            cur_node = nodes[cur]
            if cur_node["type"] == "switch" and cur_node.get("is_open"):
                continue  # 열린 개폐기 너머는 이 경로로 내려가지 않음
            for lid in adj[cur]:
                if lid in used:
                    continue
                used.add(lid)
                l = lines[lid]
                nxt = l["to_node_id"] if l["from_node_id"] == cur else l["from_node_id"]
                if nxt in feeder_of:
                    loops += 1  # 이미 방문한 노드로 돌아오는 선로 → 루프 (방향은 원본 유지)
                    continue
                l["from_node_id"], l["to_node_id"] = cur, nxt
                fid = feeder_of[cur]
                if nodes[nxt]["type"] == "breaker":  # 출구 차단기 = 새 피더 시작
                    fid = derived_id(nxt, "feeder")
                    feeders.append(Feeder(id=fid, substation_id=sub_id, name=nodes[nxt]["name"]))
                feeder_of[nxt] = fid
                l["feeder_id"] = fid
                queue.append(nxt)

        for n in nodes.values():
            key = n.get("bus_id", n["id"])
            n["feeder_id"] = feeder_of.get(key)
        unreached = [n["name"] for n in nodes.values() if n.get("bus_id", n["id"]) not in feeder_of]
        if loops:
            print(f"  [경고] 루프 선로 {loops}개: 방사형이 아닙니다 (열린 개폐기 확인)")
        if unreached:
            print(f"  [경고] 전원에서 닿지 않는 노드 {len(unreached)}개: {', '.join(unreached[:10])}")
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
    for l in g.lines:
        print(f"  {names[l.from_node_id]} → {names[l.to_node_id]}  "
              f"[{l.kind}] {l.length_km} km, {l.r_ohm_per_km:.3f}+j{l.x_ohm_per_km:.3f} Ω/km")


def load(path: Path, reset: bool = False, dry_run: bool = False) -> list[SubstationGraph]:
    print(f"[{path.name}] 읽는 중...")
    graphs = to_substation_graphs(read_raw(path))
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
    parser.add_argument("--file", default=DEFAULT_FILE, help=f"data/ 안의 파일 이름 (기본 {DEFAULT_FILE})")
    parser.add_argument("--reset", action="store_true", help="이 변전소의 기존 데이터를 지우고 적재")
    parser.add_argument("--dry-run", action="store_true", help="Neo4j에 쓰지 않고 변환 결과만 출력")
    args = parser.parse_args()
    path = Path(args.file) if Path(args.file).is_absolute() else DATA_DIR / args.file

    if args.dry_run:
        load(path, dry_run=True)
    else:
        from cim import db

        _read_env_file(ROOT_DIR / ".env")
        db.connect()
        try:
            load(path, reset=args.reset)
        finally:
            db.close()
