// 결과를 브라우저 새 창에 띄운다 (React portal). 창은 버튼을 누른 순간 App이 openPopup()으로 연다
// (클릭 처리 밖에서 window.open을 하면 팝업 차단에 걸리기 때문). 이 컴포넌트는 그 창에 화면을 그려 넣기만 한다.
// 새 창은 같은 React 화면의 일부라서 값이 바뀌면 바로 따라 바뀌고, 위치 버튼을 누르면 원래 창의 단선도가 움직인다
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// 버튼 클릭 처리 안에서 부른다. 막히면 null
export function openPopup(title) {
  const win = window.open('', 'capstone-results', 'width=1100,height=860')
  if (!win) return null
  win.document.title = title
  win.document.head.innerHTML = '<meta charset="utf-8">'
  win.document.body.innerHTML = ''
  // 화면 스타일(styles.css)을 새 창에도 복사한다 (개발 서버는 <style>, 빌드 결과는 <link>)
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => win.document.head.appendChild(n.cloneNode(true)))
  win.document.body.className = 'popup'
  const container = win.document.createElement('div')
  win.document.body.appendChild(container)
  return { win, container }
}

export default function PopupWindow({ popup, onClosed, children }) {
  useEffect(() => {
    const { win } = popup
    const closed = () => onClosed()
    win.addEventListener('pagehide', closed) // 사용자가 새 창을 닫음
    const closeChild = () => win.close()
    window.addEventListener('pagehide', closeChild) // 원래 창을 닫거나 새로고침하면 새 창도 닫음
    // pagehide가 안 오는 브라우저 대비: 1초마다 닫혔는지 확인
    const timer = setInterval(() => win.closed && closed(), 1000)
    return () => {
      win.removeEventListener('pagehide', closed)
      window.removeEventListener('pagehide', closeChild)
      clearInterval(timer)
    }
  }, [popup, onClosed])
  return createPortal(children, popup.container)
}
