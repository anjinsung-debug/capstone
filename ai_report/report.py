"""LLM 리포트 생성 (FR-08, FR-09, 제안서 5단계)

흐름: 계통 정보 + 시뮬레이션 결과 → (코드가 판정 기준으로 문제 항목을 먼저 계산) → 구조화된 프롬프트
      → Claude 호출 (tool use로 형식 고정) → Report(진단, 원인, 솔루션)

LLM 환각을 줄이는 방법 (제안서 10장 리스크 대응):
    1. 문제 항목(저전압·과전압·과부하·역조류·단락용량·정전)과 건강도 등급은 LLM이 아니라 이 파일의 코드가 판정 기준
       (simulation/models.py의 VOLTAGE_MIN_PU 등)으로 계산해서 "확정된 사실"로 넘긴다. LLM은 그 사실을 풀어서 설명만 한다
    2. 프롬프트에 없는 수치·설비는 쓰지 말라고 지시하고, 원인에는 설비 이름과 수치를 인용하게 한다
    3. 허용전류·단락용량이 데이터에 없어 가정값으로 계산된 경우, 그 사실을 프롬프트에 넣어 리포트에 밝히게 한다
    4. 출력은 tool use의 JSON 형식(진단 1개, 원인 목록, 솔루션 목록)으로 고정한다

환경 변수 (.env):
    AI_PROVIDER      anthropic(기본) 또는 gemini
    anthropic일 때   ANTHROPIC_API_KEY (필수), ANTHROPIC_MODEL (선택, 기본 DEFAULT_MODEL)
    gemini일 때      GEMINI_API_KEY (필수), GEMINI_MODEL (선택, 기본 GEMINI_DEFAULT_MODEL)
    AI_TIMEOUT_SEC   (선택) AI 응답을 기다리는 최대 시간(초), 기본 TIMEOUT_SEC

자체 점검 (API 호출 없이 프롬프트만 확인): python -m ai_report.report  (저장소 루트의 .env를 자동으로 읽음)
                   (실제로 호출까지: python -m ai_report.report --call)
"""

import json
import math
import os
import urllib.error
import urllib.request

from ai_report.models import LineRank, ReinforcementReport, Report
from cim.models import BASE_KV, SubstationGraph
from simulation.dss import (
    DEFAULT_BREAKER_INTERRUPT_KA,
    DEFAULT_RATED_CURRENT_A,
    DEFAULT_SHORT_CIRCUIT_MVA,
    DEFAULT_X_R_RATIO,
    DEFAULT_ZERO_SEQ_RATIO,
)
from simulation.models import OVERLOAD_PCT, VOLTAGE_MAX_PU, VOLTAGE_MIN_PU, SimulationResult

# ponytail: 모델은 회의록 "AI 리포트 구성"에서 아직 정하지 않았다. 확정되면 기본값을 바꾸거나 .env의 ANTHROPIC_MODEL로 지정한다
DEFAULT_MODEL = "claude-sonnet-5-5"
# ponytail: 출력 한도·대기 시간·재시도(2회)를 고정값으로 두었다. 리포트가 잘리거나 변전소가 커져 느려지면 이 값부터 올린다
MAX_TOKENS = 2000
TIMEOUT_SEC = 120.0  # AI 응답을 기다리는 최대 시간(초). .env의 AI_TIMEOUT_SEC로 바꿀 수 있다


def _timeout() -> float:
    """대기 시간. 진짜 계통은 입력이 커서 Gemini 응답이 60초를 넘길 수 있어 기본 120초로 늘렸다 (TimeoutError가 났음).
    .env는 실행 중에 읽히는 경우가 있어 값을 쓰는 순간에 읽는다. 숫자가 아니거나 0 이하면 기본값."""
    try:
        value = float(os.environ.get("AI_TIMEOUT_SEC") or TIMEOUT_SEC)
    except ValueError:
        return TIMEOUT_SEC
    return value if value > 0 else TIMEOUT_SEC
# ponytail: 표가 길면 앞 120줄만 넣고 나머지는 "생략"으로 알린다 (정렬이 문제 큰 순이라 중요한 줄은 남는다).
#   변전소가 커져 정상 지점이 필요하거나 입력 토큰이 부담되면 요약 통계로 바꾼다
MAX_ROWS = 120  # 프롬프트에 넣는 지점·선로 표의 최대 줄 수
# 단락용량 기준: frontend/src/lib/overlay.js의 FAULT_HIGH_MVA, mvaOf와 같은 규칙이다. 바꾸면 두 곳을 함께 고친다.
# ponytail: 300 MVA는 제안서 슬라이드 예시값이다 (화면 진단표에서 '주의'). 한전 자문 후 확정되면 두 곳을 같이 바꾼다
FAULT_HIGH_MVA = 300
MAX_FAULT_LISTED = 10  # 프롬프트에 이름을 적는 단락용량 초과 지점 수 (나머지는 개수만)
# 등급 기준: frontend/src/lib/overlay.js의 VOLTAGE_DANGER_LOW_PU, VOLTAGE_DANGER_HIGH_PU, LOADING_WATCH_PCT와 같은 값이다. 바꾸면 두 곳을 함께 고친다
VOLTAGE_DANGER_LOW_PU = 0.9
VOLTAGE_DANGER_HIGH_PU = 1.1
LOADING_WATCH_PCT = 80
TOOL_NAME = "submit_report"
# ponytail: Gemini는 SDK 없이 REST로 부른다 (설치할 패키지를 늘리지 않으려고). 모델 이름은 Google AI Studio의 모델 목록에서 확인해 GEMINI_MODEL로 바꾼다.
#   Gemini를 계속 쓰기로 정해지면 공식 SDK(google-genai)로 바꾸고 requirements.txt에 추가한다
GEMINI_DEFAULT_MODEL = "gemini-3.8-flash"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Gemini는 생각(thinking) 토큰도 출력 한도에 들어간다. 2000으로는 생각 1500여 토큰 + 리포트 400여 토큰에서 잘렸다 (2026-10-11 실측)
GEMINI_MAX_TOKENS = 8192

# ponytail: 등급은 3단계 고정이고 LLM이 아니라 코드가 정한다 (같은 결과면 항상 같은 등급). 세분화하거나 점수제로 바꿀 때는 check_findings의 규칙과 README를 같이 고친다
# 이름과 규칙은 화면 진단표(frontend/src/lib/overlay.js의 healthCheck, LEVELS)와 같다. 바꾸면 두 곳을 함께 고친다
GRADES = ("정상", "주의", "위험")


class ReportError(Exception):
    """리포트를 만들 수 없을 때 (키 없음, API 호출 실패, 응답 형식 오류, 수렴하지 않은 결과). 백엔드가 503으로 알린다."""


# ponytail: 해설 대상은 두 가지(전문가용/쉬운 설명)고, 판정 기준·수치 규칙(_RULES)은 같고 말투와 용어 수준만 다르다.
#   대상을 더 늘릴 때는 AUDIENCES와 _STYLE에 항목을 하나 더하고, 화면의 선택 버튼(ResultPanel.jsx의 ReportBox)도 같이 고친다
AUDIENCES = ("expert", "plain")  # expert = 전문가용 설명, plain = 쉬운 설명
DEFAULT_AUDIENCE = "expert"

_INTRO = "당신은 22.9kV 배전계통 해석 결과를 설명하는 전력계통 엔지니어입니다."

