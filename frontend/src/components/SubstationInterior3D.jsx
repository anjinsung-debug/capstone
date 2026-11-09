// 변전소 내부 3D (옥내형 변전소를 앞벽을 잘라낸 단면처럼 보여 줌). 첫 화면(SubstationOverview)의 "3D 내부" 버튼으로 연다
// - 층 구성 (실제 옥내 변전소의 흔한 배치를 단순화):
//   지하 케이블 처리실 → 1층 주변압기실 → 2층 154kV GIS실 → 3층 22.9kV 배전반실 → 4층 제어실 → 옥상 공조기
// - 설비 이름·숫자는 lib/wangsanData.js (왕산변전소 단선도 그림의 저장 시점 값). 계산 결과와는 연결하지 않는다
// - 마우스 올리기: 설비 정보 / 클릭: 그 설비로 시점 이동 / 아래 버튼: 위층을 숨겨 그 층까지만 보기
// ponytail: 층 배치·설비 크기는 실제 왕산변전소 도면이 아니라 일반적인 옥내 변전소 모양이다
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { COLORS, LOADING_WATCH_PCT, OVERLOAD_PCT } from '../lib/overlay.js'
import { box, cyl, glow, insulator, label, mat } from '../lib/threeKit.js'
import { FEEDER_RATED_A, WANGSAN } from '../lib/wangsanData.js'

// 건물 크기 (1 = 약 1 m). 앞(z+)이 잘린 면
const W = 26
const D = 12
const X0 = -W / 2
const CORE_W = 4 // 왼쪽 계단·엘리베이터 자리
const EQ_X0 = X0 + CORE_W + 0.6 // 설비가 놓이기 시작하는 x
const SLAB = 0.3
const FLOORS = [
  { key: 'b1', name: '지하 케이블 처리실', y: -4, h: 4 },
  { key: 'f1', name: '1층 주변압기실 (154/23kV × 4대)', y: 0, h: 5 },
  { key: 'f2', name: '2층 154kV GIS실', y: 5, h: 4.5 },
  { key: 'f3', name: '3층 22.9kV 배전반실', y: 9.5, h: 4 },
  { key: 'f4', name: '4층 제어실 · 옥상 공조기', y: 13.5, h: 3.2 },
]
const SHORT = ['B1', '1F', '2F', '3F', '4F']

const C = {
  concrete: mat('#8d949a', { roughness: 0.9, metalness: 0 }),
  inner: mat('#c9ccc8', { roughness: 0.95, metalness: 0 }),
  floor: mat('#9aa39b', { roughness: 0.85, metalness: 0 }),
  cut: mat('#d9a066', { roughness: 0.8, metalness: 0 }), // 잘린 면 표시
  soil: mat('#6b4f36', { roughness: 1, metalness: 0 }),
  grass: mat('#3f6b3a', { roughness: 1, metalness: 0 }),
  road: mat('#34393d', { roughness: 1, metalness: 0 }),
  tank: mat('#a4b0b5', { metalness: 0.35, roughness: 0.45 }),
  tankDark: mat('#6f7a80', { metalness: 0.4, roughness: 0.5 }),
  gis: mat('#7c5cb0', { metalness: 0.55, roughness: 0.35 }),
  gisDark: mat('#5a3f86', { metalness: 0.5, roughness: 0.4 }),
  panel: mat('#5f8f72', { metalness: 0.35, roughness: 0.5 }),
  panelDark: mat('#41634f', { metalness: 0.3, roughness: 0.55 }),
  tray: mat('#e0b33a', { metalness: 0.4, roughness: 0.5 }),
  cable: mat('#22272b', { roughness: 0.8, metalness: 0 }),
  pipe: mat('#5fb3c9', { metalness: 0.5, roughness: 0.4 }),
  steel: mat('#9aa3a8', { metalness: 0.7, roughness: 0.35 }),
  glass: mat('#8fc6e0', { transparent: true, opacity: 0.25, metalness: 0.1, roughness: 0.1 }),
  desk: mat('#6d5845', { roughness: 0.7, metalness: 0 }),
  trunk: mat('#5a4030', { roughness: 1, metalness: 0 }),
  leaf: mat('#2f7a45', { roughness: 0.9, metalness: 0 }),
  leaf2: mat('#3d8f4f', { roughness: 0.9, metalness: 0 }),
  town: mat('#a7adb3', { roughness: 0.9, metalness: 0 }),
}

