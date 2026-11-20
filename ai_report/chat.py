"""AI 챗봇: 화면 오른쪽 아래 "질문하기"에서 지금 계통·계산 결과·플랫폼 기능을 LLM에 물어보고 답을 받는다 (11/20). 담당: 최민준

- 리포트(report.py)와 같은 AI 설정을 쓴다: .env의 AI_PROVIDER(gemini/anthropic), 키, 모델, AI_TIMEOUT_SEC
- 리포트와 다른 점: JSON 형식을 강제하지 않고 자유 글로 답한다. 대화(앞 질문·답)를 같이 보내 이어서 묻을 수 있다
- 모델에 주는 자료 (모두 시스템 지시에 넣는다)
    1) 플랫폼 기능 안내(APP_GUIDE): 어느 화면에서 무엇을 할 수 있는지. 화면이 바뀌면 이 글도 같이 고친다
    2) 내 변전소 전체 목록: 개수, 변전소마다 구성과 같은 시각 계산 판정 (substations_section, 11/20)
    3) 지금 고른 변전소의 구성 요약 (이름, 배전선로, 설비 개수)
    4) 지금 화면의 계산 결과: report.build_prompt와 같은 표 (코드가 판정한 "확정된 점검 결과" 포함)
    5) 오늘(계산 날짜) 24시간 결과: report.daily_summary와 같은 표·위험 시간대 (daily_section, 같은 계통·날짜는 다시 계산하지 않음)
    6) 화면에서 이미 계산한 결과: 여유 용량 표, 설비 보강 우선순위 (extra_sections. 없으면 "아직 계산 안 함")
- 숫자·판정은 자료에 있는 것만 쓰게 하고, 자료에 없는 것은 모른다고 답하게 한다 (지어내지 않기)

ponytail: 답을 한 번에 받는다(스트리밍 아님). 답이 길어 기다림이 길면 Gemini streamGenerateContent로 바꾼다.
  대화는 화면에서 최근 MAX_TURNS개만 보낸다. 변전소가 커서 입력이 길면 report.MAX_ROWS가 표 길이를 자른다
"""

import datetime as dt
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from typing import Literal

from pydantic import BaseModel, Field

from ai_report.report import (
    DEFAULT_MODEL,
    FAULT_HIGH_MVA,
    GEMINI_DEFAULT_MODEL,
    GEMINI_URL,
    LOADING_WATCH_PCT,
    VOLTAGE_DANGER_HIGH_PU,
    VOLTAGE_DANGER_LOW_PU,
    ReportError,
    _make_client,
    _timeout,
    build_capacity_prompt,
    build_prompt,
    check_findings,
    daily_summary,
)
from cim.models import SubstationGraph
from simulation.dss import DEFAULT_BREAKER_INTERRUPT_KA, DEFAULT_SHORT_CIRCUIT_MVA
from simulation.models import OVERLOAD_PCT, VOLTAGE_MAX_PU, VOLTAGE_MIN_PU, SimulationResult

MAX_TURNS = 12  # 모델에 보내는 최근 대화 수 (질문+답 합쳐서)
MAX_CHARS = 2000  # 질문 한 개의 최대 글자 수
CHAT_MAX_TOKENS = 1500
RETRY_CODES = (429, 500, 503)  # 잠깐 뒤 다시 시도하면 풀리는 오류 (한도 초과, 서버 일시 오류)