_RULES = f"""사용자가 계통 정보와 시뮬레이션 수치, 그리고 코드가 이미 판정한 "확정된 점검 결과"를 줍니다. 아래 규칙을 지키세요.
1. 제공된 수치와 설비 이름만 쓰세요. 없는 값을 추측하거나 만들어 내지 마세요. 모르는 것은 "데이터에 없음"이라고 쓰세요.
2. 건강도 등급(정상·주의·위험)은 "확정된 점검 결과"에 적힌 등급을 그대로 쓰세요. 바꾸거나 다시 판정하지 마세요.
3. 판정 기준: 전압 정상 범위 {VOLTAGE_MIN_PU}~{VOLTAGE_MAX_PU} pu({VOLTAGE_DANGER_LOW_PU} pu 미만·{VOLTAGE_DANGER_HIGH_PU} pu 초과는 위험), 선로 부하율 {OVERLOAD_PCT:.0f}% 초과면 과부하(위험), {LOADING_WATCH_PCT}% 이상이면 부하율 높음(주의), 분산전원 때문에 전력이 반대로 흐르면 역조류(선로 용량 이내이고 출구 차단기가 고장전류를 끊을 수 있으면 정상이라 문제로 다루지 말고 있다는 사실만 알림, 아니면 주의), 3상 단락용량이 {FAULT_HIGH_MVA} MVA를 넘으면 단락용량 증가(차단기 정격·보호계전기 검토 대상), 전원에서 끊기면 정전입니다. 정전은 저전압이 아닙니다.
4. 원인은 문제가 있는 설비 이름과 수치를 인용해서, 왜 그렇게 되는지 전기적 이유(선로 길이와 임피던스에 따른 전압강하, 분산전원 출력이 부하보다 큰 구간, 전류가 허용전류를 넘음 등)를 설명하세요. 입력에 없는 연결 구조를 가정하지 마세요.
5. 솔루션은 원인과 하나씩 대응시키고 우선순위 순서로 쓰세요. 전선 굵기 교체, 전압조정기(SVR) 설치, 부하 절체, 역조류 보호계전 점검, 차단기 정격 검토, ESS 설치, 개폐기 조작처럼 엔지니어가 실제로 할 수 있는 조치로 쓰고, 효과를 수치로 약속하지 마세요.
6. 문제가 없으면 원인에는 "기준 안에 있음"을 근거 수치와 함께 쓰고, 솔루션에는 유지·재점검 방법만 쓰세요. 문제를 지어내지 마세요.
7. 허용전류나 단락용량이 가정값으로 계산됐다고 알려 주면, 그 값에 의존하는 부하율·고장전류 설명에 "가정값 기준"이라고 밝히세요.
8. 진단은 등급 다음에 "지금 상황 요약"(태양광·풍력이 얼마나 들어오는지, 전기를 얼마나 쓰는지, 변전소가 얼마나 보내는지)을 1~2문장으로 쓰세요. 숫자는 요약에 적힌 값을 그대로 쓰고, 직접 더하거나 다시 계산하지 마세요.
9. "고장 전류와 출구 차단기"는 참고 정보입니다. 등급을 바꾸지 마세요. 차단 불가인 차단기가 있으면 원인과 솔루션에 "차단기 정격 검토 필요"로 쓰고, 모두 차단 가능이면 진단에 한 마디만 쓰세요. 지락(1선·2선)은 전깃줄이 땅에 닿는 사고로, 3상 단락과 구분해서 쓰세요."""

_STYLE = {
    "expert": """[독자와 말투: 전문가용]
독자는 전력계통을 아는 엔지니어(관제·운영·설계 담당)입니다.
- pu, 부하율, 임피던스, 단락용량(MVA), 역조류, 정격, SVR, 보호계전기 같은 전문 용어를 풀어 쓰지 말고 그대로 쓰세요.
- 수치는 단위와 함께 정확히 인용하고(예: 0.93 pu, 112%, 412 MVA), 판단 근거가 되는 기준값을 같이 적으세요.
- 원인은 전기적 메커니즘(전압강하, 전류 분포, 고장전류 증가 등)으로, 솔루션은 설비·보호 협조 관점의 구체적 조치로 쓰세요.
- 진단은 2~3문장, 원인과 솔루션은 각각 항목당 1~2문장으로 간결하게 쓰세요.""",
    # ponytail: 쉬운 설명은 규칙보다 뒤에 붙여서(system_prompt 참고) 규칙의 전문 표현을 덮어쓴다. 바꿔 쓰기 표는 실제 결과에서 어려웠던 말을 보고 늘린다 (2026-10-25: 내부 이름·MVA·kW·개폐기·ESS가 그대로 나와서 강화, 10-26: 너무 짧고 원인이 진단을 되풀이해서 길이·내용 기준 추가)
    "plain": """[쉬운 설명 지침: 이 지침이 위 규칙의 표현보다 우선합니다]
독자는 전기에 대해 아무것도 모르는 사람(초등학생부터 어르신까지)입니다. 동네 주민에게 말로 설명하듯 "~해요"체로 쓰세요.
사실(어디에, 무슨 문제가, 왜)은 위 규칙대로 입력에서만 가져오고, 표현만 아래처럼 바꾸세요.

1) 이 말들은 쓰지 말고 오른쪽 말로 바꾸세요.
- 배전계통, 계통 → 이 지역 전기망
- 모선, 선로, 피더, 구간(Section) → 전깃줄
- 차단기, 개폐기 → 전기 스위치
- 정전 → 전기가 끊김
- 단락용량, 고장전류 → 사고가 나면 한꺼번에 흐를 수 있는 전기의 양
- 1선 지락, 2선 지락 → 전깃줄 하나(또는 둘)가 땅에 닿는 사고
- 출구 차단기 차단 가능 → 사고가 나면 변전소 출구 스위치가 전기를 바로 끊을 수 있음
- 역조류 → 전기가 거꾸로 흐름
- 부하 → 전기를 쓰는 집과 가게
- 분산전원, PV → 태양광 발전기 (풍력이면 풍력 발전기)
- 보호계전기, 보호 장치 → 사고를 막는 안전장치
- ESS → 남는 전기를 모아 두는 큰 배터리
- 전압 → 전기의 힘
- 부하율, 허용전류 → 전깃줄이 견딜 수 있는 양
- 가정값 → "정확한 자료가 없어 보통 쓰는 값으로 계산했어요"
- 등급 이름(정상·주의·위험)만 그대로 쓰세요.

2) 숫자: 단위가 붙은 숫자(kW, MVA, kV, pu, A)와 마이너스 숫자는 쓰지 마세요. 단, "지금 상황 요약"의 태양광·풍력·사용량·송출량은 요약에 적힌 kW·MW 숫자를 그대로 써도 됩니다(예: "태양광 3곳에서 2,000 kW가 들어오고 있어요"). "기준보다 조금 높아요", "쓰는 양보다 두 배 넘게 만들어요"처럼 비교로만 말하세요. 비교는 입력 수치로 바로 확인되는 것만 쓰세요. 꼭 필요하면 퍼센트(%)는 하나까지 써도 됩니다.

3) 이름: 영어·밑줄·기호가 섞인 내부 이름(예: CN_…, BS_…, CB_…, Section⑧_…)은 쓰지 마세요. 위치는 "변전소 바로 앞", "왼쪽 끝 태양광 발전기 근처", "2번 스위치"처럼 말로 설명하세요. 같은 문제가 여러 곳이면 "변전소 근처 4곳"처럼 묶으세요.
설비 이름에 '차단기·개폐기·선로·모선·접속점' 같은 말이 들어 있으면 그 말도 바꾸세요. 예: "차단기 2" → "2번 전기 스위치", "선로 1" → "1번 전깃줄", "접속점 3" → "3번 연결 지점".

4) 구성과 길이: 한두 문장으로 끝내지 말고 아래 내용을 모두 담으세요.
- 진단(3~5문장): 등급 → 지금 상황 요약(규칙 8) → 문제가 있는 것 → 기준 안이라 괜찮은 것(전기의 힘, 전깃줄 사용량 등 확정된 점검 결과에서 0곳인 항목) → 그래서 주민에게 어떤 영향이 있는지. 영향은 입력으로 알 수 있는 만큼만 쓰세요. 예: 전기가 끊긴 지점에 연결된 집과 가게는 전기를 쓸 수 없어요.
- 원인(항목당 2~3문장): 진단을 되풀이하지 말고 "왜 그런지"를 설명하세요. 입력의 연결 정보(어느 스위치·전깃줄 뒤쪽인지, 근처 발전기가 만드는 양과 쓰는 양 비교, 전깃줄 길이)를 근거로 쓰세요. 자료로 알 수 없는 이유는 지어내지 말고 "자료만으로는 ~까지는 알 수 없어요"라고 쓰세요. 이해를 돕는 쉬운 비유를 한 번 넣어도 됩니다.
- 솔루션(항목당 2~3문장): 전력회사 담당자가 무엇을 하는지 → 그게 왜 도움이 되는지 → (필요할 때만) 그동안 알아 두면 좋은 점. 주민이 직접 할 일처럼 쓰지 마세요. 효과를 숫자로 약속하지 마세요.
- "정확한 자료가 없어 보통 쓰는 값으로 계산했어요"는 가정값에 기대는 설명(전깃줄 사용량, 사고 때 흐를 수 있는 전기의 양)에만 붙이세요. 전기가 끊김, 전기의 힘, 전기가 거꾸로 흐름 설명에는 붙이지 마세요.
- 한 문장은 짧게(40자 안팎) 쓰고, 겁을 주는 말투는 피하세요.

5) 형식 예시 (말투만 참고하고, 내용은 반드시 입력에 맞게 쓰세요)
- 진단: "이 지역 전기망은 위험 등급이에요. 3번 연결 지점에 전기가 끊겨 있어요. 전기의 힘과 전깃줄 사용량은 기준 안이라 괜찮아요. 다만 끊긴 곳에 연결된 집과 가게는 지금 전기를 쓸 수 없어요."
- 원인: "3번 연결 지점은 1번 전기 스위치 뒤쪽에 있는데, 그 길로 전기가 하나도 흐르지 않아요. 수도 밸브가 잠기면 그 뒤로 물이 안 가는 것과 비슷해요. 자료만으로는 스위치가 꺼진 건지, 전깃줄이 끊긴 건지까지는 알 수 없어요."
- 원인: "왼쪽 끝 태양광 발전기가 근처 집들이 쓰는 것보다 전기를 훨씬 많이 만들어요. 남는 전기가 변전소 쪽으로 거꾸로 흘러가요."
- 솔루션: "전력회사 담당자가 1번 전기 스위치와 그 뒤 전깃줄을 살펴보고 다시 연결해요. 길이 다시 이어지면 끊긴 쪽에도 전기가 들어가요. 고치는 동안에는 그쪽 전기를 잠시 쓸 수 없을 수 있어요."
""",
}