// 변압기 이용률 색: 단선도의 선로 색(50% 미만 회색)과 달리 여기서는 80% 미만이면 모두 '여유'(초록)
const trColor = (pct) => (pct > OVERLOAD_PCT ? COLORS.red : pct >= LOADING_WATCH_PCT ? COLORS.orange : COLORS.green)
const feederColor = (f) => (f.aux ? COLORS.blue : f.a / FEEDER_RATED_A > 0.6 ? COLORS.orange : COLORS.green)

function pick(obj, picks, title, lines) {
  obj.userData.info = { title, lines }
  picks.push(obj)
  return obj
}

function tag(text, x, y, z, k = 1, color) {
  const s = label(text, color)
  s.scale.multiplyScalar(k)
  s.position.set(x, y, z)
  return s
}

// 층 이름표: 잘린 면 바로 앞에 띄우고, 바닥판에 가려지지 않게 늘 위에 그린다
function floorTitle(f) {
  const s = tag(f.name, EQ_X0 + 0.4, f.y + 0.9, D / 2 + 0.6, 1.25, '#f0c27a')
  s.center.set(0, 0.5)
  s.material.depthTest = false
  s.renderOrder = 10
  return s
}

// ── 건물 뼈대: 바닥판·뒷벽·옆벽, 잘린 면은 주황 테두리 ──────────────
function shell(floors) {
  const g = new THREE.Group()
  const top = FLOORS[4].y + FLOORS[4].h
  const bottom = FLOORS[0].y
  const H = top - bottom
  // 뒷벽·옆벽 (앞은 비움)
  g.add(box(W, H, 0.4, C.concrete, 0, bottom + H / 2, -D / 2 - 0.2))
  g.add(box(0.4, H, D, C.concrete, X0 - 0.2, bottom + H / 2, 0))
  g.add(box(0.4, H, D, C.concrete, -X0 + 0.2, bottom + H / 2, 0))
  // 안쪽 벽 마감 (밝은 색)
  g.add(box(W - 0.2, H, 0.05, C.inner, 0, bottom + H / 2, -D / 2 + 0.03))
  // 잘린 단면 (앞쪽 벽 끝)
  g.add(box(0.42, H, 0.08, C.cut, X0 - 0.2, bottom + H / 2, D / 2))
  g.add(box(0.42, H, 0.08, C.cut, -X0 + 0.2, bottom + H / 2, D / 2))
  // 각 층 바닥판 (+ 옥상판)
  FLOORS.forEach((f, i) => {
    const slab = box(W + 0.8, SLAB, D, C.floor, 0, f.y - SLAB / 2, 0)
    floors[i].add(slab)
    floors[i].add(box(W + 0.8, SLAB, 0.1, C.cut, 0, f.y - SLAB / 2, D / 2))
  })
  const roof = new THREE.Group()
  roof.add(box(W + 0.8, SLAB, D, C.floor, 0, top + SLAB / 2, 0))
  roof.add(box(W + 0.8, SLAB, 0.1, C.cut, 0, top + SLAB / 2, D / 2))
  // 난간
  roof.add(box(W + 0.8, 0.9, 0.15, C.concrete, 0, top + 0.75, -D / 2))
  roof.add(box(0.15, 0.9, D, C.concrete, X0 - 0.3, top + 0.75, 0))
  roof.add(box(0.15, 0.9, D, C.concrete, -X0 + 0.3, top + 0.75, 0))
  return { g, roof, top }
}

// 왼쪽 코어: 계단 + 엘리베이터 (모든 층을 잇는다)
function core(floors) {
  FLOORS.forEach((f, i) => {
    const grp = floors[i]
    const xw = X0 + CORE_W
    grp.add(box(0.25, f.h, D - 3, C.concrete, xw, f.y + f.h / 2, -1.5)) // 코어 벽 (앞쪽은 출입 통로)
    // 계단 (한 층에 꺾임 한 번)
    const steps = 10
    for (let s = 0; s < steps; s++) {
      const half = s < steps / 2
      const k = half ? s : steps - 1 - s
      grp.add(box(1.4, 0.18, 0.6, C.inner, X0 + (half ? 1.0 : 2.6), f.y + (s + 1) * (f.h / steps) - 0.09, 1.4 - k * 0.6))
    }
    grp.add(box(3.2, 0.15, 1.2, C.inner, X0 + 1.8, f.y + f.h / 2, -1.9)) // 계단참
    // 엘리베이터 통로 (유리)
    grp.add(box(1.8, f.h - 0.1, 1.8, C.glass, X0 + 1.9, f.y + f.h / 2, -4.6))
    if (i === 2) grp.add(box(1.6, 2.2, 1.6, C.steel, X0 + 1.9, f.y + 1.1, -4.6)) // 엘리베이터 칸
  })
}

