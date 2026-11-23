"""계절별 위험도 (11/23, 최민준): 1년치(365일 × 24시간) 배율로 계통을 계산해 봄·여름·가을·겨울로 나눠 위험도를 센다.

AI 리포트 창 "계절별 위험도" 탭 (frontend/src/components/UsecasePanels.jsx의 SeasonalBox). AI는 부르지 않는다 (숫자·등급만)
- 배율: data/profile_2025.csv (simulation/daily.py의 read_year, 가상 패턴). 시간마다 scaled_graph로 부하·태양광에 곱한다
- 계산: 시간마다 simulation/simulate.py의 simulate() (한 시점 계산·하루 계산과 같은 길)
- 판정: 시간마다 ai_report/report.py의 check_findings (화면 진단표와 같은 등급 규칙)
- 계절: 봄 3~5월, 여름 6~8월, 가을 9~11월, 겨울 12·1·2월 (2025년 1·2월과 12월을 합친다)
- 계절 등급: 그 계절에 한 시간이라도 위험이 있으면 위험, 주의가 있으면 주의, 아니면 정상 (등급별 시간 수도 같이 준다)

8,760번 계산이라 오래 걸린다 (OpenDSS로 수 분 이상). 그래서
- 백그라운드 스레드에서 돌리고 화면은 진행률(끝난 날 수)을 받아 간다 (POST로 시작, GET으로 진행 확인)
- 결과를 계통 내용(해시)별로 메모리와 디스크(data/seasonal_cache/, 깃 제외)에 남긴다. 계통이 같으면 다시 계산하지 않는다
ponytail: 스레드 하나로 순서대로 계산한다. 더 빨라야 하면 프로세스 여러 개로 날짜를 나눠 돌린다 (OpenDSS는 프로세스마다 하나)
"""

import datetime as dt
import hashlib
import json
import math
import threading
from collections.abc import Callable
from pathlib import Path

from ai_report.report import GRADES, check_findings
from cim.models import BASE_KV, SubstationGraph
from simulation.daily import PROFILE_NOTE, WEEKDAY_KO, read_year, scaled_graph
from simulation.models import SimulationResult

CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "seasonal_cache"
CACHE_VERSION = 1  # 계산·집계 방식을 바꾸면 올린다 (예전 캐시를 안 쓰게)
SEASONS = (("봄", (3, 4, 5)), ("여름", (6, 7, 8)), ("가을", (9, 10, 11)), ("겨울", (12, 1, 2)))
SEASON_OF = {m: name for name, months in SEASONS for m in months}
WORST_DAYS = 3  # 계절마다 보여 줄 가장 나쁜 날 수


def graph_key(graph: SubstationGraph, engine: str = "opendss") -> str:
    """계통 내용 해시 (이름·좌표까지 포함). 같은 계통이면 같은 키.
    engine: 계산 방법 이름 (모의 백엔드는 "mock"). 근사 계산 결과가 진짜 결과 캐시와 섞이지 않게 키에 넣는다"""
    raw = f"{CACHE_VERSION}:{engine}:{graph.model_dump_json()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20]


def _at(day: dt.date, hour: int) -> dict:
    return {"date": day.isoformat(), "hour": hour}


def _empty(name: str, months: tuple[int, ...]) -> dict:
    return {
        "season": name,
        "months": list(months),
        "days": 0,
        "hours": 0,
        "failed_hours": 0,  # 계산이 안 된 시간 (수렴 실패 등). 등급에 넣지 않는다
        "grade": GRADES[0],
        "grade_hours": {g: 0 for g in GRADES},
        # 항목별 기준을 넘은 시간 수
        "overload_hours": 0,  # 선로 부하율 100% 초과
        "watch_hours": 0,  # 선로 부하율 80~100%
        "low_v_hours": 0,  # 전압 0.95 pu 미만
        "high_v_hours": 0,  # 전압 1.05 pu 초과
        "outage_hours": 0,
        "reverse_bad_hours": 0,  # 비정상 역조류 (위험)
        "reverse_ok_hours": 0,  # 정상 역조류 (등급에 영향 없음, 참고)
        "fault_hours": 0,  # 단락용량 300 MVA 초과
        # 가장 나쁜 값과 그때·그곳
        "min_v": None,  # {value, where, date, hour}
        "max_v": None,
        "max_loading": None,  # {value, where, line_id, date, hour}
        "max_reverse_kw": None,  # {value, where, line_id, date, hour}
        "max_fault_mva": None,  # {value, where, date, hour}
        "worst_days": [],  # [{date, weekday, grade, danger_hours, caution_hours, max_loading_pct}]
    }


def _better(cur: dict | None, value: float, bigger: bool) -> bool:
    return cur is None or (value > cur["value"] if bigger else value < cur["value"])


