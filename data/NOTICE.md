# data/ 원본 데이터 출처

한전에서 제공한 가상 계통 데이터입니다 (변전소 1개, 배전선로 2개). 한전으로부터 저장소 공개 허락을 받았습니다.
아래 파일은 https://github.com/1004aiteam-power/open_dss_project (커밋 758b504)에서 **수정 없이** 가져왔습니다.

| 파일 | 내용 |
|---|---|
| `korean_distribution_cim.xml` | CIM16(IEC 61968/61970) RDF/XML. 변전소, 차단기, **1번 배전선로**(이진트리, 선로 11·부하 8·PV 4) |
| `add_feeder2.py` | **2번 배전선로**(빗살, 선로 7·부하 4·PV 1) 데이터. 원본 저장소에서 2번 선로는 CIM XML 없이 이 스크립트 안의 값으로만 존재함 |
| `LICENSE` | 원본 저장소 라이선스 전문 |

Copyright (c) 2026 1004aiteam-power, MIT License (전문은 `LICENSE`)