// 노란 케이블 트레이 (x 방향으로 길게) + 위에 깔린 케이블
function tray(len, x, y, z, cables = 4) {
  const g = new THREE.Group()
  g.add(box(len, 0.05, 0.6, C.tray, 0, 0, 0))
  g.add(box(len, 0.14, 0.04, C.tray, 0, 0.07, 0.3))
  g.add(box(len, 0.14, 0.04, C.tray, 0, 0.07, -0.3))
  for (let i = 0; i < cables; i++) {
    const c = cyl(0.05, 0.05, len, C.cable, 0, 0.08, -0.22 + (i * 0.44) / Math.max(cables - 1, 1), 8)
    c.rotation.z = Math.PI / 2
    g.add(c)
  }
  g.position.set(x, y, z)
  return g
}

// ── 지하: 케이블 처리실 ─────────────────────────────────────────────
function basement(grp, picks) {
  const f = FLOORS[0]
  const len = -X0 - EQ_X0 - 0.4
  const cx = (EQ_X0 - X0) / 2
  for (let lv = 0; lv < 3; lv++) {
    for (const z of [-4.8, -3.2]) grp.add(tray(len, cx, f.y + 1 + lv * 0.9, z, 5))
  }
  // 지지대
  for (let x = EQ_X0; x < -X0; x += 3) {
    for (const z of [-5.3, -2.7]) grp.add(box(0.08, 3, 0.08, C.steel, x, f.y + 1.6, z))
  }
  // 위로 올라가는 수직 트레이 (각 층으로)
  const riser = box(0.6, FLOORS[3].y + FLOORS[3].h - f.y, 0.1, C.tray, EQ_X0 + 0.2, (f.y + FLOORS[3].y + FLOORS[3].h) / 2, -5.6)
  grp.add(riser)
  // 바닥 피트 (케이블 덕트)
  grp.add(box(len, 0.3, 1.2, C.tankDark, cx, f.y + 0.15, 1.5))
  const pit = box(len, 0.32, 0.12, C.tray, cx, f.y + 0.16, 2.15)
  grp.add(pit)
  // 송전 케이블 인입 (T/L 4회선: 땅속에서 들어옴)
  WANGSAN.lines.forEach((l, i) => {
    const p = cyl(0.22, 0.22, 3, C.cable, X0 + CORE_W + 3 + i * 1.2, f.y + 1.8, 3.6, 10)
    p.rotation.x = Math.PI / 2
    grp.add(p)
    pick(p, picks, `${l.name} 케이블 인입`, [l.kind, `${l.mw > 0 ? '+' : ''}${l.mw} MW · ${l.a} A`])
  })
  // 배수 펌프·배관
  grp.add(cyl(0.35, 0.35, 0.9, C.pipe, -X0 - 1.5, f.y + 0.45, 3.5))
  const pp = cyl(0.08, 0.08, f.h - 0.4, C.pipe, -X0 - 1.5, f.y + f.h / 2 + 0.2, 3.5, 8)
  grp.add(pp)
}

