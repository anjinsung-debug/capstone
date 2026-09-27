# backend — API 서버

담당: 안진성, 한승우

| 폴더 | 내용 |
|------|------|
| `app/api/` | 라우터 (계통 조회/편집, 시뮬레이션 실행, 리포트 요청) |
| `app/core/` | 설정, Neo4j 연결, 공통 유틸 |
| `app/schemas/` | 요청/응답 모델 |
| `app/services/` | 비즈니스 로직 (`cim`, `simulation`, `ai_report` 모듈 연동) |
| `infra/` | 실행 환경 (Neo4j Docker Compose 등) |
| `tests/` | 테스트 |

주요 기능: FR-02 계통 조회, FR-04 시뮬레이션 실행 요청, FR-06/07 편집·UUID 발급·실시간 저장, FR-08 리포트 생성 요청