def system_prompt(audience: str = DEFAULT_AUDIENCE) -> str:
    """해설 대상(audience)에 맞는 시스템 프롬프트. 모르는 대상이면 ReportError"""
    if audience not in _STYLE:
        raise ReportError(f"알 수 없는 해설 대상입니다: {audience} (사용 가능: {', '.join(AUDIENCES)})")
    if audience == "plain":
        return f"{_INTRO}\n\n{_RULES}\n\n{_STYLE[audience]}"
    return f"{_INTRO}\n\n{_STYLE[audience]}\n\n{_RULES}"


SYSTEM_PROMPT = system_prompt("expert")  # 기본(전문가용). 기존 코드·테스트가 쓰는 이름
PLAIN_SYSTEM_PROMPT = system_prompt("plain")

REPORT_TOOL = {
    "name": TOOL_NAME,
    "description": "배전계통 건강도 진단 리포트를 제출한다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "diagnosis": {"type": "string", "description": "1단계 건강도 진단. 확정된 등급으로 시작하는 요약"},
            "causes": {"type": "array", "items": {"type": "string"}, "description": "2단계 원인 분석. 문제 항목별 항목 하나"},
            "solutions": {"type": "array", "items": {"type": "string"}, "description": "3단계 솔루션 제안. 우선순위 순서, 원인과 대응"},
        },
        "required": ["diagnosis", "causes", "solutions"],
    },
}


def check_findings(graph: SubstationGraph, result: SimulationResult) -> dict:
    """판정 기준으로 문제 항목과 건강도 등급을 계산한다 (LLM에 넘기는 확정된 사실). 각 항목은 (이름, 수치) 목록."""
    names = {n.id: n.name for n in graph.nodes}
    line_names = {line.id: line.name for line in graph.lines}
    low = [(names.get(r.node_id, r.node_id), r.voltage_pu) for r in result.nodes if r.energized and r.voltage_pu < VOLTAGE_MIN_PU]
    high = [(names.get(r.node_id, r.node_id), r.voltage_pu) for r in result.nodes if r.energized and r.voltage_pu > VOLTAGE_MAX_PU]
    outage = [names.get(r.node_id, r.node_id) for r in result.nodes if not r.energized]
    overload = [(line_names.get(r.line_id, r.line_id), r.loading_pct) for r in result.lines if r.loading_pct is not None and r.loading_pct > OVERLOAD_PCT]
    watch = [(line_names.get(r.line_id, r.line_id), r.loading_pct) for r in result.lines if r.loading_pct is not None and LOADING_WATCH_PCT <= r.loading_pct <= OVERLOAD_PCT]
    # 역조류 (10/26 회의 기준): 선로 용량 이내이고 출구 차단기가 끊을 수 있으면 정상(reverse_flow_ok=True, simulation/simulate.py가 판정).
    #   정상은 표시만 하고 등급에 넣지 않는다. 기준 초과(False)나 판정 값이 없는 예전 결과(None)는 '주의'.
    #   frontend/src/lib/overlay.js의 healthCheck와 같은 규칙이다. 바꾸면 두 곳을 함께 고친다
    # ponytail: 피더 송출 전력 < 0(변전소 뱅크 역송)은 따로 판정하지 않는다 (회의 기준에 없음)
    reverse = [(line_names.get(r.line_id, r.line_id), r.p_kw) for r in result.lines if r.reverse_flow and r.reverse_flow_ok is not True]
    reverse_ok = [(line_names.get(r.line_id, r.line_id), r.p_kw) for r in result.lines if r.reverse_flow and r.reverse_flow_ok is True]
    # 3상 단락용량(MVA) = √3 × 선간전압(kV) × 단락전류(kA). 정전 지점은 단락전류가 없으니 뺀다
    fault = [
        (names.get(r.node_id, r.node_id), math.sqrt(3) * BASE_KV * r.fault_current_ka)
        for r in result.nodes
        if r.energized and r.fault_current_ka is not None and math.sqrt(3) * BASE_KV * r.fault_current_ka > FAULT_HIGH_MVA
    ]
    fault.sort(key=lambda x: -x[1])
    low.sort(key=lambda x: x[1])
    high.sort(key=lambda x: -x[1])
    overload.sort(key=lambda x: -x[1])
    watch.sort(key=lambda x: -x[1])
    # ponytail: 항목 개수와 상관없이 하나라도 있으면 같은 등급이다. 심각도 가중치가 필요해지면 그때 점수 계산을 넣는다
    # 등급 (화면 진단표와 같은 규칙): 항목마다 판정하고 가장 나쁜 것이 전체 등급
    #   위험: 전압 0.9 pu 미만·1.1 pu 초과, 과부하, 정전 / 주의: 전압 정상 범위 밖, 부하율 80% 이상, 기준 초과 역조류, 단락용량 초과
    danger_v = any(v < VOLTAGE_DANGER_LOW_PU for _, v in low) or any(v > VOLTAGE_DANGER_HIGH_PU for _, v in high)
    if danger_v or overload or outage:
        grade = GRADES[2]
    elif low or high or watch or reverse or fault:
        grade = GRADES[1]
    else:
        grade = GRADES[0]
    return {"grade": grade, "low": low, "high": high, "outage": outage, "overload": overload, "watch": watch, "reverse": reverse, "reverse_ok": reverse_ok, "fault": fault}


def _assumptions(graph: SubstationGraph) -> list[str]:
    """데이터에 없어 시뮬레이션이 가정값으로 계산한 항목 (부하율·고장전류가 이 값에 의존한다)"""
    out = []
    no_rating = [line for line in graph.lines if line.kind != "switch" and line.rated_current_a is None]
    if no_rating:
        out.append(f"선로 {len(no_rating)}개는 허용전류 데이터가 없어 {DEFAULT_RATED_CURRENT_A:.0f} A 가정값으로 부하율을 계산했습니다.")
    sub = graph.substation
    if sub.short_circuit_mva is None:
        out.append(f"변전소 3상 단락용량 데이터가 없어 {DEFAULT_SHORT_CIRCUIT_MVA:.0f} MVA 가정값으로 고장전류를 계산했습니다.")
    if sub.x_r_ratio is None:
        out.append(f"변전소 X/R 데이터가 없어 {DEFAULT_X_R_RATIO:.0f} 가정값으로 고장전류를 계산했습니다.")
    no_zero = [line for line in graph.lines if line.kind != "switch" and (line.r0_ohm_per_km is None or line.x0_ohm_per_km is None)]
    if no_zero:
        out.append(f"선로 {len(no_zero)}개는 영상분(R0·X0) 데이터가 없어 정상분 × {DEFAULT_ZERO_SEQ_RATIO:g} 가정값으로 지락 전류를 계산했습니다.")
    out.append(f"출구 차단기 정격 차단전류는 데이터가 없어 {DEFAULT_BREAKER_INTERRUPT_KA:.0f} kA 가정값으로 차단 가능 여부를 판정했습니다.")
    return out


def _limit(rows: list[str], total: int, what: str) -> list[str]:
    # ponytail: 단순 자르기. 호출하는 쪽이 이미 문제 큰 순으로 정렬해 두었다는 전제다
    if len(rows) <= MAX_ROWS:
        return rows
    return rows[:MAX_ROWS] + [f"(... {what} {total - MAX_ROWS}개는 문제가 작아 생략)"]


def summarize(graph: SubstationGraph, result: SimulationResult) -> list[str]:
    """지금 상황 요약 (회의 10/26: "시뮬레이션 봤을 때 큰 usecase 하나씩, 예: 태양광이 몇 들어오고 있는지").
    합계·개수는 LLM이 더하다 틀리지 않게 코드가 계산한다. 값은 이 결과를 계산한 시각의 값(backend가 graph_at으로 맞춘 계통)"""
    out = []
    for kind, ko, verb in (("pv", "태양광", "출력"), ("wind", "풍력", "출력"), ("load", "부하", "소비")):
        items = [n for n in graph.nodes if n.type == kind and n.p_kw is not None]
        if not items:
            out.append(f"- {ko} 0곳")
            continue
        total = sum(n.p_kw for n in items)
        top = max(items, key=lambda n: n.p_kw)
        out.append(f"- {ko} {len(items)}곳, {verb} 합계 {total:,.0f} kW (가장 큰 곳: {top.name} {top.p_kw:,.0f} kW)")
    gen = sum(n.p_kw for n in graph.nodes if n.type in ("pv", "wind") and n.p_kw is not None)
    load = sum(n.p_kw for n in graph.nodes if n.type == "load" and n.p_kw is not None)
    if load > 0 and gen > 0:
        out.append(f"- 분산전원(태양광+풍력) 출력은 부하 소비의 {gen / load * 100:.0f}%")
    send = sum(fr.p_kw for fr in result.feeders)
    direction = "변전소가 내보냄" if send >= 0 else "변전소 쪽으로 거꾸로 들어옴"
    out.append(f"- 변전소 송출 합계 {send / 1000:,.2f} MW ({direction}), 선로 손실 {result.loss_kw:,.1f} kW")
    return out