// ── 1층: 주변압기 4대 ───────────────────────────────────────────────
function transformer(t, picks) {
  const g = new THREE.Group()
  const col = trColor(t.pct)
  const tank = box(2.8, 2.6, 2.2, C.tank, 0, 1.6, 0)
  g.add(box(3.1, 0.3, 2.5, C.tankDark, 0, 0.15, 0)) // 받침
  g.add(tank)
  g.add(box(2.9, 0.12, 2.3, C.tankDark, 0, 2.95, 0)) // 덮개
  // 방열기 (뒤쪽 핀)
  for (let i = 0; i < 9; i++) g.add(box(0.06, 2.0, 0.9, C.steel, -1.2 + i * 0.3, 1.6, -1.65))
  // 콘서베이터 (위쪽 기름 탱크)
  const cons = cyl(0.32, 0.32, 2.0, C.tank, 0, 3.75, -0.7, 16)
  cons.rotation.z = Math.PI / 2
  g.add(cons)
  g.add(box(0.1, 0.65, 0.1, C.steel, -0.8, 3.3, -0.7))
  g.add(box(0.1, 0.65, 0.1, C.steel, 0.8, 3.3, -0.7))
  // 154kV 부싱 3개 (높은 애자) + 23kV 부싱 3개 (낮은 애자)
  for (let i = 0; i < 3; i++) {
    const b = insulator('#8b5e3c', 8, -0.7 + i * 0.7, 3.0, 0.4)
    g.add(b)
    g.add(insulator('#8b5e3c', 3, -0.7 + i * 0.7, 3.0, 0.95))
  }
  // 부하율 띠 (탱크 둘레)
  g.add(box(2.84, 0.18, 2.24, glow(col, 0.8), 0, 2.6, 0))
  // 명판
  g.add(box(0.7, 0.45, 0.03, glow('#dfe6ea', 0.25), 0.7, 1.4, 1.12))
  pick(tank, picks, `${t.name} 주변압기 154/23kV`, [
    `부하 ${t.mw} MW · 이용률 ${t.pct}%`,
    `1차(154kV) ${t.hvA} A · 2차(23kV) ${t.lvA} A`,
    `${t.maker} ${t.model} · ${t.made} 제작`,
  ])
  g.add(tag(`${t.name}  ${t.mw}MW · ${t.pct}%`, 0, 4.55, 0.6, 0.95, col))
  return g
}

function floor1(grp, picks) {
  const f = FLOORS[1]
  const span = -X0 - EQ_X0
  const step = span / 4
  WANGSAN.transformers.forEach((t, i) => {
    const x = EQ_X0 + step * (i + 0.5)
    const tr = transformer(t, picks)
    tr.position.set(x, f.y, -1.6)
    grp.add(tr)
    if (i > 0) grp.add(box(0.3, f.h - 0.3, 6.5, C.concrete, EQ_X0 + step * i, f.y + (f.h - 0.3) / 2, -2.7)) // 방화벽
    // 바닥 기름받이 (자갈 피트)
    grp.add(box(3.6, 0.06, 3.2, C.tankDark, x, f.y + 0.03, -1.6))
  })
  grp.add(tray(span - 0.4, EQ_X0 + span / 2, f.y + f.h - 0.35, -4.4, 4))
  // 환기 덕트
  const duct = box(span - 0.4, 0.6, 0.8, C.steel, EQ_X0 + span / 2, f.y + f.h - 0.55, -5.3)
  grp.add(duct)
}

// ── 2층: 154kV GIS (보라색 가스절연개폐장치) ───────────────────────
function gisBay(name, lines, picks, isLine) {
  const g = new THREE.Group()
  // 차단기 (세운 원통)
  const cb = cyl(0.42, 0.42, 2.4, C.gis, 0, 1.5, -0.6, 18)
  g.add(cb)
  g.add(cyl(0.48, 0.48, 0.12, C.gisDark, 0, 2.75, -0.6, 18))
  g.add(cyl(0.48, 0.48, 0.12, C.gisDark, 0, 0.3, -0.6, 18))
  // 모선 쪽 단로기 두 개 (모선 #1·#2로)
  for (const z of [-2.2, -3.2]) {
    const ds = cyl(0.2, 0.2, Math.abs(z + 0.6), C.gis, 0, 2.6, (z - 0.6) / 2, 12)
    ds.rotation.x = Math.PI / 2
    g.add(ds)
    g.add(box(0.5, 0.5, 0.5, C.gisDark, 0, 2.6, z))
  }
  // 아래쪽: 선로면 케이블 헤드 (바닥으로 내려감), 변압기면은 덕트
  g.add(cyl(0.22, 0.22, 1.0, isLine ? C.cable : C.gis, 0, 0.5, 0.4, 12))
  const out = cyl(0.2, 0.2, 1.0, C.gis, 0, 1.0, -0.1, 12)
  out.rotation.x = Math.PI / 2
  g.add(out)
  // 현장 제어반
  g.add(box(0.8, 2.0, 0.5, C.steel, 0, 1.0, 1.6))
  g.add(box(0.16, 0.16, 0.02, glow(COLORS.green, 1), -0.15, 1.6, 1.86))
  g.add(box(0.16, 0.16, 0.02, glow(COLORS.red, 0.3), 0.15, 1.6, 1.86))
  // 압력계 (SF6)
  g.add(cyl(0.12, 0.12, 0.05, glow('#ffffff', 0.3), 0.43, 1.8, -0.6, 12).rotateZ(Math.PI / 2))
  pick(cb, picks, `${name} 154kV GIS 구간`, ['SF6 가스절연 차단기 · 단로기·접지개폐기 일체', ...lines])
  return g
}

