"""프론트엔드 개발용 모의 백엔드 (Neo4j·Docker·OpenDSS·LLM 없이 화면을 만들어 보기 위한 것). 담당: 프론트엔드

진짜 백엔드(backend/)와 같은 주소(localhost:8000)·같은 형식으로 응답한다. 진짜 백엔드는 Neo4j(Docker)가 있어야 하므로,
화면만 고칠 때 가볍게 켜서 쓴다. 발표·검증은 진짜 백엔드(uvicorn)로 한다.
ponytail: 아래 계산·리포트는 화면 확인용 근사다. 진짜 백엔드만으로 개발이 충분히 편해지면 이 파일은 지워도 된다

진짜 백엔드와 다른 점 (헷갈리지 않도록):
- 계산: OpenDSS 대신 LinDistFlow 근사 → 전압·손실 숫자가 조금 다르다 (판정 결과는 대체로 같음)
- 리포트: LLM 대신 규칙으로 만든 예시 문장 ("(모의 리포트)" 표시)
- 저장: 없는 변전소도 새로 만들고 전원 개수를 검사하지 않는다. 진짜 백엔드는 이미 있는 변전소만 저장(없으면 404),
  전원 1개 필수(아니면 422) — cim/graph.py의 save_substation

    저장소 루트에서:  python frontend/mock/mock_server.py
    다른 터미널에서:  cd frontend && npm run dev   → http://localhost:5173

- 계통: data/korean_distribution_cim.xml을 cim/load.py로 변환해 메모리에 둔다 (Neo4j 대신). 저장(PUT)하면 메모리에만 반영, 껐다 켜면 처음 상태
- 시뮬레이션: OpenDSS 대신 방사형 근사 계산(LinDistFlow: 손실 무시 전압강하 ΔV ≈ (R·P + X·Q)/V²).
  완성·방사형 검사는 진짜 코드(simulation/dss.py의 trace)를 그대로 써서 422 메시지가 같다. 숫자는 OpenDSS와 조금 다르다
- 그래프: matplotlib이 있으면 진짜 simulation/plot.py로 그린다
- 리포트: LLM 대신 규칙으로 만든 예시 문장 ("모의 리포트"라고 표시)
필요한 것: pydantic (requirements.txt를 설치했으면 이미 있음), matplotlib(선택)
"""

import argparse
import json
import math
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from cim.graph import classify_connection  # noqa: E402
from cim.load import read_raw, to_substation_graphs  # noqa: E402
from cim.models import BASE_KV, Node, SnapshotSaved, SubstationGraph, SubstationSnapshot  # noqa: E402
from simulation.dss import (  # noqa: E402
    DEFAULT_RATED_CURRENT_A,
    DEFAULT_SHORT_CIRCUIT_MVA,
    DEFAULT_X_R_RATIO,
    SimulationError,
    open_line_ids,
    trace,
)
from simulation.models import FeederResult, LineResult, NodeResult, SimulationResult  # noqa: E402

STORE: dict[str, SubstationGraph] = {}


