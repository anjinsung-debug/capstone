"""LLM 리포트 생성 (FR-08, FR-09, 제안서 5단계)

흐름: 계통 정보 + 시뮬레이션 결과 → (코드가 판정 기준으로 문제 항목을 먼저 계산) → 구조화된 프롬프트
      → Claude 호출 (tool use로 형식 고정) → Report(진단, 원인, 솔루션)

LLM 환각을 줄이는 방법 (제안서 10장 리스크 대응):
    1. 문제 항목(저전압·과전압·과부하·역조류·정전)과 건강도 등급은 LLM이 아니라 이 파일의 코드가 판정 기준
       (simulation/models.py의 VOLTAGE_MIN_PU 등)으로 계산해서 "확정된 사실"로 넘긴다. LLM은 그 사실을 풀어서 설명만 한다
    2. 프롬프트에 없는 수치·설비는 쓰지 말라고 지시하고, 원인에는 설비 이름과 수치를 인용하게 한다
    3. 허용전류·단락용량이 데이터에 없어 가정값으로 계산된 경우, 그 사실을 프롬프트에 넣어 리포트에 밝히게 한다
    4. 출력은 tool use의 JSON 형식(진단 1개, 원인 목록, 솔루션 목록)으로 고정한다

환경 변수 (.env): ANTHROPIC_API_KEY (필수), ANTHROPIC_MODEL (선택, 기본 DEFAULT_MODEL)

자체 점검 (API 호출 없이 프롬프트만 확인): python -m ai_report.report
                   (실제로 호출까지: python -m ai_report.report --call)
"""

import os

from ai_report.models import Report
from cim.models import BASE_KV, SubstationGraph
from simulation.dss import DEFAULT_RATED_CURRENT_A, DEFAULT_SHORT_CIRCUIT_MVA, DEFAULT_X_R_RATIO
from simulation.models import OVERLOAD_PCT, VOLTAGE_MAX_PU, VOLTAGE_MIN_PU, SimulationResult

# ponytail: 모델은 회의록 "AI 리포트 구성"에서 아직 정하지 않았다. 확정되면 기본값을 바꾸거나 .env의 ANTHROPIC_MODEL로 지정한다
DEFAULT_MODEL = "claude-sonnet-5-5"
MAX_TOKENS = 2000
TIMEOUT_SEC = 60.0
MAX_ROWS = 120  # 프롬프트에 넣는 지점·선로 표의 최대 줄 수. 넘으면 문제가 큰 순으로 자른다
TOOL_NAME = "submit_report"

GRADES = ("양호", "주의", "개선 필요")


class ReportError(Exception):
    """리포트를 만들 수 없을 때 (키 없음, API 호출 실패, 응답 형식 오류, 수렴하지 않은 결과). 백엔드가 503으로 알린다."""


SYSTEM_PROMPT = f"""당신은 22.9kV 배전계통 해석 결과를 설명하는 전력계통 엔지니어입니다.
독자는 전력계통을 잘 모르는 초보 관제 인력과 학생입니다. 쉬운 한국어로, 전문 용어는 처음 나올 때 짧게 풀어 쓰세요.

사용자가 계통 정보와 시뮬레이션 수치, 그리고 코드가 이미 판정한 "확정된 점검 결과"를 줍니다. 아래 규칙을 지키세요.
1. 제공된 수치와 설비 이름만 쓰세요. 없는 값을 추측하거나 만들어 내지 마세요. 모르는 것은 "데이터에 없음"이라고 쓰세요.
2. 건강도 등급은 "확정된 점검 결과"에 적힌 등급을 그대로 쓰세요. 바꾸거나 다시 판정하지 마세요.
3. 판정 기준: 전압 정상 범위 {VOLTAGE_MIN_PU}~{VOLTAGE_MAX_PU} pu, 선로 부하율 {OVERLOAD_PCT:.0f}% 초과면 과부하, 분산전원 때문에 전력이 반대로 흐르면 역조류, 전원에서 끊기면 정전입니다. 정전은 저전압이 아닙니다.
4. 원인은 문제가 있는 설비 이름과 수치를 인용해서, 왜 그렇게 되는지 전기적 이유(선로 길이와 임피던스에 따른 전압강하, 분산전원 출력이 부하보다 큰 구간, 전류가 허용전류를 넘음 등)를 설명하세요. 입력에 없는 연결 구조를 가정하지 마세요.
5. 솔루션은 원인과 하나씩 대응시키고 우선순위 순서로 쓰세요. 전선 굵기 교체, 전압조정기(SVR) 설치, 부하 절체, 역조류 보호계전 점검, ESS 설치, 개폐기 조작처럼 엔지니어가 실제로 할 수 있는 조치로 쓰고, 효과를 수치로 약속하지 마세요.
6. 문제가 없으면 원인에는 "기준 안에 있음"을 근거 수치와 함께 쓰고, 솔루션에는 유지·재점검 방법만 쓰세요. 문제를 지어내지 마세요.
7. 허용전류나 단락용량이 가정값으로 계산됐다고 알려 주면, 그 값에 의존하는 부하율·고장전류 설명에 "가정값 기준"이라고 밝히세요.
8. 진단은 2~3문장, 원인과 솔루션은 각각 항목당 1~2문장으로 간결하게 쓰세요."""

