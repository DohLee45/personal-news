import { memo } from 'react'
import styles from './CategoryTabs.module.css'

export const TABS = ['전체','정치','경제','금융','시사·사회','과학기술','환경','국제','연예','스포츠']

/**
 * CategoryTabs — 10개 카테고리 탭
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
