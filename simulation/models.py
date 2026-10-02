"""시뮬레이션 결과 형식. 단위: 전압 pu, 전력 kW·kvar"""

from pydantic import BaseModel


class NodeResult(BaseModel):
    node_id: str
    voltage_pu: float


class LineResult(BaseModel):
    line_id: str
    p_kw: float
    q_kvar: float


class SimulationResult(BaseModel):
    feeder_id: str
    converged: bool
    total_p_kw: float
    total_q_kvar: float
    loss_kw: float
    nodes: list[NodeResult]
    lines: list[LineResult]