REPORT_TOOL = {
    "name": TOOL_NAME,
    "description": "배전계통 건강도 진단 리포트를 제출한다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "diagnosis": {"type": "string", "description": "1단계 건강도 진단. 확정된 등급으로 시작하고 핵심 수치를 2~3문장으로 요약"},
            "causes": {"type": "array", "items": {"type": "string"}, "description": "2단계 원인 분석. 문제 항목별 항목 하나, 설비 이름과 수치 인용"},
            "solutions": {"type": "array", "items": {"type": "string"}, "description": "3단계 솔루션 제안. 우선순위 순서, 원인과 대응"},
        },
        "required": ["diagnosis", "causes", "solutions"],
    },
}


def check_findings(graph: SubstationGraph, result: SimulationResult) -> dict:
    """판정 기준으로 문제 항목과 건강도 등급을 계산한다 (LLM에 넘기는 확정된 사실). 각 항목은 (이름, 수치) 목록."""
    names = {n.id: n.name for n in graph.nodes}
    line_names = {line.id: line.name for line in graph.lines}
    low = [(names.get(r.node_id, r.node_id), r.voltage_pu) for r in result.nodes if r.energized and r.voltage_pu < VOLTAGE_MIN_PU]
    high = [(names.get(r.node_id, r.node_id), r.voltage_pu) for r in result.nodes if r.energized and r.voltage_pu > VOLTAGE_MAX_PU]
    outage = [names.get(r.node_id, r.node_id) for r in result.nodes if not r.energized]
    overload = [(line_names.get(r.line_id, r.line_id), r.loading_pct) for r in result.lines if r.loading_pct is not None and r.loading_pct > OVERLOAD_PCT]
    reverse = [(line_names.get(r.line_id, r.line_id), r.p_kw) for r in result.lines if r.reverse_flow]
    low.sort(key=lambda x: x[1])
    high.sort(key=lambda x: -x[1])
    overload.sort(key=lambda x: -x[1])
    # 등급: 전압·부하율 기준을 넘는 항목이 있으면 개선 필요, 역조류·정전만 있으면 주의, 없으면 양호
    if low or high or overload:
        grade = GRADES[2]
    elif reverse or outage:
        grade = GRADES[1]
    else:
        grade = GRADES[0]
    return {"grade": grade, "low": low, "high": high, "outage": outage, "overload": overload, "reverse": reverse}


def _assumptions(graph: SubstationGraph) -> list[str]:
    """데이터에 없어 시뮬레이션이 가정값으로 계산한 항목 (부하율·고장전류가 이 값에 의존한다)"""
    out = []
    no_rating = [line for line in graph.lines if line.kind != "switch" and line.rated_current_a is None]
    if no_rating:
        out.append(f"선로 {len(no_rating)}개는 허용전류 데이터가 없어 {DEFAULT_RATED_CURRENT_A:.0f} A 가정값으로 부하율을 계산했습니다.")
    sub = graph.substation
    if sub.short_circuit_mva is None:
        out.append(f"변전소 3상 단락용량 데이터가 없어 {DEFAULT_SHORT_CIRCUIT_MVA:.0f} MVA 가정값으로 고장전류를 계산했습니다.")
    if sub.x_r_ratio is None:
        out.append(f"변전소 X/R 데이터가 없어 {DEFAULT_X_R_RATIO:.0f} 가정값으로 고장전류를 계산했습니다.")
    return out


