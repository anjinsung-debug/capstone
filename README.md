# 배전계통 통합 분석 플랫폼 (CIM · Neo4j · OpenDSS · LLM)

> **팀 으라차차** — 안진성, 고영민, 최민준, 한승우

CIM 표준 기반 배전계통 데이터를 Neo4j(Graph DB)에 적재하고, OpenDSS 시뮬레이션 결과를 웹 단선도에 오버레이로 표시하며,
LLM이 **진단 → 원인 → 대안** 리포트를 자동 생성하는 통합 플랫폼입니다.

## 전체 흐름

```
한전 22.9kV 데이터 ──(FR-01)──▶ CIM 매핑 ──(FR-02)──▶ Neo4j
                                                        │
                        ┌────────────(FR-03)────────────┘
                        ▼
              OpenDSS 스크립트 생성 ──(FR-04)──▶ 조류 계산 / 결과 추출
                                                        │
      웹 단선도 (Cytoscape.js) ◀──(FR-05)── 결과 오버레이 ◀┘
         │  ▲                                           │
 (FR-06/07) 편집·UUID·실시간 저장                  (FR-08/09) LLM 리포트
```

## 역할별 디렉토리

| 역할 | 경로 | 내용 | 관련 요구사항 | 담당 |
|------|------|------|---------------|------|
| FE | [`frontend/`](frontend/) | 웹 단선도 (Cytoscape.js), 결과 오버레이, 드래그&드롭 편집 | FR-05, FR-06 | 고영민, 최민준 |
| BE | [`backend/`](backend/) | API 서버 (계통 조회/편집, UUID 발급, 시뮬레이션·리포트 연동), 실행 환경 | FR-02, FR-04, FR-06~FR-08 | 안진성, 한승우 |
| 데이터 (CIM/Neo4j) | [`data/`](data/) | 한전 제공 데이터 → CIM 매핑·검증, Neo4j 스키마·적재 | FR-01, FR-02 | 한승우 |
| 시뮬레이션 (OpenDSS) | [`simulation/`](simulation/) | Neo4j → OpenDSS 스크립트 변환, 실행, 결과 추출, 회귀 테스트 | FR-03, FR-04 | 안진성 |
| AI 리포트/프롬프트 | [`ai_report/`](ai_report/) | 결과 수치 → 프롬프트 매핑, LLM 호출, 3단계 리포트 템플릿 | FR-08, FR-09 | 고영민, 최민준 |

