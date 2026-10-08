"""계통 위상 계산 (적재 load.py와 편집 저장 graph.save_substation이 같이 쓴다)

- 선로 방향 정리: from = 전원 쪽, to = 말단 쪽 (역조류 판정 기준)
- 피더 소속: 변전소 출구 차단기(breaker)마다 피더 하나, 그 아래로 열린 개폐기를 지나지 않고 닿는 노드·선로에 feeder_id
"""

import uuid
from collections import defaultdict, deque

from cim.models import Feeder

# 원본에 없는 객체(피더, 개폐기 연결선)의 id. 입력에서 결정적으로 만들어서 다시 계산해도 같은 id가 나온다
_ID_NS = uuid.UUID("6f1c2a4e-5b7d-4e8a-9c3f-2d1e0b9a8c7d")


def derived_id(*parts: str) -> str:
    return str(uuid.uuid5(_ID_NS, ":".join(parts)))


def feeder_id_of(breaker_id: str) -> str:
    """차단기 id → 피더 id. 같은 차단기면 언제 계산해도 같은 피더 id."""
    return derived_id(breaker_id, "feeder")


def trace_feeders(source: dict, nodes: dict[str, dict], lines: dict[str, dict],
                  sub_id: str) -> tuple[list[Feeder], list[str]]:
    """전원에서 너비 우선 탐색으로 선로 방향과 피더 소속을 정한다.

    nodes, lines는 id → 필드 dict이며 이 함수가 직접 고친다 (선로 from/to, feeder_id; 노드 feeder_id).
    돌려주는 값: (피더 목록, 경고 문장 목록)
    """
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
                fid = feeder_id_of(nxt)
                feeders.append(Feeder(id=fid, substation_id=sub_id, name=nodes[nxt]["name"]))
            feeder_of[nxt] = fid
            l["feeder_id"] = fid
            queue.append(nxt)

    for l in lines.values():  # 닿지 않은 선로(열린 개폐기 너머 등)는 피더 없음
        if l["id"] not in used:
            l["feeder_id"] = None
    for n in nodes.values():
        n["feeder_id"] = feeder_of.get(n.get("bus_id") or n["id"])

    warnings = []
    if loops:
        warnings.append(f"루프 선로 {loops}개: 방사형이 아닙니다 (열린 개폐기 확인)")
    unreached = [n["name"] for n in nodes.values() if (n.get("bus_id") or n["id"]) not in feeder_of]
    if unreached:
        warnings.append(f"전원에서 닿지 않는 노드 {len(unreached)}개: {', '.join(unreached[:10])}")
    return feeders, warnings