APP_GUIDE = f"""[플랫폼 기능 안내: 배전계통 통합 분석 플랫폼]
- 첫 화면 "변전소 전체": DB에 있는 변전소를 단선도로 보여 준다 (154 kV 송전선 → 주변압기 → 22.9 kV 모선 → 배전선로·출구 차단기). 변전소를 누르면 그 변전소 편집 화면으로 들어간다. 맨 끝 "+ 새 변전소"로 새로 만든다.
- 위쪽 줄: 제목 "배전계통 통합 분석 플랫폼"을 누르면 첫 화면으로 간다. "AI 리포트" 버튼, 변전소 선택 목록(펼치면 변전소마다 ✕ = 완전 삭제, 한 번 더 확인하고 되돌릴 수 없음, 맨 아래 "+ 새 변전소"), 저장 상태(편집하면 자동 저장, 실패하면 "저장 실패"를 눌러 다시 저장).
- 왼쪽 위 "편집" 메뉴: 변전소 이름 바꾸기, CIM 내보내기(CIM16 XML 파일 내려받기), 설비 추가(변전소 전원·출구 차단기·개폐기·접속점·부하·태양광·풍력을 끌어다 놓기), 선로 그리기(노드 두 개를 차례로 누름. 부하·태양광·풍력·전원은 접속점에 붙음), 되돌리기(Ctrl+Z), 삭제(Delete 키).
- 단선도 위 결과 보기: 건강도 · ① 전압 · ② 과부하 · ③ 역조류 · ④ 단락용량 색 보기, "3D 보기"(왼쪽 드래그 이동, 오른쪽 드래그 회전, 휠 확대, 방향키 이동, "처음 시점으로").
- 요약 줄: "지금 N시"(오늘 이 시각의 부하·태양광 배율로 계산, 정각마다 다시 계산), 전체 판정, 가장 나쁜 전압, 최대 부하율, 역조류, 단락용량, 정전 수, 총 송출 전력.
- 오른쪽 속성 칸: 고른 설비·선로의 값 보기·고치기(선로 길이·저항·리액턴스·허용전류, 부하·발전 kW 등), 설비 3D 미리보기. 접속점을 고르면 "연계·증설 검토"(태양광 | 부하 전환): 원하는 kW를 붙일 수 있는지, 최대 몇 kW까지 되는지, 무엇이 막는지, "붙여 보기", 태양광은 "AI 추천".
- "결과 자세히" 창: ① 건강도 진단(전압·과부하·역조류·단락용량·정전·고장 계산), ② 원인 분석, ③ 솔루션 제안, 요소별 결과(모든 설비·선로 값 표), 시간대별 시뮬레이션(날짜를 골라 24시간 곡선, 기록 값 표에서 두 시각 비교, AI 하루 운영 권고).
- "AI 리포트" 창: AI 리포트(진단·원인·솔루션, 쉬운 설명), 여유 용량(접속점마다 태양광·부하를 더 붙일 수 있는 kW, AI 설명), 설비 보강 우선순위(여러 날짜의 24시간 결과로 선로 증강 순위, AI 정리).
- 오른쪽 아래 "질문하기": 지금 이 챗봇. 내 변전소 전체(개수·상태), 지금 화면 결과, 그날 24시간 결과, 화면에서 이미 계산한 여유 용량·보강 우선순위를 근거로 답한다. 코드 구현, 앱 밖 자료, AI 리포트 내용은 다루지 않는다.
[판정 기준과 가정값]
- 전압: {VOLTAGE_MIN_PU}~{VOLTAGE_MAX_PU} pu 정상, {VOLTAGE_DANGER_LOW_PU} 미만·{VOLTAGE_DANGER_HIGH_PU} 초과는 위험. 부하율: {LOADING_WATCH_PCT}% 이상 주의, {OVERLOAD_PCT:.0f}% 초과 과부하.
- 역조류(태양광 전기가 변전소 쪽으로 거꾸로 흐름) 자체는 문제가 아니다. 선로 용량 안이고 차단기가 차단할 수 있으면 정상.
- 단락용량 {FAULT_HIGH_MVA} MVA 초과는 주의. 데이터가 없으면 변전소 단락용량을 {DEFAULT_SHORT_CIRCUIT_MVA:.0f} MVA로, 출구 차단기 차단용량을 {DEFAULT_BREAKER_INTERRUPT_KA:.0f} kA로 가정한다.
- 부하·태양광은 2025년 가상 패턴의 시간대별 배율을 곱한다 (계통의 태양광 값 = 설비용량). 풍력은 배율 없이 고정.
- 계산은 OpenDSS(조류 계산·고장 계산), 데이터는 CIM(한전 배전 데이터 형식) → Neo4j 저장. AI는 계산된 숫자를 설명만 하고 숫자·판정은 코드가 정한다."""