def fault_summary(graph: SubstationGraph, result: SimulationResult) -> list[str]:
    """고장 전류(3상 단락·1선 지락·2선 지락)의 최댓값과 피더별 출구 차단기 차단 가능 여부. 등급에는 넣지 않는 참고 정보
    ponytail: 지락·차단기 판정은 진성이 시뮬레이션(simulation/simulate.py) 값을 그대로 옮긴다. 등급에 넣기로 정하면 check_findings와 overlay.js healthCheck를 같이 고친다"""
    names = {n.id: n.name for n in graph.nodes}
    feeder_names = {fd.id: fd.name for fd in graph.feeders}
    out = []
    for attr, ko in (("fault_current_ka", "3상 단락"), ("ground_fault_current_ka", "1선 지락"), ("double_ground_fault_current_ka", "2선 지락")):
        vals = [(getattr(r, attr), r.node_id) for r in result.nodes if getattr(r, attr) is not None]
        if vals:
            v, nid = max(vals)
            out.append(f"- 최대 {ko} 전류 {v:.2f} kA ({names.get(nid, nid)})")
    for fr in result.feeders:
        state = {True: "차단 가능", False: "차단 불가 (정격 초과)", None: "판정 값 없음 (정전 구간이거나 계산되지 않음)"}[fr.breaker_interruptible]
        out.append(f"- {feeder_names.get(fr.feeder_id, fr.feeder_id)} 출구 차단기: {state} (정격 {DEFAULT_BREAKER_INTERRUPT_KA:.0f} kA 기준)")
    return out


def build_prompt(graph: SubstationGraph, result: SimulationResult) -> str:
    """계통 정보와 해석 수치를 구조화된 텍스트로 만든다 (README: 설비 이름·종류·연결, 전압 pu, 부하율, 고장전류, 역조류, 피더별 송출 전력)"""
    f = check_findings(graph, result)
    nodes = {n.id: n for n in graph.nodes}
    node_res = {r.node_id: r for r in result.nodes}
    line_res = {r.line_id: r for r in result.lines}
    feeder_names = {fd.id: fd.name for fd in graph.feeders}
    sub = graph.substation

    def label(node_id: str) -> str:
        n = nodes.get(node_id)
        return f"{n.name}({n.type})" if n else node_id

    lines = [f"# 변전소 {sub.name}", f"기준 전압 {BASE_KV} kV, 변전소 모선 전압 {sub.source_voltage_pu:.3f} pu, 선로 손실 합계 {result.loss_kw:.1f} kW", ""]

    lines.append("## 지금 상황 요약 (코드가 계산한 값. 진단에서 등급 다음에 쓰세요)")
    lines += summarize(graph, result)
    lines.append("")

    lines.append("## 확정된 점검 결과 (코드가 판정 기준으로 계산한 사실. 그대로 쓰세요)")
    lines.append(f"- 건강도 등급: {f['grade']}")
    lines.append(f"- 저전압(<{VOLTAGE_MIN_PU} pu) {len(f['low'])}곳" + (": " + ", ".join(f"{n} {v:.3f} pu" for n, v in f["low"]) if f["low"] else ""))
    lines.append(f"- 과전압(>{VOLTAGE_MAX_PU} pu) {len(f['high'])}곳" + (": " + ", ".join(f"{n} {v:.3f} pu" for n, v in f["high"]) if f["high"] else ""))
    lines.append(f"- 과부하(>{OVERLOAD_PCT:.0f}%) 선로 {len(f['overload'])}개" + (": " + ", ".join(f"{n} {p:.0f}%" for n, p in f["overload"]) if f["overload"] else ""))
    lines.append(f"- 부하율 높음({LOADING_WATCH_PCT}~{OVERLOAD_PCT:.0f}%) 선로 {len(f['watch'])}개" + (": " + ", ".join(f"{n} {p:.0f}%" for n, p in f["watch"]) if f["watch"] else ""))
    lines.append(f"- 기준 초과 역조류 선로 {len(f['reverse'])}개 (선로 용량 초과 또는 차단기 차단 불가)" + (": " + ", ".join(f"{n} {p:.0f} kW" for n, p in f["reverse"]) if f["reverse"] else ""))
    lines.append(f"- 정상 역조류 선로 {len(f['reverse_ok'])}개 (선로 용량 이내·차단기 차단 가능. 문제 아님, 있다는 사실만 알리세요)"
                 + (": " + ", ".join(f"{n} {p:.0f} kW" for n, p in f["reverse_ok"]) if f["reverse_ok"] else ""))
    shown = f["fault"][:MAX_FAULT_LISTED]
    more = f" 외 {len(f['fault']) - len(shown)}곳" if len(f["fault"]) > len(shown) else ""
    lines.append(f"- 단락용량(>{FAULT_HIGH_MVA} MVA) {len(f['fault'])}곳" + (": " + ", ".join(f"{n} {m:.0f} MVA" for n, m in shown) + more if f["fault"] else ""))
    lines.append(f"- 정전 지점 {len(f['outage'])}곳" + (": " + ", ".join(f["outage"]) if f["outage"] else ""))
    assumptions = _assumptions(graph)
    if assumptions:
        lines.append("- 가정값 사용: " + " ".join(assumptions))
    lines.append("")

    fault_rows = fault_summary(graph, result)
    if fault_rows:
        lines.append("## 고장 전류와 출구 차단기 (참고 정보. 등급에는 반영하지 않음)")
        lines += fault_rows
        lines.append("")

    lines.append("## 피더별 변전소 출구 송출 전력")
    for fr in result.feeders:
        lines.append(f"- {feeder_names.get(fr.feeder_id, fr.feeder_id)}: 유효 {fr.p_kw / 1000:.2f} MW, 무효 {fr.q_kvar / 1000:.2f} MVAr")
    lines.append("")

    # 부하·분산전원: 어느 접속점에 얼마가 붙었는지 (원인 설명의 근거. 결과 표에는 단자 1개 설비가 없을 수 있다). 분산전원 먼저, 큰 것 순
    devices = sorted(
        (n for n in graph.nodes if n.type in ("load", "pv", "wind") and n.p_kw is not None),
        key=lambda n: (n.type == "load", -n.p_kw),
    )
    kind_ko = {"load": "부하 소비", "pv": "태양광 출력", "wind": "풍력 출력"}
    device_rows = [
        f"- {n.name}({n.type}): {nodes[n.bus_id].name if n.bus_id in nodes else '연결 접속점 없음'}에 연결, {kind_ko[n.type]} {n.p_kw:.0f} kW, 무효 {n.q_kvar or 0:.0f} kvar"
        for n in devices
    ]
    if device_rows:
        lines.append("## 부하·분산전원 (접속점별, 한 시점 고정값)")
        lines += _limit(device_rows, len(device_rows), "설비")
        lines.append("")

    # 지점별: 정전 → 전압 낮은 순 (문제가 큰 순으로 두어 길면 뒤를 자른다)
    rows = sorted((r for r in result.nodes if r.node_id in nodes), key=lambda r: (r.energized, r.voltage_pu))
    node_rows = []
    for r in rows:
        n = nodes[r.node_id]
        if not r.energized:
            node_rows.append(f"- {n.name}({n.type}): 정전")
            continue
        extra = f", 단락전류 {r.fault_current_ka:.2f} kA" if r.fault_current_ka is not None else ""
        if r.ground_fault_current_ka is not None:
            extra += f", 1선 지락 {r.ground_fault_current_ka:.2f} kA"
        if r.double_ground_fault_current_ka is not None:
            extra += f", 2선 지락 {r.double_ground_fault_current_ka:.2f} kA"
        power = f", 출력/소비 {n.p_kw:.0f} kW" if n.type in ("load", "pv", "wind") and n.p_kw is not None else ""
        node_rows.append(f"- {n.name}({n.type}): {r.voltage_pu:.3f} pu{extra}{power}")
    lines.append("## 지점별 (전압 낮은 순)")
    lines += _limit(node_rows, len(node_rows), "지점")
    lines.append("")

    # 선로별: 부하율 높은 순. 길이 0인 차단기·개폐기 연결(kind=switch)은 문제가 없으면 빼서 짧게 한다
    line_rows = []
    pairs = sorted(
        (line for line in graph.lines if line.id in line_res),
        key=lambda line: -(line_res[line.id].loading_pct or 0),
    )
    for line in pairs:
        r = line_res[line.id]
        if line.kind == "switch" and not r.reverse_flow:
            continue
        loading = f", 부하율 {r.loading_pct:.0f}%" if r.loading_pct is not None else ""
        flag = " [역조류]" if r.reverse_flow else ""
        line_rows.append(f"- {line.name}: {label(line.from_node_id)} → {label(line.to_node_id)}, {line.length_km:.2f} km, 유효 {r.p_kw:.0f} kW, 무효 {r.q_kvar:.0f} kvar{loading}{flag}")
    lines.append("## 선로별 (부하율 높은 순, 전원 쪽 → 말단 방향이 + 조류)")
    lines += _limit(line_rows, len(line_rows), "선로")
    lines.append("")

    lines.append("위 정보로 건강도 진단, 원인 분석, 솔루션 제안을 submit_report로 제출하세요.")
    return "\n".join(lines)


