"""계통 → OpenDSS 스크립트 변환 (FR-03, 제안서 2단계 파서)

Neo4j에서 읽은 FeederGraph를 OpenDSS가 이해하는 명령어 목록으로 바꾼다.
변환만 하고 실행은 simulate.py가 맡으므로, OpenDSS 없이도 생성된 스크립트를 확인할 수 있다.

변환 대응 (초안, 회의에서 확정):
    source 노드 → New Circuit (변전소 전원)
    bus 노드    → OpenDSS 버스 이름
    load 노드   → New Load
    Line        → New Line
"""

from cim.models import FeederGraph


def to_dss_script(graph: FeederGraph) -> list[str]:
    """계통을 OpenDSS 명령어 목록으로 변환한다. 마지막 Solve는 simulate.py가 실행한다."""
    raise NotImplementedError