_SYSTEM = """당신은 "배전계통 통합 분석 플랫폼" 안의 도우미 챗봇입니다. 사용자는 한전 배전 담당자나 이 플랫폼을 만든 팀원입니다.
아래 [플랫폼 기능 안내], [지금 화면 자료], [내 변전소 전체], 24시간 결과, 이미 계산한 여유 용량·보강 우선순위만 근거로 한국어로 답하세요.
- 숫자·판정·설비 이름은 자료에 있는 것만 그대로 쓰세요. 새로 계산하거나 반올림을 바꾸지 마세요. 자료에 없으면 "지금 자료로는 알 수 없어요"라고 하고, 어느 화면에서 확인할 수 있는지 알려 주세요.
- 기능 질문에는 어느 화면의 어떤 버튼을 누르면 되는지 순서대로 짧게 답하세요. 안내에 없는 기능은 없다고 답하세요(지어내지 마세요).
- 이 플랫폼과 위 자료에 관한 질문에만 답하세요. 자료와 상관없는 일반 지식·앱 밖 질문(실제 한전 규정, 뉴스 등)에는 "이 챗봇은 플랫폼 자료에 대해서만 답할 수 있어요"라고 짧게 답하세요. 화면에 나오는 용어(역조류, 부하율 등)의 뜻은 판정 기준 안내 범위에서 설명해도 됩니다.
- 아직 계산하지 않은 결과(여유 용량, 보강 우선순위 등)를 물으면 어디서 계산하는지 알려 주세요.
- 계산으로 확인하지 않은 조치는 효과를 약속하지 말고 "검토"라고 쓰세요. 역조류 자체는 문제가 아닙니다.
- 짧고 쉽게: 보통 3~6문장. 목록이 도움이 되면 "- "로 시작하는 짧은 줄을 쓰세요. 마크다운 표·제목(#)은 쓰지 마세요.
- 용어 뒤에 괄호로 뜻을 덧붙이지 마세요. 사용자가 뜻을 물을 때만 설명하세요."""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_CHARS * 4)


class ChatReply(BaseModel):
    reply: str


MAX_SUBSTATIONS = 20  # 변전소 목록에서 같은 시각 계산까지 하는 최대 개수 (나머지는 이름만)


def substations_section(entries: list[tuple], current_id: str | None, at: str | None) -> list[str]:
    """내 변전소 전체. entries: (Substation, 계통 또는 None, 결과 또는 None, 계산 못 한 이유 또는 None)"""
    lines = [f"[내 변전소 전체: {len(entries)}곳]" + (f" (판정은 모두 {at} 기준으로 코드가 계산)" if at else "")]
    for sub, g, r, why in entries:
        mark = " ← 지금 보는 변전소" if sub.id == current_id else ""
        if g is None:
            lines.append(f"- {sub.name}{mark}: {why or '구성 정보 없음'}")
            continue
        count = lambda t: sum(1 for n in g.nodes if n.type == t)  # noqa: E731
        parts = [f"배전선로 {len(g.feeders)}개, 부하 {count('load')}, 태양광 {count('pv')}, 풍력 {count('wind')}, 선로 {len(g.lines)}개"]
        if r is not None:
            f = check_findings(g, r)
            volts = [x.voltage_pu for x in r.nodes if x.energized]
            loads = [x.loading_pct for x in r.lines if x.loading_pct is not None]
            parts.append(f"판정 {f['grade']}, 최저 전압 {min(volts, default=0):.3f} pu, 최대 부하율 {max(loads, default=0):.0f}%, "
                         f"정전 {len(f['outage'])}곳, 과부하 {len(f['overload'])}개, 비정상 역조류 {len(f['reverse_bad'])}개")
        elif why:
            parts.append(f"계산 불가: {why}")
        lines.append(f"- {sub.name}{mark}: " + "; ".join(parts))
    return lines


_daily_cache: dict[str, list[str]] = {}  # (변전소, 날짜, 계통 내용) → 24시간 요약 줄. 같은 질문마다 24번 다시 계산하지 않게