def _make_client():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ReportError("ANTHROPIC_API_KEY가 설정되지 않았습니다 (.env 확인 후 백엔드를 다시 시작하세요)")
    try:
        import anthropic
    except ImportError as e:
        raise ReportError("anthropic 라이브러리가 설치되지 않았습니다 (pip install -r requirements.txt)") from e
    # ponytail: 호출마다 클라이언트를 새로 만든다 (리포트는 시뮬레이션 뒤 한 번만 부르므로). 요청이 잦아지면 하나를 재사용한다
    return anthropic.Anthropic(timeout=_timeout(), max_retries=2)


def _build_report(data, substation_id: str) -> Report:
    """모델이 돌려준 {diagnosis, causes, solutions}를 검사해 Report로 만든다. 형식이 맞지 않으면 ReportError (Claude·Gemini 공통)"""
    if not isinstance(data, dict):
        raise ReportError("AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요")
    diagnosis = data.get("diagnosis")
    causes = data.get("causes")
    solutions = data.get("solutions")
    # ponytail: 형식 검사는 직접 쓴 최소 검사다. 필드가 늘면 Report(pydantic)로 바로 검증하게 바꾼다
    ok = isinstance(diagnosis, str) and diagnosis.strip() and isinstance(causes, list) and isinstance(solutions, list)
    if not ok or not all(isinstance(x, str) for x in causes + solutions):
        raise ReportError("AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요")
    return Report(substation_id=substation_id, diagnosis=diagnosis.strip(), causes=[c.strip() for c in causes if c.strip()], solutions=[x.strip() for x in solutions if x.strip()])


def _parse(response, substation_id: str) -> Report:
    """Claude tool use 응답에서 리포트를 꺼낸다. 형식이 맞지 않으면 ReportError"""
    if getattr(response, "stop_reason", None) == "max_tokens":
        raise ReportError("AI 응답이 길어서 중간에 잘렸습니다. 다시 시도해 주세요")
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == TOOL_NAME:
            return _build_report(block.input, substation_id)
    raise ReportError("AI가 리포트를 돌려주지 않았습니다. 다시 시도해 주세요")


def _gemini_schema(node):
    """REPORT_TOOL의 JSON 스키마를 Gemini 형식(type 이름이 대문자, description 유지)으로 바꾼다"""
    out = {"type": node["type"].upper()}
    if "description" in node:
        out["description"] = node["description"]
    if "properties" in node:
        out["properties"] = {k: _gemini_schema(v) for k, v in node["properties"].items()}
    if "items" in node:
        out["items"] = _gemini_schema(node["items"])
    if "required" in node:
        out["required"] = node["required"]
    return out


def _call_gemini(prompt: str, post=None, system: str = SYSTEM_PROMPT) -> dict:
    """Gemini REST 호출 (JSON 형식 고정). post: 테스트용 (url, headers, body 바이트) → 응답 dict. 없으면 실제로 호출한다"""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise ReportError("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인 후 백엔드를 다시 시작하세요)")
    model = os.environ.get("GEMINI_MODEL") or GEMINI_DEFAULT_MODEL
    body = json.dumps(
        {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": GEMINI_MAX_TOKENS,
                "responseMimeType": "application/json",
                "responseSchema": _gemini_schema(REPORT_TOOL["input_schema"]),
            },
        }
    ).encode("utf-8")
    headers = {"Content-Type": "application/json", "x-goog-api-key": key}
    url = GEMINI_URL.format(model=model)

    def real_post(url, headers, body):
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=_timeout()) as res:
            return json.loads(res.read().decode("utf-8"))

    try:
        data = (post or real_post)(url, headers, body)
    except urllib.error.HTTPError as e:
        # 키가 틀렸거나(400/403) 무료 한도를 넘었을 때(429)의 이유를 그대로 보여 준다. 키 값은 메시지에 넣지 않는다
        detail = e.read().decode("utf-8", "replace")[:300]
        raise ReportError(f"AI 호출에 실패했습니다 (Gemini HTTP {e.code}: {detail})") from e
    except Exception as e:
        raise ReportError(f"AI 호출에 실패했습니다 ({type(e).__name__}: {e})") from e
    try:
        cand = data["candidates"][0]
        if cand.get("finishReason") == "MAX_TOKENS":
            raise ReportError("AI 응답이 길어서 중간에 잘렸습니다. 다시 시도해 주세요")
        return json.loads(cand["content"]["parts"][0]["text"])
    except ReportError:
        raise
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise ReportError("AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요") from e


def generate_report(graph: SubstationGraph, result: SimulationResult, client=None, audience: str = DEFAULT_AUDIENCE) -> Report:
    """계통 정보(설비 이름·종류·연결)와 해석 수치(전압 pu, 선로 부하율, 고장전류, 역조류, 피더별 송출 전력)를
    구조화된 텍스트로 만들어 LLM에 넣고, 비전문가도 이해할 수 있는 3단계 리포트로 돌려받는다.

    audience: "expert"(전문가용, 기본) 또는 "plain"(쉬운 설명). 판정과 수치는 같고 말투·용어 수준만 다르다.
    client: 테스트용 (anthropic.Anthropic과 같은 messages.create를 가진 객체). 없으면 환경 변수로 만든다."""
    if not result.converged:
        raise ReportError("계산이 수렴하지 않은 결과로는 리포트를 만들 수 없습니다")
    return _ask(system_prompt(audience), build_prompt(graph, result), result.substation_id, client)


def _ask(system: str, prompt: str, substation_id: str, client=None) -> Report:
    """시스템 프롬프트와 입력으로 LLM을 불러 Report(진단·원인·솔루션)를 받는다. AI_PROVIDER로 Gemini·Claude를 고른다 (모든 리포트 공통)"""
    if os.environ.get("AI_PROVIDER", "anthropic").strip().lower() == "gemini":
        return _build_report(_call_gemini(prompt, system=system), substation_id)
    client = client or _make_client()
    try:
        response = client.messages.create(
            model=os.environ.get("ANTHROPIC_MODEL") or DEFAULT_MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            tools=[REPORT_TOOL],
            tool_choice={"type": "tool", "name": TOOL_NAME},
            messages=[{"role": "user", "content": prompt}],
        )
    except ReportError:
        raise
    # ponytail: 자동 재시도 없이 오류를 그대로 사용자에게 알린다 (SDK가 네트워크 오류는 2회 재시도함). 실패가 잦으면 오류 종류별로 나눈다
    except Exception as e:  # 네트워크·인증·한도 등 API 오류는 종류와 상관없이 같은 방식으로 알린다
        raise ReportError(f"AI 호출에 실패했습니다 ({type(e).__name__}: {e})") from e
    return _parse(response, substation_id)


# ── 유스케이스 1: 신규 태양광 연계 검토 → AI 추천 ──
# 연계 가능량·막는 원인·필요 허용전류는 simulation/der.py(안진성)가 계산한 값을 그대로 쓴다. AI는 설명과 추천만 한다
_HOSTING_TASK = f"""[이번 작업: 태양광 연계 검토 추천. 이 지침이 위 지침보다 우선합니다]
사용자가 한 접속점에 태양광을 새로 붙일 수 있는지 코드가 계산한 결과를 줍니다. 리포트 형식(진단·원인·솔루션)은 같고 내용은 아래처럼 쓰세요.
- 진단: 신청 용량을 붙일 수 있는지(가능/불가) → 지금 최대 몇 kW까지 되는지 → 무엇이 막는지를 2~4문장으로.
- 원인: 막는 원인마다 항목 하나. 어느 선로·접속점·차단기가 기준을 얼마나 넘는지, 태양광이 늘면 왜 그렇게 되는지(남는 전기가 변전소 쪽으로 거꾸로 많이 흘러 선로가 감당 못 함, 전압이 올라감 등)를 쓰세요. 막는 원인이 없으면 "검토 상한까지 기준 안"이라고 쓰세요.
- 솔루션: 우선순위 순서. 과부하 선로는 "○○ 선로 허용전류를 지금 ○○ A에서 ○○ A 이상으로 증강(더 굵은 전선으로 교체)"처럼 입력의 필요 허용전류를 그대로 인용하세요. 과전압은 전압 조정·태양광 출력 제한·연계 지점 변경을, 차단기는 정격 상향을 "검토"로 쓰세요. 신청 용량이 가능하면 "연계 가능, 연계 후 다시 시뮬레이션으로 확인"처럼 쓰세요.
- 이 검토에서는 입력에 적힌 kW·A·pu 숫자를 그대로 써도 됩니다(쉬운 설명이면 숫자 뒤에 쉬운 뜻을 붙이세요). 새로 계산하거나 반올림을 바꾸지 마세요.
- 허용전류·차단기 정격이 가정값이면 그 결과에 "가정값 기준"이라고 밝히세요. 역조류 자체는 문제가 아닙니다(선로 용량 이내·차단기 차단 가능이면 정상).
- 계산으로 확인하지 않은 조치(전압 조정, 출력 제한 등)는 효과를 약속하지 말고 "검토"로 쓰세요. 선로 증강은 필요 허용전류 이상이면 위반이 풀린다는 계산 결과이므로 그대로 써도 됩니다."""