function floor2(grp, picks) {
  const f = FLOORS[2]
  const span = -X0 - EQ_X0
  // 154kV 모선 두 줄 (뒤쪽 x 방향 관)
  WANGSAN.bus154.forEach((b, i) => {
    const z = -3.8 - i * 1.0
    const pipe = cyl(0.26, 0.26, span - 0.6, C.gis, EQ_X0 + span / 2, f.y + 2.6, z, 16)
    pipe.rotation.z = Math.PI / 2
    grp.add(pipe)
    for (let x = EQ_X0 + 0.8; x < -X0 - 0.5; x += 2.2) grp.add(box(0.12, 2.6, 0.12, C.steel, x, f.y + 1.3, z))
    pick(pipe, picks, b.name, [`전압 ${b.kv} kV`, '모든 GIS 구간이 두 모선 중 하나에 붙는다'])
  })
  grp.add(tag('154kV #1·#2 모선', EQ_X0 + 1.2, f.y + 3.2, -5.2, 0.85, '#c9b3ef'))
  const bays = [
    ...WANGSAN.lines.map((l) => ({ name: l.name, lines: [l.kind, `${l.mw > 0 ? '+' : ''}${l.mw} MW · ${l.a} A (${l.mw > 0 ? '들어옴' : '나감'})`], line: true })),
    ...WANGSAN.transformers.map((t) => ({ name: `${t.name} 1차`, lines: [`${t.mw} MW · ${t.hvA} A`], line: false })),
  ]
  const step = (span - 0.6) / bays.length
  bays.forEach((b, i) => {
    const x = EQ_X0 + 0.3 + step * (i + 0.5)
    const bay = gisBay(b.name, b.lines, picks, b.line)
    bay.position.set(x, f.y, 0)
    grp.add(bay)
    grp.add(tag(b.name.replace(' T/L', ''), x, f.y + 3.5, 0.3, 0.7, b.line ? '#c9b3ef' : '#dfe6ea'))
  })
  // 천장 크레인 레일
  grp.add(box(span - 0.4, 0.25, 0.3, C.tray, EQ_X0 + span / 2, f.y + f.h - 0.3, 3.5))
  grp.add(box(0.4, 0.4, 7.5, C.tray, EQ_X0 + span * 0.62, f.y + f.h - 0.55, -0.2))
  grp.add(tray(span - 0.4, EQ_X0 + span / 2, f.y + f.h - 0.6, 4.8, 3))
}

// ── 3층: 22.9kV 배전반 (초록 함 줄) ─────────────────────────────────
function cubicle(fd, picks) {
  const g = new THREE.Group()
  const col = feederColor(fd)
  const body = box(1.1, 2.3, 1.6, fd.aux ? C.panelDark : C.panel, 0, 1.15, 0)
  g.add(body)
  g.add(box(1.0, 1.1, 0.04, C.panelDark, 0, 0.75, 0.81)) // 차단기 인출 문
  g.add(box(0.6, 0.35, 0.03, glow('#163b2a', 0.6), 0, 1.85, 0.82)) // 계전기 화면
  g.add(box(0.12, 0.12, 0.03, glow(col, 1.1), -0.3, 1.5, 0.83)) // 상태 표시등
  g.add(box(0.12, 0.12, 0.03, glow(COLORS.red, 0.25), -0.1, 1.5, 0.83))
  g.add(box(0.1, 0.25, 0.04, C.steel, 0.38, 0.8, 0.84)) // 손잡이
  pick(body, picks, `${fd.name} (${fd.no})`, [
    fd.aux ? (fd.name.includes('Sh.C') ? '분로 콘덴서 (전압 보상) · 운전' : `소내변압기 · ${fd.a} A`) : `22.9kV 배전선로 · ${fd.a} A`,
    fd.aux ? '변전소 자체 설비' : `상시 허용 ${FEEDER_RATED_A} A 기준 ${Math.round((fd.a / FEEDER_RATED_A) * 100)}%`,
  ])
  return g
}