def daily_section(graph: SubstationGraph, day: dt.date, simulate_fn) -> list[str]:
    """그날 24시간 결과 요약 (graph는 배율을 곱하기 전 DB 계통). 계산이 안 되면 이유 한 줄"""
    from simulation.daily import simulate_daily

    key = hashlib.sha1(f"{day}|{graph.model_dump_json()}".encode("utf-8")).hexdigest()
    if key not in _daily_cache:
        try:
            daily = simulate_daily(graph, day, simulate_fn=simulate_fn)
            body = daily_summary(graph, daily)
            _daily_cache.clear()  # 지금 보는 계통·날짜 하나만 기억
            _daily_cache[key] = [f"[{daily.profile.name} 24시간 결과 (지금 계통, 시각마다 배율을 곱해 코드가 계산)]", *body[1:]]
        except Exception as e:  # 날짜 범위 밖, 계통 미완성 등. 챗봇은 계속 답한다
            return [f"[{day} 24시간 결과] 계산할 수 없음: {e}"]
    return _daily_cache[key]


def extra_sections(graph: SubstationGraph, extras: dict | None) -> list[str]:
    """화면에서 이미 계산한 결과(여유 용량·보강 우선순위). 화면이 보낸 것만 쓴다 (AI 리포트는 창에 이미 보여서 안 보냄, 11/20)"""
    extras = extras or {}
    out: list[str] = []
    cap = extras.get("capacity")
    if cap and cap.get("table"):
        from ai_report.capacity import CapacityTable

        text = build_capacity_prompt(graph, CapacityTable.model_validate(cap["table"]), cap.get("at") or "시각 모름")
        body = [ln for ln in text.splitlines()[1:] if not ln.startswith("위 정보로")]
        out += [f"[여유 용량 표 ({cap.get('at') or '시각 모름'} 기준{', 계산한 뒤 시각이 바뀜' if cap.get('stale') else ''})]", *body]
    else:
        out.append("[여유 용량] 아직 계산하지 않음 (AI 리포트 창 → 여유 용량 → 계산)")
    rf = extras.get("reinforce")
    if rf and rf.get("ranking"):
        out.append(f"[설비 보강 우선순위 (고른 날: {', '.join(rf.get('dates') or []) or '모름'}, 코드가 계산한 순위)]")
        for i, x in enumerate(rf["ranking"], 1):
            rated = f"{x['rated_current_a']:.0f} A" if x.get("rated_current_a") else "가정값 400 A"
            out.append(f"{i}. {x['name']}: 최대 부하율 {x['max_loading_pct']:.0f}% ({x['worst_date']} {x['worst_hour']}시), "
                       f"100% 초과 {x['hours_over']}시간, 80% 이상 {x['hours_watch']}시간, 지금 허용전류 {rated} → 필요 {x['required_rated_current_a']:.0f} A 이상")
    else:
        out.append("[설비 보강 우선순위] 아직 계산하지 않음 (AI 리포트 창 → 보강 우선순위 → 계산)")
    return out


def context_text(graph: SubstationGraph | None, result: SimulationResult | None, at: str | None = None, more: list[str] | None = None) -> str:
    """모델에 줄 [지금 화면 자료]. 변전소를 안 골랐으면 그렇다고 적는다"""
    if graph is None:
        return "\n".join(["[지금 화면 자료]", "변전소를 아직 고르지 않았습니다 (첫 화면).", *([""] + more if more else [])])
    count = lambda t: sum(1 for n in graph.nodes if n.type == t)  # noqa: E731
    lines = [
        "[지금 화면 자료]",
        f"변전소: {graph.substation.name}",
        f"배전선로(피더) {len(graph.feeders)}개: {', '.join(f.name for f in graph.feeders) or '없음'}",
        f"설비: 접속점 {count('bus')} · 부하 {count('load')} · 태양광 {count('pv')} · 풍력 {count('wind')} · 차단기 {count('breaker')} · 개폐기 {count('switch')} · 전원 {count('source')}, 선로 {len(graph.lines)}개",
    ]
    if result is None:
        lines.append("계산 결과: 없음 (계통이 완성되지 않았거나 아직 계산 전). 왼쪽 위 요약 줄이나 속성 칸의 '시뮬레이션 전 확인'에서 이유를 볼 수 있습니다.")
    elif not result.converged:
        lines.append("계산 결과: 계산이 수렴하지 않았습니다.")
    else:
        lines.append(f"계산 기준 시각: {at}" if at else "계산 기준 시각: 알 수 없음")
        lines.append(build_prompt(graph, result))
    return "\n".join(lines + ([""] + more if more else []))


