// 왕산변전소 설비·운전값 (frontend/public/overview/wangsan_22kv.html 그림에 적힌 값을 옮겨 적음, 저장 시점 값)
// 쓰는 곳: components/SubstationInterior3D.jsx (변전소 내부 3D)
// ponytail: 그림 파일이 바뀌면 여기도 손으로 고쳐야 한다. 실시간 값이 필요하면 백엔드에 변전소 설비 API가 있어야 함

export const WANGSAN = {
  name: '왕산변전소',
  bus154: [
    { name: '154kV #1 모선', kv: 161.1 },
    { name: '154kV #2 모선', kv: 161.0 },
  ],
  // 송전선로 (+ = 변전소로 들어옴, − = 나감)
  lines: [
    { name: '혁신 #1 T/L', kind: '지중 XLPE 2000㎟', mw: 25.3, a: 99.9 },
    { name: '혁신 #2 T/L', kind: '지중 XLPE 2000㎟', mw: 34.7, a: 137.1 },
    { name: '가상 #1 T/L', kind: '가공 ACSR 410㎟', mw: -71.2, a: 281.3 },
    { name: '가상 #2 T/L', kind: '가공 ACSR 410㎟', mw: -93.8, a: 370.4 },
  ],
  // 주변압기 154/23kV (HV 161.0 kV, LV 23.2 kV)
  transformers: [
    { name: 'M.Tr #1', mw: 24.0, pct: 42.1, hvA: 94.8, lvA: 633.6, maker: 'HD현대일렉트릭', model: 'TR-154-E60', made: '1999.01' },
    { name: 'M.Tr #2', mw: 26.0, pct: 45.6, hvA: 102.7, lvA: 686.4, maker: 'HD현대일렉트릭', model: 'TR-154-F61', made: '2019.08' },
    { name: 'M.Tr #3', mw: 28.0, pct: 49.1, hvA: 110.6, lvA: 739.2, maker: 'HD현대일렉트릭', model: 'TR-154-A62', made: '2007.04' },
    { name: 'M.Tr #4', mw: 27.0, pct: 47.4, hvA: 106.7, lvA: 712.8, maker: '효성중공업', model: 'TR-154-B63', made: '2004.06' },
  ],
  // 22.9kV 배전반: 상단 모선(#40~#43, M.Tr #1·#2) / 하단 모선(#45~#48, M.Tr #3·#4)
  // a: 전류(A), 없으면 소내변압기(S.Tr)·분로 콘덴서(Sh.C) 같은 설비
  feeders: {
    upper: [
      { name: '풍암 D/L', no: '437', a: 97.7 },
      { name: '신가 D/L', no: '447', a: 166.3 },
      { name: '용봉 D/L', no: '457', a: 95.0 },
      { name: '노안 D/L', no: '467', a: 169.0 },
      { name: '상무 D/L', no: '477', a: 104.3 },
      { name: '#1 S.Tr', no: '4189', a: 1.3, aux: true },
      { name: '#1 Sh.C', no: '4179', aux: true },
      { name: '빛가람 D/L', no: '487', a: 153.1 },
      { name: '학동 D/L', no: '497', a: 158.4 },
      { name: '용전 D/L', no: '4A7', a: 95.0 },
      { name: '학교 D/L', no: '4B7', a: 184.8 },
      { name: '대덕 D/L', no: '4C7', a: 93.7 },
      { name: '#2 S.Tr', no: '4289', a: 1.3, aux: true },
      { name: '#2 Sh.C', no: '4279', aux: true },
    ],
    lower: [
      { name: '창평 D/L', no: '4D7', a: 81.8 },
      { name: '장성 D/L', no: '4F7', a: 147.8 },
      { name: '송정 D/L', no: '4G7', a: 89.8 },
      { name: '남평 D/L', no: '4H7', a: 169.0 },
      { name: '다시 D/L', no: '4J7', a: 126.7 },
      { name: '영산포 D/L', no: '4K7', a: 124.1 },
      { name: '#3 Sh.C', no: '4379', aux: true },
      { name: '삼계 D/L', no: '4L7', a: 253.4 },
      { name: '수완 D/L', no: '4M7', a: 161.0 },
      { name: '세지 D/L', no: '4N7', a: 182.2 },
      { name: '도곡 D/L', no: '4P7', a: 116.2 },
      { name: '#4 Sh.C', no: '4479', aux: true },
    ],
  },
}

// 배전선로 전류 → 색 (22.9kV 일반 배전선로 상시 허용 약 400A 기준의 대략적인 구분)
export const FEEDER_RATED_A = 400