def _add_hour(s: dict, graph: SubstationGraph, day: dt.date, hour: int, result: SimulationResult, f: dict, names: dict, line_names: dict) -> None:
    s["hours"] += 1
    s["grade_hours"][f["grade"]] += 1
    s["overload_hours"] += bool(f["overload"])
    s["watch_hours"] += bool(f["watch"])
    s["low_v_hours"] += bool(f["low"])
    s["high_v_hours"] += bool(f["high"])
    s["outage_hours"] += bool(f["outage"])
    s["reverse_bad_hours"] += bool(f["reverse_bad"])
    s["reverse_ok_hours"] += bool(f["reverse_ok"])
    s["fault_hours"] += bool(f["fault"])
    buses = {n.id for n in graph.nodes if n.bus_id is None}  # check_findings와 같이 접속점만
    for r in result.nodes:
        if r.node_id not in buses or not r.energized:
            continue
        where = names.get(r.node_id, r.node_id)
        if _better(s["min_v"], r.voltage_pu, False):
            s["min_v"] = {"value": r.voltage_pu, "where": where, **_at(day, hour)}
        if _better(s["max_v"], r.voltage_pu, True):
            s["max_v"] = {"value": r.voltage_pu, "where": where, **_at(day, hour)}
        if r.fault_current_ka is not None:
            mva = math.sqrt(3) * BASE_KV * r.fault_current_ka
            if _better(s["max_fault_mva"], mva, True):
                s["max_fault_mva"] = {"value": mva, "where": where, **_at(day, hour)}
    for r in result.lines:
        where = line_names.get(r.line_id, r.line_id)
        if r.loading_pct is not None and _better(s["max_loading"], r.loading_pct, True):
            s["max_loading"] = {"value": r.loading_pct, "where": where, "line_id": r.line_id, **_at(day, hour)}
        if r.reverse_flow and _better(s["max_reverse_kw"], abs(r.p_kw), True):
            s["max_reverse_kw"] = {"value": abs(r.p_kw), "where": where, "line_id": r.line_id, **_at(day, hour)}


def _finish(s: dict, day_grades: dict[dt.date, list[tuple[str, float]]]) -> None:
    """계절 등급과 가장 나쁜 날 (위험 시간 → 주의 시간 → 그날 최대 부하율 순)"""
    gh = s["grade_hours"]
    s["grade"] = GRADES[2] if gh[GRADES[2]] else GRADES[1] if gh[GRADES[1]] else GRADES[0]
    days = [
        {
            "date": d.isoformat(),
            "weekday": WEEKDAY_KO[d.weekday()],
            "danger_hours": sum(gr == GRADES[2] for gr, _ in g),
            "caution_hours": sum(gr == GRADES[1] for gr, _ in g),
            "max_loading_pct": max((pct for _, pct in g), default=0.0),
        }
        for d, g in day_grades.items()
    ]
    days = [d for d in days if d["danger_hours"] or d["caution_hours"]]
    days.sort(key=lambda d: (-d["danger_hours"], -d["caution_hours"], -d["max_loading_pct"], d["date"]))
    for d in days:
        d["grade"] = GRADES[2] if d["danger_hours"] else GRADES[1]
    s["worst_days"] = days[:WORST_DAYS]