def _post_json(url: str, headers: dict, body: bytes) -> dict:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=_timeout()) as res:
        return json.loads(res.read().decode("utf-8"))


def _gemini(system: str, messages: list[ChatMessage], post=None) -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise ReportError("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인 후 백엔드를 다시 시작하세요)")
    model = os.environ.get("GEMINI_MODEL") or GEMINI_DEFAULT_MODEL
    body = json.dumps(
        {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "model" if m.role == "assistant" else "user", "parts": [{"text": m.content}]} for m in messages],
            "generationConfig": {"maxOutputTokens": CHAT_MAX_TOKENS},
        }
    ).encode("utf-8")
    headers = {"Content-Type": "application/json", "x-goog-api-key": key}
    url = GEMINI_URL.format(model=model)
    for attempt in range(2):  # 한도 초과(429)·일시 오류는 한 번 더 시도
        try:
            data = (post or _post_json)(url, headers, body)
            break
        except urllib.error.HTTPError as e:
            if e.code in RETRY_CODES and attempt == 0:
                time.sleep(2)
                continue
            detail = e.read().decode("utf-8", "replace")[:300]  # 키 값은 메시지에 넣지 않는다
            raise ReportError(f"AI 호출에 실패했습니다 (Gemini HTTP {e.code}: {detail})") from e
        except Exception as e:
            raise ReportError(f"AI 호출에 실패했습니다 ({type(e).__name__}: {e})") from e
    try:
        cand = data["candidates"][0]
        text = "".join(p.get("text", "") for p in cand["content"]["parts"]).strip()
    except (KeyError, IndexError, TypeError) as e:
        raise ReportError("AI 응답 형식이 올바르지 않습니다. 다시 질문해 주세요") from e
    if not text:
        raise ReportError("AI가 답을 돌려주지 않았습니다. 다시 질문해 주세요")
    if cand.get("finishReason") == "MAX_TOKENS":
        text += "\n\n(답이 길어서 여기까지만 받았어요. 더 좁혀서 물어봐 주세요)"
    return text


def _claude(system: str, messages: list[ChatMessage], client=None) -> str:
    client = client or _make_client()
    try:
        res = client.messages.create(
            model=os.environ.get("ANTHROPIC_MODEL") or DEFAULT_MODEL,
            max_tokens=CHAT_MAX_TOKENS,
            system=system,
            messages=[{"role": m.role, "content": m.content} for m in messages],
        )
    except Exception as e:
        raise ReportError(f"AI 호출에 실패했습니다 ({type(e).__name__}: {e})") from e
    text = "".join(getattr(b, "text", "") for b in res.content if getattr(b, "type", None) == "text").strip()
    if not text:
        raise ReportError("AI가 답을 돌려주지 않았습니다. 다시 질문해 주세요")
    if getattr(res, "stop_reason", None) == "max_tokens":
        text += "\n\n(답이 길어서 여기까지만 받았어요. 더 좁혀서 물어봐 주세요)"
    return text