def simulate(g: SubstationGraph) -> SimulationResult:
    """방사형 근사 조류 계산 + 3상 단락전류. OpenDSS 대신 쓰는 간단한 계산"""
    traced = trace(g)  # 진짜 코드: 미완성·루프면 SimulationError (같은 422 메시지)
    reached = traced.distance_km
    source = next(n for n in g.nodes if n.type == "source")
    v0 = g.substation.source_voltage_pu
    disabled = open_line_ids(g)

    # 접속점별 부하(+)·발전(-) 합
    inj: dict[str, list[float]] = {}
    for n in g.nodes:
        if n.type in ("load", "pv", "wind") and n.bus_id:
            sign = 1 if n.type == "load" else -1
            s = inj.setdefault(n.bus_id, [0.0, 0.0])
            s[0] += sign * (n.p_kw or 0)
            s[1] += sign * (n.q_kvar or 0)

    # 전원에서 내려가는 트리 (부모 → 자식 선로)
    children: dict[str, list] = {}
    order = [source.bus_id]
    seen = {source.bus_id}
    adj: dict[str, list] = {}
    for line in g.lines:
        if line.id not in disabled:
            adj.setdefault(line.from_node_id, []).append(line)
            adj.setdefault(line.to_node_id, []).append(line)
    for cur in order:
        for line in adj.get(cur, []):
            nxt = line.to_node_id if line.from_node_id == cur else line.from_node_id
            if nxt in seen:
                continue
            seen.add(nxt)
            children.setdefault(cur, []).append((line, nxt))
            order.append(nxt)

    # 아래에서 위로 조류 합산 (부모 → 자식 방향 P, Q)
    flow: dict[str, tuple[float, float]] = {}
    sub_sum = {nid: list(inj.get(nid, [0.0, 0.0])) for nid in order}
    for nid in reversed(order):
        for line, child in children.get(nid, []):
            p, q = sub_sum[child]
            flow[line.id] = (p, q)
            sub_sum[nid][0] += p
            sub_sum[nid][1] += q

    # 위에서 아래로 전압·누적 임피던스
    mva = g.substation.short_circuit_mva or DEFAULT_SHORT_CIRCUIT_MVA
    xr = g.substation.x_r_ratio or DEFAULT_X_R_RATIO
    zs = BASE_KV**2 / mva
    volt = {source.bus_id: v0}
    zpath = {source.bus_id: complex(zs / math.sqrt(1 + xr**2), zs * xr / math.sqrt(1 + xr**2))}
    loss = 0.0
    line_res = {}
    for nid in order:
        for line, child in children.get(nid, []):
            p, q = flow[line.id]
            r = line.r_ohm_per_km * line.length_km
            x = line.x_ohm_per_km * line.length_km
            volt[child] = volt[nid] - (r * p + x * q) / (1000 * BASE_KV**2)
            zpath[child] = zpath[nid] + complex(r, x)
            s = math.hypot(p, q)
            amps = s / (math.sqrt(3) * BASE_KV * volt[nid])
            loss += r * s**2 / (1000 * BASE_KV**2)
            rated = line.rated_current_a or DEFAULT_RATED_CURRENT_A
            forward = line.from_node_id == nid  # 저장된 방향이 실제 전원 쪽 → 반대쪽인지
            line_res[line.id] = LineResult(line_id=line.id, p_kw=p if forward else -p, q_kvar=q if forward else -q,
                                           loading_pct=amps / rated * 100, reverse_flow=p < 0)
    lines = [line_res.get(line.id) or LineResult(line_id=line.id, p_kw=0, q_kvar=0, loading_pct=0) for line in g.lines]

    def node_result(n: Node) -> NodeResult:
        key = n.bus_id or n.id
        if key not in reached:
            return NodeResult(node_id=n.id, energized=False, voltage_pu=0.0)
        ka = BASE_KV / (math.sqrt(3) * abs(zpath[key]))
        return NodeResult(node_id=n.id, voltage_pu=volt[key], fault_current_ka=ka)

    breakers = {n.id: n.feeder_id for n in g.nodes if n.type == "breaker"}
    feeders = []
    for f in g.feeders:
        out = [r for r in lines if breakers.get(next(l for l in g.lines if l.id == r.line_id).from_node_id) == f.id]
        feeders.append(FeederResult(feeder_id=f.id, p_kw=sum(r.p_kw for r in out), q_kvar=sum(r.q_kvar for r in out)))
    return SimulationResult(substation_id=g.substation.id, converged=True, loss_kw=loss, feeders=feeders,
                            nodes=[node_result(n) for n in g.nodes], lines=lines)


