"""시뮬레이션 결과 그래프 (matplotlib)"""

import matplotlib

matplotlib.use("Agg")  # 화면 없이 서버에서 그림 파일만 만든다

from cim.models import FeederGraph
from simulation.models import SimulationResult


def plot_result(graph: FeederGraph, result: SimulationResult) -> bytes:
    """계통 정보와 시뮬레이션 결과로 matplotlib 그래프를 그려 PNG 바이트로 돌려준다."""
    raise NotImplementedError
