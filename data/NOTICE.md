# data/virtual_substation.json 출처

한전에서 제공한 가상 계통 데이터(https://github.com/1004aiteam-power/open_dss_project 의
`dss_output/korean_dist.dss`, 변전소 1개·배전선로 2개)를 `cim/models.py`의 `SubstationGraph` 형식으로 변환한 것입니다.
한전으로부터 저장소 공개 허락을 받았습니다.

Copyright (c) 2026 1004aiteam-power, MIT License

변환 시 정한 것:
- 부하·PV는 접속점에서 길이 0.001km 인입선으로 분리한 노드로 둠 (노드 하나에 설비 하나)
- 차단기는 전원 → 차단기 → 차단기 출력의 0.001km switch 연결 두 개로 나눔
- PV `p_kw`는 정격의 50% (원본 기본 해석 조건), 단락용량은 원본 단락전류 10kA를 396.6MVA로 환산
- 좌표는 원본에 없어 트리 형태로 새로 배치 (25px 격자)