> 문서(요구사항 분석서, 설계서, 회의록 등, 담당: 안진성·고영민·한승우)는 [Notion](https://app.notion.com/p/3e88a37a2d348066b4ecce17929f7389)에서 관리합니다.

### 팀원별 담당 폴더

| 팀원 | 담당 폴더 |
|------|-----------|
| 안진성 | `backend/`, `simulation/` |
| 고영민 | `frontend/`, `ai_report/` |
| 최민준 | `frontend/`, `ai_report/` |
| 한승우 | `backend/`, `data/` |

## 디렉토리 구조

```
capstone/
├── frontend/                # [FE] 웹 단선도 — FR-05, FR-06
│   ├── public/              #   정적 파일 (index.html, 아이콘 등)
│   └── src/
│       ├── graph/           #   Cytoscape.js 단선도 렌더링, 스타일·레이아웃
│       ├── overlay/         #   시뮬레이션 결과(유효/무효 전력 등) 오버레이 표시
│       ├── editor/          #   노드/선로 드래그&드롭 편집
│       ├── components/      #   공통 UI 컴포넌트, AI 리포트 뷰어
│       └── api/             #   백엔드 API 호출 클라이언트
│
├── backend/                 # [BE] API 서버 — FR-02, FR-04, FR-06~FR-08
│   ├── app/
│   │   ├── api/             #   라우터 (계통 조회/편집, 시뮬레이션 실행, 리포트 요청)
│   │   ├── core/            #   설정, Neo4j 연결, 공통 유틸
│   │   ├── schemas/         #   요청/응답 데이터 모델
│   │   └── services/        #   비즈니스 로직 (data·simulation·ai_report 모듈 연동)
│   ├── infra/               #   실행 환경 (Neo4j Docker Compose 등)
│   └── tests/               #   테스트
│
├── data/                    # [데이터] CIM 매핑 / Neo4j 적재 — FR-01, FR-02
│   ├── raw/                 #   한전 제공 22.9kV 배전계통 데이터(가공본) (⚠ git 제외)
│   ├── samples/             #   개발·테스트용 가상 샘플 계통 (한전 데이터 금지)
│   ├── mapping/             #   한전 데이터 필드 ↔ CIM 클래스/속성 매핑 테이블
│   ├── converter/           #   한전 데이터 → CIM 변환 코드
│   ├── validation/          #   변환 결과 검증 스크립트, 예외 케이스 목록
│   ├── output/              #   CIM 변환 결과 (CIM XML/RDF, CSV 등) (⚠ git 제외)
│   ├── cypher/              #   Neo4j 스키마·제약조건·인덱스 정의 (.cypher)
│   ├── loader/              #   CIM 데이터 → Neo4j 적재 (위상·연결·좌표 포함)
│   └── tests/               #   테스트
│
├── simulation/              # [시뮬레이션] OpenDSS 연동 — FR-03, FR-04
│   ├── converter/           #   Neo4j 조회 결과 → OpenDSS 스크립트(.dss) 생성
│   ├── runner/              #   OpenDSS 실행, 결과(유효/무효 전력, 전압 등) 추출
│   ├── results/             #   실행 산출물 (git 제외)
│   └── tests/regression/    #   기준 계통 대비 변환 정확도 회귀 테스트
│
├── ai_report/               # [AI] LLM 자동 해설 리포트 — FR-08, FR-09
│   ├── prompts/             #   시뮬레이션 수치 → 프롬프트 매핑 규칙
│   ├── templates/           #   리포트 템플릿 (① 진단 → ② 원인 → ③ 솔루션)
│   ├── client/              #   LLM API 호출 모듈
│   └── tests/               #   테스트
│
├── .env.example             # 환경 변수 양식 (복사해서 .env로 사용)
├── .gitignore               # git 제외 목록 (.env, 한전 데이터, 산출물 등)
└── .gitattributes           # 줄바꿈(LF) 통일 설정
```

> 빈 폴더에 있는 `.gitkeep`은 폴더를 git에 올리기 위한 빈 파일입니다. 폴더에 실제 파일이 생기면 지워도 됩니다.

## 개발 단계

1. **데이터 표준화 / DB 구축** — 한전 제공 22.9kV 데이터 분석 → CIM 매핑 → Neo4j 적재
2. **시뮬레이션 연동** — DB 쿼리 → OpenDSS 스크립트 변환 → 조류 계산 / 결과 추출
3. **웹 시각화** — Cytoscape.js 단선도 → 결과 오버레이
4. **웹 편집 / 동기화** — 드래그&드롭 편집 → UUID 발급 → 실시간 저장
5. **LLM 리포트** — 수치 매핑 → API 호출 → 리포트 생성 / 표출

## 일정 및 산출물

| 기간 | 작업 | 산출물 |
|------|------|--------|
| 9월 | 개발 환경 구축, 요구사항 정의 | 요구사항 분석서 |
| 9월 ~ 10월 | 시스템 구조·UI·DB 설계 | 시스템 설계서 |
| 10월 ~ 11월 | 핵심 기능 구현, FE/BE 개발 | API 정의서, 기능 명세서 |
| 11월 ~ 12월 | 단위 디버깅, 통합 테스트 | 통합 테스트 결과서 |
| 12월 | 최종 시연, 보고서 작성 | 최종 결과 보고서 |

## 시작하기

```bash
git clone https://github.com/anjinsung-debug/capstone.git
cd capstone
cp .env.example .env   # Neo4j 접속 정보, LLM API 키 등 입력
```

> ⚠ **한전 제공 데이터는 외부 공개 금지입니다.** 이 저장소는 공개(public) 상태이므로
> `data/raw/`(한전 데이터)와 `data/output/`(변환 결과), `.env`는 절대 커밋하지 않습니다.
> 데이터 파일은 별도 공유 드라이브로 주고받고, 커밋 전에 `git status`로 데이터 파일이 섞이지 않았는지 확인하세요.

## 참고자료

- IEC 61970 / 61968 Common Information Model (CIM) 표준
- OpenDSS 공식 명령어 매뉴얼
- OpenDSS 동작 원리 및 예시 코드 (GitHub)