def mock_report(g: SubstationGraph, r: SimulationResult) -> dict:
    """LLM 대신 규칙으로 만든 예시 리포트 (형식은 ai_report/models.py의 Report)"""
    names = {n.id: n.name for n in g.nodes}
    lnames = {line.id: line.name for line in g.lines}
    low = [x for x in r.nodes if x.energized and x.voltage_pu < 0.95]
    off = [x for x in r.nodes if not x.energized]
    rev = [x for x in r.lines if x.reverse_flow]
    over = [x for x in r.lines if (x.loading_pct or 0) > 100]
    problems = len(low) + len(off) + len(rev) + len(over)
    grade = "양호" if problems == 0 else "주의" if not (low or over) else "개선 필요"
    vmin = min((x.voltage_pu for x in r.nodes if x.energized), default=0)
    causes, solutions = [], []
    if rev:
        causes.append(f"태양광 발전이 그 구간 부하보다 많아 {', '.join(lnames[x.line_id] for x in rev[:3])} 선로에서 전력이 변전소 쪽으로 거꾸로 흐릅니다.")
        solutions.append("역조류 구간의 보호계전기 방향 설정을 점검하고, 필요하면 ESS로 낮 시간 잉여 전력을 흡수합니다.")
    if low:
        causes.append(f"말단까지 거리가 길어 {', '.join(names[x.node_id] for x in low[:3])} 지점 전압이 0.95 pu 아래로 떨어졌습니다.")
        solutions.append("굵은 전선으로 교체하거나 선로 중간에 전압조정기(SVR)를 설치합니다.")
    if over:
        causes.append(f"{', '.join(lnames[x.line_id] for x in over[:3])} 선로 전류가 허용전류를 넘었습니다.")
        solutions.append("부하 일부를 이웃 피더로 절체하거나 선로를 증강합니다.")
    if off:
        causes.append(f"열린 개폐기 아래 {len(off)}개 지점이 전원과 끊겨 정전 상태입니다.")
        solutions.append("의도한 작업 구간이 아니라면 개폐기를 닫거나 연계 선로로 복구합니다.")
    if not causes:
        causes.append("전압·부하율·조류 방향 모두 기준 안에 있습니다.")
        solutions.append("현재 운전 상태를 유지하고, 분산전원 추가 시 다시 시뮬레이션합니다.")
    time.sleep(1.5)  # LLM 응답 지연 흉내 (화면의 "생성 중" 표시 확인용)
    return {
        "substation_id": r.substation_id,
        "diagnosis": f"(모의 리포트) 계통 상태 {grade}. 최저 전압 {vmin:.3f} pu, 문제 항목 {problems}건, 선로 손실 {r.loss_kw:.0f} kW.",
        "causes": causes,
        "solutions": solutions,
    }


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[mock] {self.command} {self.path} → {args[1] if len(args) > 1 else ''}\n")

    def _send(self, status: int, body, content_type="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"null")

    def _graph(self, sid: str) -> SubstationGraph | None:
        return STORE.get(sid)

    def _route(self):
        parts = self.path.split("?")[0].strip("/").split("/")
        if parts[0] != "api":
            return None
        p = parts[1:]
        m = self.command
        try:
            if m == "GET" and p == ["health"]:
                return self._send(200, {"status": "ok", "neo4j": "mock"})
            if m == "GET" and p == ["substations"]:
                return self._send(200, [g.substation.model_dump() for g in STORE.values()])
            if m == "GET" and len(p) == 2 and p[0] == "substations":
                g = self._graph(p[1])
                return self._send(200, g.model_dump()) if g else self._send(404, {"detail": "변전소가 없습니다"})
            if m == "PUT" and len(p) == 2 and p[0] == "substations":
                snap = SubstationSnapshot.model_validate(self._body())
                if snap.substation.id != p[1]:
                    return self._send(422, {"detail": "주소의 변전소 id와 스냅샷의 substation.id가 다릅니다"})
                byid = {n.id: n for n in snap.nodes}
                for line in snap.lines:
                    line.kind = line.kind or classify_connection(byid[line.from_node_id], byid[line.to_node_id])
                g = SubstationGraph.model_validate(snap.model_dump())
                STORE[g.substation.id] = g
                ids = {x.id: f"4:mock:{i}" for i, x in enumerate([*g.nodes, *g.lines])}
                return self._send(200, SnapshotSaved(graph=g, element_ids=ids).model_dump())
            if m == "POST" and len(p) == 3 and p[0] == "substations" and p[2] == "simulations":
                g = self._graph(p[1])
                if not g:
                    return self._send(404, {"detail": "변전소가 없습니다"})
                return self._send(200, simulate(g).model_dump())
            if m == "POST" and p == ["plots"]:
                r = SimulationResult.model_validate(self._body())
                try:
                    from simulation.plot import plot_result
                except ImportError:
                    return self._send(501, {"detail": "matplotlib이 없어 그래프를 그리지 않습니다"})
                return self._send(200, plot_result(STORE[r.substation_id], r), "image/png")
            if m == "POST" and p == ["reports"]:
                r = SimulationResult.model_validate(self._body())
                return self._send(200, mock_report(STORE[r.substation_id], r))
        except SimulationError as e:
            return self._send(422, {"detail": str(e)})
        except ValueError as e:  # pydantic 검사 실패
            return self._send(422, {"detail": str(e)})
        return self._send(404, {"detail": "없는 주소"})

    def do_GET(self):
        if self._route() is None:
            super().do_GET()  # --static으로 빌드 결과를 줄 때만 쓰임

    def do_PUT(self):
        self._route()

    def do_POST(self):
        self._route()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="프론트엔드 개발용 모의 백엔드")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--file", default=str(ROOT / "data/korean_distribution_cim.xml"))
    ap.add_argument("--static", help="(선택) 빌드한 frontend/dist 폴더를 같이 서비스")
    args = ap.parse_args()
    for graph in to_substation_graphs(read_raw(Path(args.file))):
        STORE[graph.substation.id] = graph
    print(f"모의 백엔드: http://localhost:{args.port}/api/health  (변전소 {len(STORE)}개, {Path(args.file).name})")

    def handler(*a, **kw):
        return Handler(*a, directory=args.static or str(Path(__file__).parent), **kw)

    ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()
