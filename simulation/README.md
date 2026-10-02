# simulation — OpenDSS 연동 (FR-03, FR-04)

담당: 안진성

- `converter/` — Neo4j 조회 결과 → OpenDSS 스크립트(`.dss`) 생성
- `runner/` — OpenDSS 실행 및 결과(유효/무효 전력, 전압 등) 추출
- `results/` — 실행 산출물 (git 제외)
- `tests/regression/` — 코드 검증 (필수): 정답이 공개된 IEEE 13-bus 계통을 넣었을 때 결과가 공식 값과 허용 오차 안에서 맞는지 확인.
  변환 코드를 고칠 때마다 실행해서 결과가 틀어지지 않았는지 확인한다. 시뮬레이션은 틀려도 에러 없이 숫자가 나오기 때문에 필요하다
