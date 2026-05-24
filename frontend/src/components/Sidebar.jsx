import { memo } from 'react'
import WeatherWidget  from './widgets/WeatherWidget'
import BreakingWidget from './widgets/BreakingWidget'
import MarketWidget   from './widgets/MarketWidget'
import RankingWidget  from './widgets/RankingWidget'
import styles from './Sidebar.module.css'

/**
 * Sidebar — 날씨 · 속보 · 시세 · 인기 기사 위젯 래퍼
 * memo: props 없음 → 부모 리렌더 시 재렌더 방지
 */
const Sidebar = memo(function Sidebar() {
  return (
    <aside className={styles.sidebar} aria-label="사이드바">
      <WeatherWidget />
      <BreakingWidget />
      <MarketWidget />
      <RankingWidget />
    </aside>
  )
})

export default Sidebar
