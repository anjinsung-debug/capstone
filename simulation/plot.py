"""시뮬레이션 결과 그래프 (matplotlib)

위: 전압 프로파일. 가로축은 변전소에서 선로를 따라 잰 거리(km), 세로축은 전압(pu).
    선로마다 양 끝 전압을 선으로 잇고, 정상 범위(VOLTAGE_MIN_PU~VOLTAGE_MAX_PU) 밖이면 빨간 점
아래: 선로별 유효전력 조류(kW). 역조류는 주황, 과부하(OVERLOAD_PCT 초과)는 빨강, 막대 끝에 부하율(%)
"""

import io

import matplotlib

matplotlib.use("Agg")  # 화면 없이 서버에서 그림 파일만 만든다

import matplotlib.pyplot as plt
from matplotlib import font_manager

from cim.models import SubstationGraph
from simulation.dss import trace
from simulation.models import OVERLOAD_PCT, VOLTAGE_MAX_PU, VOLTAGE_MIN_PU, SimulationResult

# 한글 이름 표시용 글꼴 (Windows, macOS, Linux 순). 설치된 것만 넣어야 없는 글꼴 경고가 반복되지 않는다
_installed = {f.name for f in font_manager.fontManager.ttflist}
plt.rcParams["font.family"] = [f for f in ("Malgun Gothic", "AppleGothic", "NanumGothic") if f in _installed] + ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


def plot_result(graph: SubstationGraph, result: SimulationResult) -> bytes:
    """계통 정보와 시뮬레이션 결과로 matplotlib 그래프를 그려 PNG 바이트로 돌려준다."""
    dist = trace(graph).distance_km
    volt = {n.node_id: n.voltage_pu for n in result.nodes}
    names = {n.id: n.name for n in graph.nodes}
    flows = {r.line_id: r for r in result.lines}

    fig, (ax_v, ax_p) = plt.subplots(2, 1, figsize=(10, 9), height_ratios=[1, 1.2])

    for line in graph.lines:
        if line.from_node_id in dist and line.to_node_id in dist:
            ax_v.plot([dist[line.from_node_id], dist[line.to_node_id]],
                      [volt[line.from_node_id], volt[line.to_node_id]], color="tab:blue", lw=1.5)
    buses = [n for n in graph.nodes if n.id in dist]
    bad = [n for n in buses if not VOLTAGE_MIN_PU <= volt[n.id] <= VOLTAGE_MAX_PU]
    ax_v.scatter([dist[n.id] for n in buses], [volt[n.id] for n in buses], s=12, color="tab:blue", zorder=3)
    ax_v.scatter([dist[n.id] for n in bad], [volt[n.id] for n in bad], s=30, color="red", zorder=4, label="정상 범위 밖")
    for limit in (VOLTAGE_MIN_PU, VOLTAGE_MAX_PU):
        ax_v.axhline(limit, color="gray", ls="--", lw=1)
    ax_v.set(title="전압 프로파일", xlabel="변전소로부터 거리 (km)", ylabel="전압 (pu)")
    if bad:
        ax_v.legend(loc="lower left")
    ax_v.grid(alpha=0.3)

    lines = sorted((line for line in graph.lines if line.kind == "line"), key=lambda line: line.name)  # 길이 0인 차단기·개폐기 연결은 뺀다
    p = [flows[line.id].p_kw for line in lines]
    colors = ["red" if (flows[line.id].loading_pct or 0) > OVERLOAD_PCT
              else "tab:orange" if flows[line.id].reverse_flow else "tab:blue" for line in lines]
    y = range(len(lines))
    ax_p.barh(y, p, color=colors)
    ax_p.set_yticks(y, [line.name or f"{names[line.from_node_id]} → {names[line.to_node_id]}" for line in lines],
                    fontsize=8)
    ax_p.invert_yaxis()
    for i, line in enumerate(lines):
        if flows[line.id].loading_pct is not None:
            ax_p.annotate(f"{flows[line.id].loading_pct:.0f}%", (p[i], i), xytext=(3 if p[i] >= 0 else -3, 0),
                          textcoords="offset points", ha="left" if p[i] >= 0 else "right", va="center", fontsize=8)
    ax_p.axvline(0, color="gray", lw=1)
    ax_p.set(title="선로 유효전력 조류 (주황: 역조류, 빨강: 과부하)", xlabel="유효전력 (kW, 전원 → 말단 방향이 +)")
    ax_p.grid(axis="x", alpha=0.3)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120)
    plt.close(fig)
    return buf.getvalue()