def chat(messages: list[ChatMessage], graph: SubstationGraph | None = None, result: SimulationResult | None = None,
         at: str | None = None, more: list[str] | None = None, post=None, client=None) -> ChatReply:
    """대화(마지막은 사용자 질문)와 지금 화면 자료로 답을 받는다. post·client: 테스트용"""
    messages = messages[-MAX_TURNS:]
    while messages and messages[0].role != "user":  # 모델은 사용자 질문으로 시작해야 한다
        messages = messages[1:]
    if not messages or messages[-1].role != "user":
        raise ReportError("질문이 없습니다")
    if len(messages[-1].content) > MAX_CHARS:
        raise ReportError(f"질문이 너무 깁니다 ({MAX_CHARS}자 이하로 줄여 주세요)")
    system = f"{_SYSTEM}\n\n{APP_GUIDE}\n\n{context_text(graph, result, at, more)}"
    provider = os.environ.get("AI_PROVIDER", "anthropic").strip().lower()
    if provider == "gemini":
        return ChatReply(reply=_gemini(system, messages, post))
    if provider not in ("anthropic", "claude"):
        raise ReportError(f"AI_PROVIDER 값 '{provider}'을(를) 모릅니다. .env에 gemini 또는 anthropic으로 적어 주세요")
    return ChatReply(reply=_claude(system, messages, client))


if __name__ == "__main__":
    # 자체 점검 (실제 AI를 부르지 않는다): 대화 정리, 자료 만들기, Gemini 요청 모양과 재시도
    from cim.models import Feeder, Node, Substation

    g = SubstationGraph(
        substation=Substation(id="s", name="시험 변전소"),
        feeders=[Feeder(id="f", substation_id="s", name="F1")],
        lines=[],
        nodes=[Node(id="b", substation_id="s", name="접속점1", type="bus", x=0, y=0),
               Node(id="l", substation_id="s", name="부하1", type="load", x=0, y=0, p_kw=100, bus_id="b")],
    )
    ctx = context_text(g, None)
    assert "시험 변전소" in ctx and "F1" in ctx and "부하 1" in ctx and "계산 결과: 없음" in ctx
    assert "고르지 않았습니다" in context_text(None, None)

    sent = {}

    def fake_post(url, headers, body):
        sent["body"] = json.loads(body)
        return {"candidates": [{"content": {"parts": [{"text": "답입니다"}]}, "finishReason": "STOP"}]}

    os.environ["AI_PROVIDER"], os.environ["GEMINI_API_KEY"] = "gemini", "test-key"
    msgs = [ChatMessage(role="assistant", content="안녕하세요"), ChatMessage(role="user", content="정전은 어디야?")]
    r = chat(msgs, g, None, post=fake_post)
    assert r.reply == "답입니다"
    contents = sent["body"]["contents"]
    assert [c["role"] for c in contents] == ["user"], contents  # 앞의 도우미 인사는 빠짐
    assert "플랫폼 기능 안내" in sent["body"]["systemInstruction"]["parts"][0]["text"]

    calls = []

    def flaky(url, headers, body):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(url, 429, "too many", {}, None)
        return {"candidates": [{"content": {"parts": [{"text": "두 번째에 성공"}]}}]}

    time.sleep = lambda s: None  # 점검에서는 기다리지 않음
    assert chat(msgs, g, post=flaky).reply == "두 번째에 성공" and len(calls) == 2

    os.environ["AI_PROVIDER"] = "google"
    try:
        chat(msgs, g, post=fake_post)
        raise AssertionError("모르는 AI_PROVIDER는 오류여야 함")
    except ReportError as e:
        assert "google" in str(e)
    # 변전소 목록·이미 만든 결과 자료
    sec = substations_section([(g.substation, g, None, "계산 결과 없음"), (Substation(id="t", name="다른 변전소"), None, None, "불러오지 못함")], "s", "2026-11-20 9시")
    assert sec[0].startswith("[내 변전소 전체: 2곳]") and "← 지금 보는 변전소" in sec[1] and "다른 변전소: 불러오지 못함" in sec[2], sec
    ex = extra_sections(g, {"reinforce": {"ranking": [{"name": "선로1", "max_loading_pct": 120, "worst_date": "2025-08-01", "worst_hour": 15,
                                                       "hours_over": 3, "hours_watch": 5, "rated_current_a": None, "required_rated_current_a": 480}], "dates": ["2025-08-01"]}})
    assert not any("이미 만든 AI 리포트" in x for x in ex) and any("선로1" in x and "480 A" in x for x in ex) and any("여유 용량] 아직" in x for x in ex), ex
    print("chat 자체 점검 OK")
