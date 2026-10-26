# data/ 원본 데이터 출처

한전에서 제공한 가상 계통 데이터입니다 (변전소 1개, 배전선로 1개). 한전으로부터 저장소 공개 허락을 받았습니다.
아래 파일은 https://github.com/1004aiteam-power/open_dss_project (커밋 758b504)에서 **수정 없이** 가져왔습니다.

| 파일 | 내용 |
|---|---|
| `korean_distribution_cim.xml` | CIM16(IEC 61968/61970) RDF/XML. 변전소, 차단기, 배전선로 1개(이진트리, 선로 11·부하 8·PV 4). 원본 저장소의 2번 배전선로는 CIM XML에 없어 사용하지 않음 |
| `profile_2025.csv` | 하루(24시간) 시뮬레이션용 2025년 1년치(8760시간) 시간대별 배율. 원본 저장소의 `load_8760.csv`(부하, 연중 최대 1.0)·`pv_8760.csv`(태양광, 설비용량 대비) 값을 그대로 옮기고 날짜·시각 열(`date`, `hour`)만 붙임. 원본에 "가상 데이터, 실측 아님"이라고 적혀 있음 |
| `LICENSE` | 원본 저장소 라이선스 전문 |

Copyright (c) 2026 1004aiteam-power, MIT License (전문은 `LICENSE`)