def hosting_system_prompt(audience: str = "expert") -> str:
    return f"{system_prompt(audience)}\n\n{_HOSTING_TASK}"


def _names(graph: SubstationGraph) -> dict[str, str]:
    return {n.id: n.name for n in graph.nodes} | {line.id: line.name for line in graph.lines} | {f.id: f.name for f in graph.feeders}


def _violation_text(graph: SubstationGraph, v) -> str:
    """simulation/der.py의 Violation 하나를 사람이 읽는 문장으로 (이름·기준·필요 허용전류 포함)"""
    name = _names(graph).get(v.element_id, v.element_id)
    if v.kind == "overload":
        line = next((x for x in graph.lines if x.id == v.element_id), None)
        rated = line.rated_current_a if line and line.rated_current_a is not None else None
        now = f"{rated:.0f} A" if rated is not None else f"{DEFAULT_RATED_CURRENT_A:.0f} A (가정값)"
        need = f", 필요 허용전류 {math.ceil(v.required_rated_current_a):,} A 이상" if v.required_rated_current_a else ""
        pct = f"{v.value:.2f}" if v.value < v.limit + 1 else f"{v.value:.0f}"  # 100.02%가 "100%"로 보여 기준 안처럼 읽히지 않게
        return f"{name}: 선로 과부하, 부하율 {pct}% (기준 {v.limit:.0f}% 초과), 지금 허용전류 {now}{need}"
    if v.kind == "overvoltage":
        return f"{name}: 접속점 과전압, {v.value:.3f} pu (기준 {v.limit} pu 초과)"
    return f"{name}: 출구 차단기 차단 불가, 고장전류 {v.value:.2f} kA > 정격 {v.limit:.0f} kA (가정값)"


_SUMMARY_ROWS = (  # simulation/der.py의 DerSummary 항목: (이름, 필드, 표시 형식)
    ("분산전원 출력 합", "der_kw", "{:,.0f} kW"),
    ("피더 송출 합 (음수면 역송)", "feeder_kw", "{:,.0f} kW"),
    ("선로 손실", "loss_kw", "{:,.1f} kW"),
    ("최저 전압", "min_voltage_pu", "{:.3f} pu"),
    ("최고 전압", "max_voltage_pu", "{:.3f} pu"),
    ("최대 선로 부하율", "max_loading_pct", "{:.0f}%"),
    ("역조류 선로 수", "reverse_flow_lines", "{}개"),
    ("최대 고장전류 (3상·1선·2선 중)", "max_fault_ka", "{:.2f} kA"),
)


def _compare_rows(before, after, left: str, right: str) -> list[str]:
    rows = [f"| 항목 | {left} | {right} |", "| --- | --- | --- |"]
    for label, attr, fmt in _SUMMARY_ROWS:
        rows.append(f"| {label} | {fmt.format(getattr(before, attr))} | {fmt.format(getattr(after, attr))} |")
    return rows


def build_hosting_prompt(graph: SubstationGraph, hosting, trial: tuple | None = None, der: tuple | None = None, at: str = "최대 조건") -> str:
    """연계 검토 결과(simulation/der.py의 HostingCapacity)와 전후 비교(DerSummary 쌍)를 AI 입력 글로 만든다.
    trial: (지금, 신청 용량을 붙인 뒤), der: (분산전원 전부 뺌, 지금). 둘 다 없어도 된다"""
    names = _names(graph)
    bus = names.get(hosting.bus_id, hosting.bus_id)
    lines = [f"# 태양광 연계 검토 ({graph.substation.name})", f"- 연계할 접속점: {bus}", f"- 검토 시각: {at}",
             f"- 연계 기준: 접속점 전압 {VOLTAGE_MAX_PU} pu 이하, 선로 부하율 {OVERLOAD_PCT:.0f}% 이하, 출구 차단기 차단 가능"
             f"(정격 {DEFAULT_BREAKER_INTERRUPT_KA:.0f} kA 가정값). 역조류 자체는 문제 아님", ""]
    lines.append("## 결과 (코드가 계산한 사실. 그대로 쓰세요)")
    if hosting.max_kw <= 0:
        lines.append("- 더 붙일 수 있는 최대 출력: 0 kW (지금 계통이 이미 기준을 넘었거나 조금도 붙일 수 없음)")
    elif not hosting.limited_by:
        lines.append(f"- 더 붙일 수 있는 최대 출력: {hosting.max_kw:,.0f} kW 이상 (검토 상한까지 기준 안)")
    else:
        lines.append(f"- 더 붙일 수 있는 최대 출력: {hosting.max_kw:,.0f} kW")
    lines.append("- 최대치를 넘기면 막는 원인: " + ("; ".join(_violation_text(graph, v) for v in hosting.limited_by) or "없음"))
    if hosting.target_kw is not None:
        ok = not hosting.target_violations
        lines.append(f"- 신청 용량 {hosting.target_kw:,.0f} kW: " + ("연계 가능 (기준 위반 없음)" if ok else f"연계 불가 (위반 {len(hosting.target_violations)}건)"))
        for v in hosting.target_violations:
            lines.append(f"  - {_violation_text(graph, v)}")
    lines.append("")
    if trial:
        lines.append(f"## 신청 용량을 붙였을 때 전후 ({bus})")
        lines += _compare_rows(trial[0], trial[1], "지금", "붙인 뒤")
        lines.append("")
    if der:
        lines.append("## 지금 있는 태양광·풍력 전체의 연결 전후")
        lines += _compare_rows(der[0], der[1], "분산전원 없음", "지금")
        lines.append("")
    assumptions = _assumptions(graph)
    if assumptions:
        lines.append("## 가정값")
        lines += [f"- {a}" for a in assumptions]
        lines.append("")
    lines.append("위 정보로 연계 가능 여부(진단), 막는 원인(원인), 보강 추천(솔루션)을 제출하세요.")
    return "\n".join(lines)


def generate_hosting_report(graph: SubstationGraph, hosting, trial: tuple | None = None, der: tuple | None = None,
                            at: str = "최대 조건", audience: str = "expert", client=None) -> Report:
    """유스케이스 1 ⑤ "AI 추천": 연계 가능량·막는 원인·필요 허용전류를 받아 연계 가능 여부와 보강 추천을 쓴다"""
    return _ask(hosting_system_prompt(audience), build_hosting_prompt(graph, hosting, trial, der, at), graph.substation.id, client)


# ── 유스케이스 2: 고른 날 24시간 결과 → 시간대별 위험과 대비 조치 (AI 운영 권고) ──
# 시간대별 수치·위험 시간대는 코드가 계산하고(check_findings를 시간마다 적용), AI는 묶어서 설명하고 대비 조치를 권고한다
_DAILY_TASK = """[이번 작업: 하루 24시간 운영 권고. 이 지침이 위 지침보다 우선합니다]
사용자가 고른 날 0~23시를 시간마다 시뮬레이션한 결과와, 코드가 정리한 시간대별 위험을 줍니다. 리포트 형식(진단·원인·솔루션)은 같고 내용은 아래처럼 쓰세요.
- 진단(하루 요약, 3~5문장): 하루 중 가장 위험한 시간대와 구간 1~2개 → 태양광이 가장 많은 시각과 전기를 가장 많이 쓰는 시각 → 그 밖의 시간은 괜찮은지.
- 원인(시간대별 위험): 위험 시간대마다 항목 하나. "11~14시: 태양광이 많고 사용량이 적어 ○○ 선로에 전기가 거꾸로 흐르고 전압이 올라감 (최고 1.048 pu, 12시, ○○)"처럼 시간대 → 이유 → 최악 값·시각·위치 순서로 쓰세요.
- 솔루션(대비 조치): 원인과 하나씩 대응. 전압조정기 탭 조정, 태양광 출력 제한, 개폐기 전환·부하 절체, ESS 충방전 시간 조정처럼 운영자가 그 시간대에 할 수 있는 조치를 쓰세요. 이 조치들은 시뮬레이션으로 확인한 것이 아니므로 반드시 "검토"로 쓰고 효과를 약속하지 마세요.
- 위험 시간대가 없으면 원인에 "하루 내내 기준 안"을 근거 수치와 함께 쓰고, 솔루션에는 평상 운영과 다시 점검할 시점만 쓰세요.
- 이 작업에서는 입력에 적힌 kW·pu·% 숫자와 시각을 그대로 써도 됩니다(쉬운 설명이면 숫자 뒤에 쉬운 뜻을 붙이세요). 새로 계산하지 마세요.
- 배율은 실측이 아니라 가상 패턴이라는 점을 진단 끝에 한 번 밝히세요."""

