import { memo, useState, useEffect, useCallback } from 'react'
import Pagination from '../Pagination'
import styles from './MarketWidget.module.css'

const PAGE_SIZE = 5

function formatPrice(val) {
  if (val == null) return '-'
  if (val >= 1000) return val.toLocaleString('ko-KR', { maximumFractionDigits: 0 })
  return val.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

/**
 * MarketWidget — 시세 20개, 5건×4페이지, /api/market
 * memo: props 없음 → 부모 리렌더 시 재렌더 방지
 */
const MarketWidget = memo(function MarketWidget() {
  const [items,     setItems]     = useState([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [notice,    setNotice]    = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [page,      setPage]      = useState(1)

  const fetchMarket = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/market')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items || [])
      setUpdatedAt(data.updatedAt || '')
      setNotice(data.notice || '')
    } catch (e) {
      setError('시세 정보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMarket() }, [fetchMarket])

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const start = (page - 1) * PAGE_SIZE
  const pageItems = items.slice(start, start + PAGE_SIZE)

  function fmtUpdated(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} 기준`
  }

  return (
    <section className={styles.widget} aria-label="시세">
      <div className={styles.head}>
        <h2 className={styles.title}>📈 시세</h2>
        <span className={styles.updatedAt}>{fmtUpdated(updatedAt)}</span>
      </div>

      {loading && <p className={styles.loading}>불러오는 중…</p>}
      {error   && <p className={styles.error}>{error}</p>}
      {!loading && !error && (
        <>
          <ul className={styles.list}>
            {pageItems.map(item => {
              const dirClass = item.direction === 'up'   ? styles.up
                             : item.direction === 'down' ? styles.down
                             : styles.flat
              const arrow    = item.direction === 'up'   ? '▲'
                             : item.direction === 'down' ? '▼' : '–'
              return (
                <li key={item.ticker} className={styles.item}>
                  <div className={styles.name} title={item.name}>
                    {item.name}
                    <br />
                    <span className={styles.ticker}>{item.ticker}</span>
                  </div>
                  <div className={styles.right}>
                    <div className={styles.price}>{formatPrice(item.price)}</div>
                    <div className={`${styles.change} ${dirClass}`}>
                      {arrow} {item.changePct != null ? `${Math.abs(item.changePct).toFixed(2)}%` : '-'}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />

          <p className={styles.notice}>
            ※ 시세는 약 20분 지연될 수 있습니다
          </p>
        </>
      )}
    </section>
  )
})

export default MarketWidget