function floor3(grp, picks) {
  const f = FLOORS[3]
  const span = -X0 - EQ_X0
  const rows = [
    { list: WANGSAN.feeders.upper, z: -4.2, title: '상단 모선 #40~#43 (M.Tr #1·#2)' },
    { list: WANGSAN.feeders.lower, z: -0.4, title: '하단 모선 #45~#48 (M.Tr #3·#4)' },
  ]
  rows.forEach((r) => {
    const w = 1.15
    const x0 = EQ_X0 + 0.5
    r.list.forEach((fd, i) => {
      const c = cubicle(fd, picks)
      c.position.set(x0 + w * (i + 0.5), f.y, r.z)
      grp.add(c)
      if (!fd.aux) {
        const s = tag(fd.name.replace(' D/L', ''), x0 + w * (i + 0.5), f.y + 2.65, r.z + 0.7, 0.55, feederColor(fd))
        grp.add(s)
      }
    })
    // 위쪽 모선 덕트
    grp.add(box(w * r.list.length, 0.3, 0.5, C.panelDark, x0 + (w * r.list.length) / 2, f.y + 2.45, r.z - 0.4))
    grp.add(tag(r.title, x0 + 2.6, f.y + 3.3, r.z + 0.8, 0.75))
  })
  grp.add(tray(span - 0.4, EQ_X0 + span / 2, f.y + f.h - 0.5, 4.6, 5))
}

// ── 4층: 제어실 + 옥상 공조기 ───────────────────────────────────────
function floor4(grp, roof, top) {
  const f = FLOORS[4]
  const span = -X0 - EQ_X0
  // 벽면 큰 화면 (계통 감시)
  grp.add(box(8, 2.0, 0.1, C.cable, EQ_X0 + span / 2, f.y + 1.7, -5.6))
  grp.add(box(7.6, 1.7, 0.05, glow('#1e5f86', 0.9), EQ_X0 + span / 2, f.y + 1.7, -5.52))
  // 책상 두 줄 + 모니터
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 4; i++) {
      const x = EQ_X0 + 3 + i * 3.6
      const z = -2.6 + r * 2.6
      grp.add(box(2.6, 0.08, 1.0, C.desk, x, f.y + 0.78, z))
      grp.add(box(0.08, 0.78, 0.9, C.steel, x - 1.2, f.y + 0.39, z))
      grp.add(box(0.08, 0.78, 0.9, C.steel, x + 1.2, f.y + 0.39, z))
      for (const dx of [-0.6, 0.6]) {
        grp.add(box(0.9, 0.55, 0.05, glow('#3f8fc4', 0.85), x + dx, f.y + 1.15, z - 0.3))
        grp.add(box(0.06, 0.3, 0.06, C.cable, x + dx, f.y + 0.95, z - 0.32))
      }
      grp.add(box(0.55, 0.9, 0.55, C.cable, x, f.y + 0.45, z + 0.9)) // 의자
    }
  }
  // 통신·보호 계전반 (오른쪽 끝)
  for (let i = 0; i < 4; i++) grp.add(box(0.8, 2.2, 0.7, C.steel, -X0 - 1 - i * 0.85, f.y + 1.1, -4.9))
  // 옥상: 공조기 4대 + 냉각탑
  for (let i = 0; i < 4; i++) {
    const x = EQ_X0 + 2 + i * 4.2
    roof.add(box(3, 1.4, 2.2, C.steel, x, top + 1.0, -2.8))
    for (const dx of [-0.75, 0.75]) {
      roof.add(cyl(0.55, 0.55, 0.1, C.cable, x + dx, top + 1.75, -2.8, 16))
      const fan = box(1.0, 0.04, 0.12, C.steel, x + dx, top + 1.82, -2.8)
      fan.userData.spin = true
      roof.add(fan)
    }
  }
  roof.add(cyl(1.1, 1.3, 2.2, C.inner, -X0 - 2.2, top + 1.4, 2.2, 18))
  // 배관 (공조기 → 아래층)
  const p = cyl(0.12, 0.12, top - FLOORS[1].y, C.pipe, -X0 - 0.6, (top + FLOORS[1].y) / 2, -5.4, 10)
  grp.add(p)
}