_DAILY_ITEMS = (  # (check_findings 키, 이름, 값 형식)
    ("low", "저전압(0.95 pu 미만)", "{:.3f} pu"),
    ("high", "과전압(1.05 pu 초과)", "{:.3f} pu"),
    ("overload", "선로 과부하(100% 초과)", "{:.0f}%"),
    ("watch", "부하율 높음(80~100%)", "{:.0f}%"),
    ("reverse", "기준 초과 역조류", "{:.0f} kW"),
    ("reverse_ok", "정상 역조류(문제 아님)", "{:.0f} kW"),
    ("fault", "단락용량 300 MVA 초과", "{:.0f} MVA"),
)


def _hour_ranges(hours: list[int]) -> str:
    """[11, 12, 13, 19] → "11~13시, 19시" """
    out, start = [], None
    for i, h in enumerate(hours):
        if start is None:
            start = h
        if i == len(hours) - 1 or hours[i + 1] != h + 1:
            out.append(f"{start}~{h}시" if start != h else f"{h}시")
            start = None
    return ", ".join(out)


def daily_summary(graph: SubstationGraph, daily) -> list[str]:
    """simulation/daily.py의 DailyResult → AI 입력용 시간대별 표와 위험 시간대 (숫자는 모두 코드가 계산)"""
    from simulation.daily import scaled_graph  # 배율 곱한 계통 (시간마다 kW·이름)

    rows = ["| 시각 | 태양광 kW | 부하 kW | 피더 송출 kW | 최저 전압 pu | 최고 전압 pu | 최대 부하율 | 역조류(기준 초과/정상) | 등급 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    found: dict[str, list[tuple[int, str, float]]] = {k: [] for k, _, _ in _DAILY_ITEMS}
    outage_hours, peaks = [], {}
    for h in daily.hours:
        g = scaled_graph(graph, h.load_mult, h.pv_mult)
        r = h.result
        pv = sum(n.p_kw for n in g.nodes if n.type == "pv" and n.p_kw is not None)
        load = sum(n.p_kw for n in g.nodes if n.type == "load" and n.p_kw is not None)
        send = sum(f.p_kw for f in r.feeders)
        volts = [x.voltage_pu for x in r.nodes if x.energized]
        loads = [x.loading_pct for x in r.lines if x.loading_pct is not None]
        f = check_findings(g, r)
        rows.append(f"| {h.hour}시 | {pv:,.0f} | {load:,.0f} | {send:,.0f} | {min(volts, default=0):.3f} | {max(volts, default=0):.3f} | "
                    f"{max(loads, default=0):.0f}% | {len(f['reverse'])}/{len(f['reverse_ok'])} | {f['grade']} |")
        for key, _, _ in _DAILY_ITEMS:
            for name, value in f[key]:
                found[key].append((h.hour, name, value))
        if f["outage"]:
            outage_hours.append(h.hour)
        for key, value in (("태양광 최대", pv), ("부하 최대", load), ("피더 송출 최소(역송 쪽)", -send)):
            if key not in peaks or value > peaks[key][1]:
                peaks[key] = (h.hour, value)
    out = ["## 시간대별 결과 (코드가 계산한 값)", *rows, "", "## 위험 시간대 (코드가 정리한 사실. 그대로 쓰세요)"]
    for key, label, fmt in _DAILY_ITEMS:
        items = found[key]
        if not items:
            out.append(f"- {label}: 없음")
            continue
        worst = (min if key == "low" else max)(items, key=lambda x: x[2] if key != "reverse" and key != "reverse_ok" else -x[2])
        hours = sorted({x[0] for x in items})
        places = sorted({x[1] for x in items})
        out.append(f"- {label}: {_hour_ranges(hours)} (최악 {fmt.format(worst[2])}, {worst[0]}시, {worst[1]}; 해당 위치 {', '.join(places[:5])}"
                   + (f" 외 {len(places) - 5}곳" if len(places) > 5 else "") + ")")
    out.append(f"- 정전: {_hour_ranges(outage_hours) if outage_hours else '없음'}")
    out.append(f"- 태양광이 가장 많은 시각: {peaks['태양광 최대'][0]}시 ({peaks['태양광 최대'][1]:,.0f} kW)")
    out.append(f"- 전기를 가장 많이 쓰는 시각: {peaks['부하 최대'][0]}시 ({peaks['부하 최대'][1]:,.0f} kW)")
    out.append(f"- 피더 송출이 가장 작은 시각: {peaks['피더 송출 최소(역송 쪽)'][0]}시 ({-peaks['피더 송출 최소(역송 쪽)'][1]:,.0f} kW, 음수면 변전소 쪽으로 역송)")
    return out


def build_daily_prompt(graph: SubstationGraph, daily) -> str:
    p = daily.profile
    src = f" (배율은 {p.source_date} 값을 씀)" if p.source_date != p.date else ""
    lines = [f"# 하루 운영 점검 ({graph.substation.name})", f"- 날짜: {p.name}{src}", f"- 배율: {p.note}", ""]
    lines += daily_summary(graph, daily)
    assumptions = _assumptions(graph)
    if assumptions:
        lines += ["", "## 가정값", *[f"- {a}" for a in assumptions]]
    lines += ["", "위 정보로 하루 요약(진단), 시간대별 위험(원인), 대비 조치(솔루션)를 제출하세요."]
    return "\n".join(lines)


def generate_daily_report(graph: SubstationGraph, daily, audience: str = "expert", client=None) -> Report:
    """유스케이스 2 ⑥ "AI 운영 권고": 고른 날 24시간 결과(simulation/daily.py의 DailyResult)로 시간대별 위험과 대비 조치를 쓴다"""
    return _ask(f"{system_prompt(audience)}\n\n{_DAILY_TASK}", build_daily_prompt(graph, daily), graph.substation.id, client)


# ── 유스케이스 3: 여러 날 24시간 결과 → 선로 순위 → 증강 순서 권고 ──
# ponytail: 순위는 (100% 초과 시간 수, 최대 부하율) 순서로 단순 정렬한다. 비용·공사 기간 같은 기준이 생기면 점수제로 바꾼다
_REINFORCE_TASK = """[이번 작업: 설비 보강 우선순위. 이 지침이 위 지침보다 우선합니다]
사용자가 여러 날의 24시간 결과로 코드가 매긴 선로 순위와 예산(증강할 수 있는 선로 수)을 줍니다. 리포트 형식(진단·원인·솔루션)은 같고 내용은 아래처럼 쓰세요.
- 진단(요약, 2~4문장): 어떤 날들을 봤는지 → 기준(100%)을 넘는 선로가 있는지 → 예산 안에서 먼저 증강할 선로.
- 원인(선로별 위험): 순위 위쪽 선로마다 항목 하나. 최대 부하율과 그 날·시각, 기준 초과 시간 수, 왜 그 선로에 전기가 몰리는지(변전소 가까운 간선이라 아래쪽 전기를 다 실어 나름, 태양광 역송이 몰림 등 입력으로 알 수 있는 만큼)를 쓰세요.
- 솔루션(증강 순서 권고): 순위대로 "1순위 ○○: 허용전류를 지금 ○○ A에서 ○○ A 이상으로 증강"처럼 입력의 필요 허용전류를 그대로 인용하세요. 예산 밖 선로는 감시 대상으로 쓰세요. 마지막에 "증강 후 허용전류를 바꿔 다시 시뮬레이션해 연계 가능량이 얼마나 느는지 확인"을 권하세요.
- 기준(100%)을 넘는 선로가 하나도 없으면 "올해 증강이 꼭 필요한 선로는 없음"이라고 쓰고, 솔루션은 "1순위 증강"이 아니라 순위 위쪽 선로를 "우선 감시 대상"(최대 부하율과 그때를 인용)으로 쓰세요. 이때 허용전류를 "유지하라"는 문장은 쓰지 마세요. 80% 이상 시간이 있는 선로는 다음 해 증강 후보로 쓰세요.
- 코드가 매긴 순위를 바꾸지 마세요. 입력의 kW·A·% 숫자는 그대로 써도 됩니다(쉬운 설명이면 숫자 뒤에 쉬운 뜻을 붙이세요). 허용전류가 가정값이면 "가정값 기준"이라고 밝히세요."""


def rank_lines(graph: SubstationGraph, dailies: list) -> list[LineRank]:
    """여러 날의 DailyResult로 선로(차단기·개폐기 연결 제외)마다 최대 부하율·기준 초과 시간을 세어 순위를 매긴다"""
    lines = {x.id: x for x in graph.lines if x.kind != "switch"}
    stat: dict[str, dict] = {lid: {"max": 0.0, "date": "", "hour": 0, "over": 0, "watch": 0} for lid in lines}
    for daily in dailies:
        for h in daily.hours:
            for r in h.result.lines:
                if r.line_id not in stat or r.loading_pct is None:
                    continue
                st = stat[r.line_id]
                if r.loading_pct > st["max"]:
                    st.update(max=r.loading_pct, date=str(daily.profile.date), hour=h.hour)
                st["over"] += r.loading_pct > OVERLOAD_PCT
                st["watch"] += r.loading_pct >= LOADING_WATCH_PCT
    out = []
    for lid, st in stat.items():
        line = lines[lid]
        rated = line.rated_current_a if line.rated_current_a is not None else DEFAULT_RATED_CURRENT_A
        out.append(LineRank(line_id=lid, name=line.name, max_loading_pct=st["max"], worst_date=st["date"], worst_hour=st["hour"],
                            hours_over=st["over"], hours_watch=st["watch"], rated_current_a=line.rated_current_a,
                            required_rated_current_a=rated * st["max"] / 100))
    out.sort(key=lambda x: (-x.hours_over, -x.max_loading_pct))
    return out


def build_reinforcement_prompt(graph: SubstationGraph, dailies: list, ranking: list[LineRank], budget_lines: int) -> str:
    days = ", ".join(d.profile.name for d in dailies)
    lines = [f"# 설비 보강 우선순위 ({graph.substation.name})", f"- 점검한 날: {days} (날마다 0~23시)",
             f"- 예산: 선로 {budget_lines}개 증강 가능", f"- 기준: 부하율 {OVERLOAD_PCT:.0f}% 초과면 과부하, {LOADING_WATCH_PCT}% 이상이면 주의", "",
             "## 선로 순위 (코드가 계산. 순위를 바꾸지 마세요)",
             "| 순위 | 선로 | 최대 부하율 | 그때 | 100% 초과 시간 | 80% 이상 시간 | 지금 허용전류 | 필요 허용전류(최대 부하율 100% 이하) |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for i, x in enumerate(ranking[:MAX_FAULT_LISTED], 1):
        now = f"{x.rated_current_a:.0f} A" if x.rated_current_a is not None else f"{DEFAULT_RATED_CURRENT_A:.0f} A (가정값)"
        need = f"{math.ceil(x.required_rated_current_a):,} A 이상" if x.max_loading_pct > OVERLOAD_PCT else "증강 불필요 (기준 안)"
        lines.append(f"| {i} | {x.name} | {x.max_loading_pct:.0f}% | {x.worst_date} {x.worst_hour}시 | {x.hours_over} | {x.hours_watch} | {now} | {need} |")
    assumptions = _assumptions(graph)
    if assumptions:
        lines += ["", "## 가정값", *[f"- {a}" for a in assumptions]]
    lines += ["", "위 정보로 요약(진단), 선로별 위험(원인), 증강 순서 권고(솔루션)를 제출하세요."]
    return "\n".join(lines)


def generate_reinforcement_report(graph: SubstationGraph, dailies: list, budget_lines: int = 2, audience: str = "expert",
                                  client=None) -> ReinforcementReport:
    """유스케이스 3 ④ "AI 정리": 선로 순위(코드)와 증강 순서 권고(AI)를 함께 돌려준다"""
    ranking = rank_lines(graph, dailies)
    prompt = build_reinforcement_prompt(graph, dailies, ranking, budget_lines)
    report = _ask(f"{system_prompt(audience)}\n\n{_REINFORCE_TASK}", prompt, graph.substation.id, client)
    return ReinforcementReport(ranking=ranking, report=report)


def _sample() -> tuple[SubstationGraph, SimulationResult]:
    """자체 점검용 작은 계통: 말단 저전압, 과부하 선로, 태양광 역조류, 정전 구간이 모두 있다"""
    from cim.models import Feeder, Line, Node, Substation
    from simulation.models import FeederResult, LineResult, NodeResult

    s = "S1"

    def node(i, name, t, **kw):
        return Node(id=i, substation_id=s, feeder_id=None if t == "source" else "F1", name=name, type=t, x=0, y=0, **kw)

    def line(i, name, a, b, km, kind="line"):
        return Line(id=i, substation_id=s, feeder_id="F1", name=name, kind=kind, from_node_id=a, to_node_id=b, length_km=km, r_ohm_per_km=0.32, x_ohm_per_km=0.38)

    graph = SubstationGraph(
        substation=Substation(id=s, name="샘플 변전소"),
        feeders=[Feeder(id="F1", substation_id=s, name="샘플 피더 1")],
        nodes=[
            node("src", "전원 1", "source", bus_id="b0"),
            node("b0", "접속점 0", "bus"),
            node("cb", "차단기 1", "breaker"),
            node("b1", "접속점 1", "bus"),
            node("b2", "접속점 2", "bus"),
            node("sw", "개폐기 1", "switch", is_open=True),
            node("b3", "접속점 3", "bus"),
            node("ld", "부하 1", "load", bus_id="b1", p_kw=1800, q_kvar=500),
            node("pv", "태양광 1", "pv", bus_id="b2", p_kw=900, q_kvar=0),
            node("ld3", "부하 3", "load", bus_id="b2", p_kw=780, q_kvar=100),
            node("ld2", "부하 2", "load", bus_id="b3", p_kw=300, q_kvar=80),
        ],
        lines=[
            line("l0", "연결 0", "b0", "cb", 0, "switch"),
            line("l1", "선로 1", "cb", "b1", 4.0),
            line("l2", "선로 2", "b1", "b2", 9.0),
            line("l3", "선로 3", "b2", "sw", 0.0, "switch"),
            line("l4", "선로 4", "sw", "b3", 2.0),
        ],
    )
    result = SimulationResult(
        substation_id=s, converged=True, loss_kw=186.4,
        feeders=[FeederResult(feeder_id="F1", p_kw=1680, q_kvar=600, breaker_interruptible=True)],
        nodes=[
            NodeResult(node_id="b0", voltage_pu=1.0, fault_current_ka=7.56, ground_fault_current_ka=7.9, double_ground_fault_current_ka=6.8),
            NodeResult(node_id="cb", voltage_pu=1.0, fault_current_ka=7.56, ground_fault_current_ka=7.9, double_ground_fault_current_ka=6.8),
            NodeResult(node_id="b1", voltage_pu=0.982, fault_current_ka=3.1, ground_fault_current_ka=2.6, double_ground_fault_current_ka=2.8),
            NodeResult(node_id="b2", voltage_pu=0.931, fault_current_ka=1.4, ground_fault_current_ka=1.1, double_ground_fault_current_ka=1.3),
            NodeResult(node_id="sw", voltage_pu=0.931, fault_current_ka=1.4, ground_fault_current_ka=1.1, double_ground_fault_current_ka=1.3),
            NodeResult(node_id="b3", voltage_pu=0.0, energized=False),
        ],
        lines=[
            LineResult(line_id="l0", p_kw=1680, q_kvar=600),
            LineResult(line_id="l1", p_kw=1680, q_kvar=600, loading_pct=112.0),
            LineResult(line_id="l2", p_kw=-120, q_kvar=-100, loading_pct=8.0, reverse_flow=True),
            LineResult(line_id="l3", p_kw=0, q_kvar=0),
            LineResult(line_id="l4", p_kw=0, q_kvar=0, loading_pct=0.0),
        ],
    )
    return graph, result


def _load_dotenv(path) -> None:
    """저장소 루트의 .env를 읽어 환경 변수로 넣는다 (이미 설정된 값은 덮어쓰지 않는다).
    ponytail: 자체 점검(python -m ai_report.report)에서만 쓴다. 백엔드는 uvicorn --env-file .env로 읽는다.
    따옴표·export 같은 복잡한 형식은 처리하지 않으니, 필요해지면 python-dotenv를 requirements.txt에 추가한다"""
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key and value and key not in os.environ:
            os.environ[key] = value


if __name__ == "__main__":
    import sys
    from pathlib import Path

    _load_dotenv(Path(__file__).resolve().parents[1] / ".env")

    g, r = _sample()
    assert check_findings(g, r)["grade"] == "위험"  # 과부하·정전이 있으면 화면 진단표와 같이 위험
    print(build_prompt(g, r))
    if "--call" in sys.argv:
        rep = generate_report(g, r)
        print("\n===== 리포트 =====")
        print(rep.diagnosis)
        print("\n[원인]", *rep.causes, sep="\n- ")
        print("\n[솔루션]", *rep.solutions, sep="\n- ")