def _limit(rows: list[str], total: int, what: str) -> list[str]:
    if len(rows) <= MAX_ROWS:
        return rows
    return rows[:MAX_ROWS] + [f"(... {what} {total - MAX_ROWS}개는 문제가 작아 생략)"]


def build_prompt(graph: SubstationGraph, result: SimulationResult) -> str:
    """계통 정보와 해석 수치를 구조화된 텍스트로 만든다 (README: 설비 이름·종류·연결, 전압 pu, 부하율, 고장전류, 역조류, 피더별 송출 전력)"""
    f = check_findings(graph, result)
    nodes = {n.id: n for n in graph.nodes}
    node_res = {r.node_id: r for r in result.nodes}
    line_res = {r.line_id: r for r in result.lines}
    feeder_names = {fd.id: fd.name for fd in graph.feeders}
    sub = graph.substation

    def label(node_id: str) -> str:
        n = nodes.get(node_id)
        return f"{n.name}({n.type})" if n else node_id

    lines = [f"# 변전소 {sub.name}", f"기준 전압 {BASE_KV} kV, 변전소 모선 전압 {sub.source_voltage_pu:.3f} pu, 선로 손실 합계 {result.loss_kw:.1f} kW", ""]

    lines.append("## 확정된 점검 결과 (코드가 판정 기준으로 계산한 사실. 그대로 쓰세요)")
    lines.append(f"- 건강도 등급: {f['grade']}")
    lines.append(f"- 저전압(<{VOLTAGE_MIN_PU} pu) {len(f['low'])}곳" + (": " + ", ".join(f"{n} {v:.3f} pu" for n, v in f["low"]) if f["low"] else ""))
    lines.append(f"- 과전압(>{VOLTAGE_MAX_PU} pu) {len(f['high'])}곳" + (": " + ", ".join(f"{n} {v:.3f} pu" for n, v in f["high"]) if f["high"] else ""))
    lines.append(f"- 과부하(>{OVERLOAD_PCT:.0f}%) 선로 {len(f['overload'])}개" + (": " + ", ".join(f"{n} {p:.0f}%" for n, p in f["overload"]) if f["overload"] else ""))
    lines.append(f"- 역조류 선로 {len(f['reverse'])}개" + (": " + ", ".join(f"{n} {p:.0f} kW" for n, p in f["reverse"]) if f["reverse"] else ""))
    lines.append(f"- 정전 지점 {len(f['outage'])}곳" + (": " + ", ".join(f["outage"]) if f["outage"] else ""))
    assumptions = _assumptions(graph)
    if assumptions:
        lines.append("- 가정값 사용: " + " ".join(assumptions))
    lines.append("")

    lines.append("## 피더별 변전소 출구 송출 전력")
    for fr in result.feeders:
        lines.append(f"- {feeder_names.get(fr.feeder_id, fr.feeder_id)}: 유효 {fr.p_kw / 1000:.2f} MW, 무효 {fr.q_kvar / 1000:.2f} MVAr")
    lines.append("")

    # 부하·분산전원: 어느 접속점에 얼마가 붙었는지 (원인 설명의 근거. 결과 표에는 단자 1개 설비가 없을 수 있다). 분산전원 먼저, 큰 것 순
    devices = sorted(
        (n for n in graph.nodes if n.type in ("load", "pv", "wind") and n.p_kw is not None),
        key=lambda n: (n.type == "load", -n.p_kw),
    )
    kind_ko = {"load": "부하 소비", "pv": "태양광 출력", "wind": "풍력 출력"}
    device_rows = [
        f"- {n.name}({n.type}): {nodes[n.bus_id].name if n.bus_id in nodes else '연결 접속점 없음'}에 연결, {kind_ko[n.type]} {n.p_kw:.0f} kW, 무효 {n.q_kvar or 0:.0f} kvar"
        for n in devices
    ]
    if device_rows:
        lines.append("## 부하·분산전원 (접속점별, 한 시점 고정값)")
        lines += _limit(device_rows, len(device_rows), "설비")
        lines.append("")

    # 지점별: 정전 → 전압 낮은 순 (문제가 큰 순으로 두어 길면 뒤를 자른다)
    rows = sorted((r for r in result.nodes if r.node_id in nodes), key=lambda r: (r.energized, r.voltage_pu))
    node_rows = []
    for r in rows:
        n = nodes[r.node_id]
        if not r.energized:
            node_rows.append(f"- {n.name}({n.type}): 정전")
            continue
        extra = f", 단락전류 {r.fault_current_ka:.2f} kA" if r.fault_current_ka is not None else ""
        power = f", 출력/소비 {n.p_kw:.0f} kW" if n.type in ("load", "pv", "wind") and n.p_kw is not None else ""
        node_rows.append(f"- {n.name}({n.type}): {r.voltage_pu:.3f} pu{extra}{power}")
    lines.append("## 지점별 (전압 낮은 순)")
    lines += _limit(node_rows, len(node_rows), "지점")
    lines.append("")

    # 선로별: 부하율 높은 순. 길이 0인 차단기·개폐기 연결(kind=switch)은 문제가 없으면 빼서 짧게 한다
    line_rows = []
    pairs = sorted(
        (line for line in graph.lines if line.id in line_res),
        key=lambda line: -(line_res[line.id].loading_pct or 0),
    )
    for line in pairs:
        r = line_res[line.id]
        if line.kind == "switch" and not r.reverse_flow:
            continue
        loading = f", 부하율 {r.loading_pct:.0f}%" if r.loading_pct is not None else ""
        flag = " [역조류]" if r.reverse_flow else ""
        line_rows.append(f"- {line.name}: {label(line.from_node_id)} → {label(line.to_node_id)}, {line.length_km:.2f} km, 유효 {r.p_kw:.0f} kW, 무효 {r.q_kvar:.0f} kvar{loading}{flag}")
    lines.append("## 선로별 (부하율 높은 순, 전원 쪽 → 말단 방향이 + 조류)")
    lines += _limit(line_rows, len(line_rows), "선로")
    lines.append("")

    lines.append("위 정보로 건강도 진단, 원인 분석, 솔루션 제안을 submit_report로 제출하세요.")
    return "\n".join(lines)


