"""시뮬레이션 결과 형식. 단위: 전압 pu, 전력 kW·kvar, 부하율 %, 고장전류 kA

4대 시뮬레이션 (3단계): 전압 영향, 선로 과부하, 역조류, 단락용량 고장전류
"""

from pydantic import BaseModel


class NodeResult(BaseModel):
    node_id: str
    voltage_pu: float  # 전압 영향
    fault_current_ka: float | None = None  # 단락 고장전류


class LineResult(BaseModel):
    line_id: str
    p_kw: float  # from → to 방향이 +
    q_kvar: float
    loading_pct: float | None = None  # 선로 과부하 (허용전류 대비 %)
    reverse_flow: bool = False  # 역조류 (분산전원 때문에 평소와 반대 방향으로 흐름)


class SimulationResult(BaseModel):
    feeder_id: str
    converged: bool
    total_p_kw: float  # 변전소 출구 차단기(CB)에서의 피더 송출 전력 (화면에는 MW로 표시)
    total_q_kvar: float  # 화면에는 MVAr로 표시
    loss_kw: float
    nodes: list[NodeResult]
    lines: list[LineResult]