// ── 바깥: 땅(앞쪽은 지하가 보이게 파 놓음), 길, 나무, 주변 건물 ──────
function surroundings(scene) {
  const g = new THREE.Group()
  const depth = 4.3
  const R = 70
  const pitFront = D / 2 + 3.5
  const slab = (w, d, x, z) => {
    g.add(box(w, depth, d, C.soil, x, -depth / 2, z))
    g.add(box(w, 0.06, d, C.grass, x, 0.03, z))
  }
  slab(R * 2, R - pitFront, 0, pitFront + (R - pitFront) / 2) // 앞쪽
  slab(R * 2, R - D / 2, 0, -D / 2 - (R - D / 2) / 2) // 뒤쪽
  slab(R + X0, pitFront + D / 2, X0 - (R + X0) / 2 - 0.4, (pitFront - D / 2) / 2) // 왼쪽
  slab(R + X0, pitFront + D / 2, -X0 + (R + X0) / 2 + 0.4, (pitFront - D / 2) / 2) // 오른쪽
  g.add(box(W + 0.8, 0.1, pitFront - D / 2, C.soil, 0, -depth + 0.05, D / 2 + (pitFront - D / 2) / 2)) // 파낸 바닥
  g.add(box(R * 2, 0.04, 6, C.road, 0, 0.08, pitFront + 7)) // 도로
  for (let x = -R; x < R; x += 4) g.add(box(2, 0.02, 0.18, mat('#e6e6e6'), x, 0.11, pitFront + 7))
  // 나무 (고정된 자리, 매번 같은 모양)
  let seed = 7
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2
    const r = 19 + rnd() * 30
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r * 0.8
    if (Math.abs(z - (pitFront + 7)) < 4.5) continue // 도로 위 제외
    const h = 2 + rnd() * 2.5
    g.add(cyl(0.15, 0.2, h * 0.45, C.trunk, x, (h * 0.45) / 2, z, 6))
    const crown = new THREE.Mesh(new THREE.SphereGeometry(h * 0.35, 10, 8), rnd() > 0.5 ? C.leaf : C.leaf2)
    crown.position.set(x, h * 0.45 + h * 0.25, z)
    g.add(crown)
  }
  // 주변 건물 (창문 불빛)
  const towns = [
    [-34, -26, 9, 14, 8],
    [-18, -32, 12, 22, 10],
    [6, -34, 10, 11, 8],
    [26, -28, 9, 18, 9],
    [40, -8, 8, 10, 12],
    [-42, 4, 8, 8, 12],
  ]
  for (const [x, z, w, h, d] of towns) {
    g.add(box(w, h, d, C.town, x, h / 2, z))
    for (let y = 1.5; y < h - 0.5; y += 1.6) g.add(box(w * 0.86, 0.5, 0.05, glow('#f2d38a', 0.35), x, y, z + d / 2 + 0.03))
  }
  scene.add(g)
}

function buildInterior() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0d141a')
  scene.fog = new THREE.Fog('#0d141a', 60, 140)
  const picks = []
  scene.add(new THREE.HemisphereLight('#cfe3ff', '#3a3226', 1.2))
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6)
  sun.position.set(-25, 40, 30)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -20, far: 120 })
  scene.add(sun)

  const floors = FLOORS.map(() => new THREE.Group())
  const { g, roof, top } = shell(floors)
  scene.add(g)
  core(floors)
  basement(floors[0], picks)
  floor1(floors[1], picks)
  floor2(floors[2], picks)
  floor3(floors[3], picks)
  floor4(floors[4], roof, top)
  // 층마다 천장 조명 (안쪽이 밝게)
  FLOORS.forEach((f, i) => {
    for (const lx of [EQ_X0 + 4, -X0 - 5]) {
      const l = new THREE.PointLight('#fff8ec', 26, 24, 1.5)
      l.position.set(lx, f.y + f.h - 0.7, 2)
      floors[i].add(l)
    }
    floors[i].add(floorTitle(f))
    for (let x = EQ_X0 + 1; x < -X0; x += 3.2) floors[i].add(box(1.6, 0.06, 0.25, glow('#ffffff', 1.2), x, f.y + f.h - 0.08, 1.5))
    scene.add(floors[i])
  })
  scene.add(roof)
  surroundings(scene)
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = !o.material.transparent
      o.receiveShadow = true
    }
  })
  // 마우스 검사는 건물(벽·층·옥상)만 대상으로 (나무·주변 건물까지 매번 검사하면 느림)
  const solids = [g, ...floors, roof]
  return { scene, picks, floors, roof, solids }
}

