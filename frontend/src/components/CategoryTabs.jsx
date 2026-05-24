import { memo } from 'react'
import styles from './CategoryTabs.module.css'

export const TABS = ['전체','정치','경제','시사·사회','과학기술','스포츠·연예']

/**
 * CategoryTabs — 6개 탭 (전체 + 5개 카테고리)
 *
 * @param {{ active: string, onChange: (tab:string)=>void }} props
 */
const CategoryTabs = memo(function CategoryTabs({ active, onChange }) {
  return (
    <nav className={styles.bar} role="tablist" aria-label="카테고리">
      <div className={styles.inner}>
        {TABS.map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={active === tab}
            className={`${styles.tab}${active === tab ? ' ' + styles.tabActive : ''}`}
            onClick={() => onChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
    </nav>
  )
})

export default CategoryTabs
