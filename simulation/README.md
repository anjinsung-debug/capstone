# simulation — OpenDSS 연동 (FR-03, FR-04)

담당: 안진성

- `converter/` — Neo4j 조회 결과 → OpenDSS 스크립트(`.dss`) 생성
- `runner/` — OpenDSS 실행 및 결과(유효/무효 전력, 전압 등) 추출
- `results/` — 실행 산출물 (git 제외)
- `tests/regression/` — 기준 계통 대비 변환 정확도 회귀 테스트 (허용 오차 기준 명시)
