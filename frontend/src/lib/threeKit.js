// 3D 화면 공용 도구 (components/Diagram3D.jsx): 재질, 상자·원기둥, 애자, 글자 표지판
import * as THREE from 'three'

const mats = new Map() // 같은 색·옵션 재질은 하나만 만든다
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra)
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...extra }))
  return mats.get(key)
}
export const glow = (color, k = 0.6) => mat(color, { emissive: color, emissiveIntensity: k })

export function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  o.position.set(x, y, z)
  return o
}
export function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 14) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m)
  o.position.set(x, y, z)
  return o
}

// 애자 (원판 몇 장 + 심): 부싱·전주 애자에 같이 씀
export function insulator(color, discs = 3, x = 0, y = 0, z = 0) {
  const g = new THREE.Group()
  g.add(cyl(0.025, 0.025, discs * 0.07 + 0.04, mat('#c9c2b5'), 0, (discs * 0.07) / 2))
  for (let i = 0; i < discs; i++) g.add(cyl(0.07, 0.07, 0.025, glow(color, 0.35), 0, 0.04 + i * 0.07))
  g.position.set(x, y, z)
  return g
}

// 글자 표지판 (캔버스 → 스프라이트)
export function label(text, color = '#e8eef2') {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  ctx.font = 'bold 44px "Noto Sans KR", sans-serif'
  c.width = Math.ceil(ctx.measureText(text).width) + 40
  c.height = 70
  ctx.font = 'bold 44px "Noto Sans KR", sans-serif'
  ctx.fillStyle = 'rgba(12,17,21,0.78)'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 20, c.height / 2 + 2)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }))
  s.scale.set((c.width / c.height) * 0.45, 0.45, 1)
  return s
}
