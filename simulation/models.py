"""시뮬레이션 결과 형식. 단위: 전압 pu, 전력 kW·kvar(3상 합계), 부하율 %, 고장전류 kA

4대 시뮬레이션 (3단계): 전압 영향, 선로 과부하, 역조류, 단락용량 고장전류
해석 범위 (cim/models.py와 같음): 22.9kV, 3상 평형이라 상별 값 대신 한 값, 방사형, 한 시점 결과, 고장은 3상 단락만
"""

from pydantic import BaseModel

# 판정 기준 (단선도 오버레이 색상, AI 리포트 진단에 공통 사용)
VOLTAGE_MIN_PU = 0.95  # 전압 정상 범위 하한 (OpenDSS 기본 정상 범위)
VOLTAGE_MAX_PU = 1.05  # 전압 정상 범위 상한
OVERLOAD_PCT = 100.0  # loading_pct가 이 값을 넘으면 선로 과부하


class NodeResult(BaseModel):
    node_id: str
    voltage_pu: float  # 전압 영향
    fault_current_ka: float | None = None  # 이 지점 3상 단락 전류 (대칭 실효값). 단락용량이 없으면 None


class LineResult(BaseModel):
    line_id: str
    p_kw: float  # from → to 방향이 +
    q_kvar: float
    loading_pct: float | None = None  # 선로 과부하 (전류 / 허용전류 × 100). 허용전류가 없으면 None
    reverse_flow: bool = False  # 역조류 (p_kw < 0, 분산전원 때문에 to → from으로 흐름)


class FeederResult(BaseModel):
    """변전소 출구 차단기(CB)에서의 피더별 송출 전력. 화면에는 차단기 옆에 MW·MVAr로 황색 표시"""

    feeder_id: str
    p_kw: float
    q_kvar: float


class SimulationResult(BaseModel):
    substation_id: str
    converged: bool
    loss_kw: float
    feeders: list[FeederResult]
    nodes: list[NodeResult]
    lines: list[LineResult]
