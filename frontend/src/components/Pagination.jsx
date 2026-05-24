import { memo } from 'react'
import styles from './Pagination.module.css'

/**
 * Pagination — 제자리 페이지 전환 (스크롤 없음)
 *
 * @param {{ page:number, totalPages:number, onChange:(p:number)=>void }} props
 */
const Pagination = memo(function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null

  return (
    <div className={styles.wrap} role="navigation" aria-label="페이지 탐색">
      <button
        className={styles.btn}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="이전 페이지"
      >
        ‹
      </button>

      {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
        <button
          key={p}
          className={`${styles.btn}${p === page ? ' ' + styles.btnActive : ''}`}
          onClick={() => onChange(p)}
          aria-label={`${p}페이지`}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </button>
      ))}

      <button
        className={styles.btn}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="다음 페이지"
      >
        ›
      </button>
    </div>
  )
})

export default Pagination
