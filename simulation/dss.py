"""계통 → OpenDSS 스크립트 변환 (FR-03, 제안서 2단계 파서)

Neo4j에서 읽은 SubstationGraph를 OpenDSS가 이해하는 명령어 목록으로 바꾼다.
변환만 하고 실행은 simulate.py가 맡으므로, OpenDSS 없이도 생성된 스크립트를 확인할 수 있다.

해석 범위 (cim/models.py와 같음): 22.9kV, 3상 평형, 방사형, 한 시점, 3상 단락만. 모든 요소는 phases=3.

변환 대응:
    source 노드      → New Circuit (basekv=BASE_KV, pu=source_voltage_pu, MVAsc3=short_circuit_mva, X1R1=x_r_ratio)
    breaker·bus 노드 → OpenDSS 버스 (차단기는 투입 상태로 보고, 피더별 송출 전력 측정 위치로 씀)
    switch 노드      → OpenDSS 버스. is_open=True면 이 노드에 닿은 Line을 enabled=no로 끊음 (끊긴 쪽 노드는 전압 0)
    load 노드        → New Load (kW=p_kw, kvar=q_kvar, 한 시점 고정값)
    pv·wind 노드     → New Generator (kW=p_kw, kvar=q_kvar, 한 시점 고정 출력)
    Line kind=line   → New Line (R1=r_ohm_per_km, X1=x_ohm_per_km, length=length_km, units=km, 정전용량 0)
    Line kind=switch → New Line switch=yes (차단기·개폐기 연결)
"""

from cim.models import SubstationGraph


def to_dss_script(graph: SubstationGraph) -> list[str]:
    """계통을 OpenDSS 명령어 목록으로 변환한다. 마지막 Solve는 simulate.py가 실행한다."""
    raise NotImplementedError