def _make_client():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ReportError("ANTHROPIC_API_KEY가 설정되지 않았습니다 (.env 확인 후 백엔드를 다시 시작하세요)")
    try:
        import anthropic
    except ImportError as e:
        raise ReportError("anthropic 라이브러리가 설치되지 않았습니다 (pip install -r requirements.txt)") from e
    return anthropic.Anthropic(timeout=TIMEOUT_SEC, max_retries=2)


def _parse(response, substation_id: str) -> Report:
    """tool use 응답에서 리포트를 꺼낸다. 형식이 맞지 않으면 ReportError"""
    if getattr(response, "stop_reason", None) == "max_tokens":
        raise ReportError("AI 응답이 길어서 중간에 잘렸습니다. 다시 시도해 주세요")
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == TOOL_NAME:
            data = block.input
            diagnosis = data.get("diagnosis")
            causes = data.get("causes")
            solutions = data.get("solutions")
            ok = isinstance(diagnosis, str) and diagnosis.strip() and isinstance(causes, list) and isinstance(solutions, list)
            if not ok or not all(isinstance(x, str) for x in causes + solutions):
                raise ReportError("AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요")
            return Report(substation_id=substation_id, diagnosis=diagnosis.strip(), causes=[c.strip() for c in causes if c.strip()], solutions=[s.strip() for s in solutions if s.strip()])
    raise ReportError("AI가 리포트를 돌려주지 않았습니다. 다시 시도해 주세요")


def generate_report(graph: SubstationGraph, result: SimulationResult, client=None) -> Report:
    """계통 정보(설비 이름·종류·연결)와 해석 수치(전압 pu, 선로 부하율, 고장전류, 역조류, 피더별 송출 전력)를
    구조화된 텍스트로 만들어 LLM에 넣고, 비전문가도 이해할 수 있는 3단계 리포트로 돌려받는다.

    client: 테스트용 (anthropic.Anthropic과 같은 messages.create를 가진 객체). 없으면 환경 변수로 만든다."""
    if not result.converged:
        raise ReportError("계산이 수렴하지 않은 결과로는 리포트를 만들 수 없습니다")
    prompt = build_prompt(graph, result)
    client = client or _make_client()
    try:
        response = client.messages.create(
            model=os.environ.get("ANTHROPIC_MODEL") or DEFAULT_MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            tools=[REPORT_TOOL],
            tool_choice={"type": "tool", "name": TOOL_NAME},
            messages=[{"role": "user", "content": prompt}],
        )
    except ReportError:
        raise
    except Exception as e:  # 네트워크·인증·한도 등 API 오류는 종류와 상관없이 같은 방식으로 알린다
        raise ReportError(f"AI 호출에 실패했습니다 ({type(e).__name__}: {e})") from e
    return _parse(response, result.substation_id)