export default function SubstationInterior3D() {
  const wrap = useRef(null)
  const sceneRef = useRef(null)
  const [tip, setTip] = useState(null)
  const [upto, setUpto] = useState(FLOORS.length) // 이 층까지 보이기 (FLOORS.length = 옥상까지 전부)

  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    s.floors.forEach((g, i) => (g.visible = i <= upto))
    s.roof.visible = upto >= FLOORS.length
  }, [upto])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)
    const built = buildInterior()
    sceneRef.current = built
    const { scene, picks, floors, roof, solids } = built
    floors.forEach((g, i) => (g.visible = i <= upto))
    roof.visible = upto >= FLOORS.length

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300)
    camera.position.set(-18, 13, 34)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(1, 4.5, 0)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI / 2.02
    controls.minDistance = 3
    controls.maxDistance = 90
    let goal = null // 클릭한 설비로 시점을 부드럽게 옮길 목표

    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1)
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    const ray = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    const visibleUp = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false
      return true
    }
    const hit = (e) => {
      const r = renderer.domElement.getBoundingClientRect()
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(mouse, camera)
      // 벽·바닥에 가려진 설비는 고르지 않는다: 보이는 모든 물체와 부딪쳐 보고 맨 앞이 설비일 때만
      const h = ray.intersectObjects(solids, true).find((x) => visibleUp(x.object) && !x.object.isSprite)
      if (!h || !picks.includes(h.object)) return null
      return { obj: h.object, info: h.object.userData.info, x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onMove = (e) => setTip(hit(e))
    let down = null
    const onDown = (e) => (down = { x: e.clientX, y: e.clientY })
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      const h = hit(e)
      if (h) goal = h.obj.getWorldPosition(new THREE.Vector3())
    }
    const onLeave = () => setTip(null)
    const cv = renderer.domElement
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointerleave', onLeave)

    const clock = new THREE.Clock()
    let raf
    const loop = () => {
      const t = clock.getElapsedTime()
      scene.traverse((o) => o.userData.spin && (o.rotation.y = t * 6))
      if (goal) {
        // 목표 쪽으로 보는 점과 카메라를 같이 옮긴다 (카메라가 너무 멀면 가까이)
        const delta = goal.clone().sub(controls.target).multiplyScalar(0.08)
        controls.target.add(delta)
        camera.position.add(delta)
        const dist = camera.position.distanceTo(controls.target)
        if (dist > 14) camera.position.lerp(controls.target, 0.04)
        if (delta.length() < 0.01 && dist <= 14.5) goal = null
      }
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        o.geometry?.dispose()
        if (o.material?.map) o.material.map.dispose()
      })
      renderer.dispose()
      cv.remove()
      sceneRef.current = null
    }
    // upto는 위 useEffect가 따로 반영한다 (장면을 다시 만들지 않음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="d3-wrap si-wrap" ref={wrap}>
      {tip && (
        <div className="d3-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{tip.info.title}</b>
          {tip.info.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
      <div className="si-floors" role="group" aria-label="층 보기">
        <span>층 보기</span>
        <button type="button" className={upto === FLOORS.length ? 'on' : ''} onClick={() => setUpto(FLOORS.length)}>
          전체
        </button>
        {FLOORS.map((f, i) => (
          <button key={f.key} type="button" title={`${f.name}까지 보기 (위층 숨김)`} className={upto === i ? 'on' : ''} onClick={() => setUpto(i)}>
            {SHORT[i]}
          </button>
        ))}
      </div>
      <div className="d3-legend">
        <b>왕산변전소 내부 (단면)</b>
        <span>
          <i style={{ background: '#7c5cb0' }} /> 154kV GIS <i style={{ background: '#5f8f72' }} /> 22.9kV 배전반 <i style={{ background: '#e0b33a' }} /> 케이블 트레이
        </span>
        <span>
          변압기 띠·배전반 등 색: <i style={{ background: COLORS.green }} /> 여유 <i style={{ background: COLORS.orange }} /> 높음 <i style={{ background: COLORS.blue }} /> 소내 설비
        </span>
        <span className="muted">숫자는 단선도 그림의 저장 시점 값 · 층 배치는 일반적인 옥내 변전소 모양</span>
        <span className="muted">끌기: 돌리기 · 휠: 확대 · 오른쪽 끌기: 이동 · 클릭: 그 설비로 이동</span>
      </div>
    </div>
  )
}