def seasonal_risk(
    graph: SubstationGraph,
    simulate_fn: Callable[[SubstationGraph], SimulationResult] | None = None,
    on_day: Callable[[int, int], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> dict:
    """1년(365일 × 24시간)을 계산해 계절별로 센다. on_day(끝난 날 수, 전체 날 수)로 진행률을 알린다.
    한 시각 계산이 실패하면(예외) 그 시간은 failed_hours로만 세고 계속한다"""
    if simulate_fn is None:
        from simulation.simulate import simulate as simulate_fn  # OpenDSS는 실제로 계산할 때만 불러온다
    names = {n.id: n.name for n in graph.nodes}
    line_names = {line.id: line.name for line in graph.lines}
    year = read_year()
    seasons = {name: _empty(name, months) for name, months in SEASONS}
    day_grades: dict[str, dict[dt.date, list[tuple[str, float]]]] = {name: {} for name, _ in SEASONS}
    for i, (day, hours) in enumerate(sorted(year.items()), 1):
        if should_stop and should_stop():
            raise InterruptedError("계산을 멈췄습니다")
        name = SEASON_OF[day.month]
        s = seasons[name]
        s["days"] += 1
        grades = day_grades[name].setdefault(day, [])
        for hour, load, pv in hours:
            g = scaled_graph(graph, load, pv)
            try:
                result = simulate_fn(g)
            except Exception:  # noqa: BLE001 수렴 실패 등 한 시각이 안 돼도 1년 계산은 계속한다
                s["failed_hours"] += 1
                continue
            f = check_findings(g, result)
            grades.append((f["grade"], max((r.loading_pct for r in result.lines if r.loading_pct is not None), default=0.0)))
            _add_hour(s, g, day, hour, result, f, names, line_names)
        if on_day:
            on_day(i, len(year))
    for name, _ in SEASONS:
        _finish(seasons[name], day_grades[name])
    return {
        "substation_id": graph.substation.id,
        "note": PROFILE_NOTE,
        "computed_at": dt.datetime.now().isoformat(timespec="seconds"),
        "seasons": [seasons[name] for name, _ in SEASONS],
    }


# ── 백그라운드 작업 ──────────────────────────────────────────────
# 계통 키마다 작업 하나. {"state": "running"|"done"|"error", "done": 끝난 날, "total": 전체 날, "result": ..., "error": ...}
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def _load_cache(key: str) -> dict | None:
    try:
        return json.loads(_cache_path(key).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _save_cache(key: str, result: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(key).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass  # 캐시는 있으면 좋은 것. 못 써도 결과는 메모리에 있다


def status(graph: SubstationGraph, engine: str = "opendss") -> dict:
    """이 계통의 계산 상태. 계산한 적 없으면 state=idle (디스크 캐시가 있으면 done)"""
    key = graph_key(graph, engine)
    with _jobs_lock:
        job = _jobs.get(key)
        if job is None:
            cached = _load_cache(key)
            if cached is None:
                return {"state": "idle", "done": 0, "total": len(read_year())}
            job = _jobs[key] = {"state": "done", "done": len(read_year()), "total": len(read_year()), "result": cached}
        return dict(job)


def start(graph: SubstationGraph, simulate_fn: Callable[[SubstationGraph], SimulationResult] | None = None, again: bool = False,
          engine: str = "opendss") -> dict:
    """계산을 시작한다 (이미 하는 중이거나 끝났으면 그대로 둔다. again=True면 끝난 것도 다시 계산).
    simulate_fn을 바꾸면(모의 백엔드) engine도 다른 이름으로 준다"""
    key = graph_key(graph, engine)
    cur = status(graph, engine)
    if cur["state"] == "running" or (cur["state"] == "done" and not again):
        return cur
    total = len(read_year())
    job = {"state": "running", "done": 0, "total": total}
    with _jobs_lock:
        _jobs[key] = job

    def progress(done: int, _total: int) -> None:
        job["done"] = done

    def run() -> None:
        try:
            result = seasonal_risk(graph, simulate_fn, on_day=progress)
        except Exception as e:  # noqa: BLE001 화면에 이유를 보여 준다
            job.update(state="error", error=str(e) or e.__class__.__name__)
            return
        _save_cache(key, result)
        job.update(state="done", done=total, result=result)

    threading.Thread(target=run, name=f"seasonal-{graph.substation.id}", daemon=True).start()
    return dict(job)


if __name__ == "__main__":  # 자체 점검: 가짜 계산으로 집계가 맞는지 (python -m ai_report.seasonal)
    from ai_report.report import _sample

    g, base = _sample()
    peak = sum(n.p_kw for n in g.nodes if n.type == "load")

    def fake(gg: SubstationGraph) -> SimulationResult:
        """부하가 무거울수록 부하율·전압강하가 커지는 가짜 결과 (_sample 결과를 배율만큼 늘림)"""
        k = sum(n.p_kw for n in gg.nodes if n.type == "load") / peak
        lines = [r.model_copy(update={"loading_pct": None if r.loading_pct is None else r.loading_pct * k}) for r in base.lines]
        nodes = [r.model_copy(update={"voltage_pu": 1 - (1 - r.voltage_pu) * k}) for r in base.nodes]
        return base.model_copy(update={"lines": lines, "nodes": nodes})

    out = seasonal_risk(g, fake)
    year = read_year()
    assert sum(s["hours"] + s["failed_hours"] for s in out["seasons"]) == sum(len(h) for h in year.values())
    assert sum(s["days"] for s in out["seasons"]) == len(year) == 365
    for s in out["seasons"]:
        assert sum(s["grade_hours"].values()) == s["hours"]
        assert all(int(d[5:7]) in s["months"] for d in [w["date"] for w in s["worst_days"]])
        ml = s["max_loading"]
        print(s["season"], s["days"], "일", s["grade"], s["grade_hours"], "최대 부하율", f"{ml['value']:.0f}%", ml["where"], ml["date"], ml["hour"], "시",
              "최저 전압", f"{s['min_v']['value']:.3f}", s["worst_days"][:1])
    print("ok")