def _sample() -> tuple[SubstationGraph, SimulationResult]:
    """자체 점검용 작은 계통: 말단 저전압, 과부하 선로, 태양광 역조류, 정전 구간이 모두 있다"""
    from cim.models import Feeder, Line, Node, Substation
    from simulation.models import FeederResult, LineResult, NodeResult

    s = "S1"

    def node(i, name, t, **kw):
        return Node(id=i, substation_id=s, feeder_id=None if t == "source" else "F1", name=name, type=t, x=0, y=0, **kw)

    def line(i, name, a, b, km, kind="line"):
        return Line(id=i, substation_id=s, feeder_id="F1", name=name, kind=kind, from_node_id=a, to_node_id=b, length_km=km, r_ohm_per_km=0.32, x_ohm_per_km=0.38)

    graph = SubstationGraph(
        substation=Substation(id=s, name="샘플 변전소"),
        feeders=[Feeder(id="F1", substation_id=s, name="샘플 피더 1")],
        nodes=[
            node("src", "전원 1", "source", bus_id="b0"),
            node("b0", "접속점 0", "bus"),
            node("cb", "차단기 1", "breaker"),
            node("b1", "접속점 1", "bus"),
            node("b2", "접속점 2", "bus"),
            node("sw", "개폐기 1", "switch", is_open=True),
            node("b3", "접속점 3", "bus"),
            node("ld", "부하 1", "load", bus_id="b1", p_kw=1800, q_kvar=500),
            node("pv", "태양광 1", "pv", bus_id="b2", p_kw=900, q_kvar=0),
            node("ld3", "부하 3", "load", bus_id="b2", p_kw=780, q_kvar=100),
            node("ld2", "부하 2", "load", bus_id="b3", p_kw=300, q_kvar=80),
        ],
        lines=[
            line("l0", "연결 0", "b0", "cb", 0, "switch"),
            line("l1", "선로 1", "cb", "b1", 4.0),
            line("l2", "선로 2", "b1", "b2", 9.0),
            line("l3", "선로 3", "b2", "sw", 0.0, "switch"),
            line("l4", "선로 4", "sw", "b3", 2.0),
        ],
    )
    result = SimulationResult(
        substation_id=s, converged=True, loss_kw=186.4,
        feeders=[FeederResult(feeder_id="F1", p_kw=1680, q_kvar=600)],
        nodes=[
            NodeResult(node_id="b0", voltage_pu=1.0, fault_current_ka=7.56),
            NodeResult(node_id="cb", voltage_pu=1.0, fault_current_ka=7.56),
            NodeResult(node_id="b1", voltage_pu=0.982, fault_current_ka=3.1),
            NodeResult(node_id="b2", voltage_pu=0.931, fault_current_ka=1.4),
            NodeResult(node_id="sw", voltage_pu=0.931, fault_current_ka=1.4),
            NodeResult(node_id="b3", voltage_pu=0.0, energized=False),
        ],
        lines=[
            LineResult(line_id="l0", p_kw=1680, q_kvar=600),
            LineResult(line_id="l1", p_kw=1680, q_kvar=600, loading_pct=112.0),
            LineResult(line_id="l2", p_kw=-120, q_kvar=-100, loading_pct=8.0, reverse_flow=True),
            LineResult(line_id="l3", p_kw=0, q_kvar=0),
            LineResult(line_id="l4", p_kw=0, q_kvar=0, loading_pct=0.0),
        ],
    )
    return graph, result


if __name__ == "__main__":
    import sys

    g, r = _sample()
    print(build_prompt(g, r))
    if "--call" in sys.argv:
        rep = generate_report(g, r)
        print("\n===== 리포트 =====")
        print(rep.diagnosis)
        print("\n[원인]", *rep.causes, sep="\n- ")
        print("\n[솔루션]", *rep.solutions, sep="\n- ")
