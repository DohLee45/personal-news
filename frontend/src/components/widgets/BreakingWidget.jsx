import { memo, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Pagination from '../Pagination'
import styles from './BreakingWidget.module.css'

const PAGE_SIZE = 10

/**
 * BreakingWidget — 속보 20건, 10건×2페이지, 페이지 새로고침시 갱신
 * memo: props 없음 → 부모 리렌더 시 재렌더 방지
 */
const BreakingWidget = memo(function BreakingWidget() {
  const navigate  = useNavigate()
  const [articles, setArticles] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [page,     setPage]     = useState(1)

  const fetchBreaking = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 전체 20건 수집 (page 1+2)
      const [r1, r2] = await Promise.all([
        fetch('/api/breaking?page=1&size=10'),
        fetch('/api/breaking?page=2&size=10'),
      ])
      const [d1, d2] = await Promise.all([
        r1.ok ? r1.json() : { articles: [] },
        r2.ok ? r2.json() : { articles: [] },
      ])
      setArticles([...d1.articles, ...d2.articles])
    } catch (e) {
      setError('속보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchBreaking() }, [fetchBreaking])

  const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE))
  const start = (page - 1) * PAGE_SIZE
  const pageItems = articles.slice(start, start + PAGE_SIZE)

  return (
    <section className={styles.widget} aria-label="속보">
      <div className={styles.head}>
        <h2 className={styles.title}>
          🔴 속보 <span className={styles.badge}>LIVE</span>
        </h2>
        <button
          className={styles.refreshBtn}
          onClick={() => { setPage(1); fetchBreaking() }}
          aria-label="새로고침"
        >
          🔄
        </button>
      </div>

      {loading && <p className={styles.loading}>불러오는 중…</p>}
      {error   && <p className={styles.error}>{error}</p>}
      {!loading && !error && (
        <>
          <ul className={styles.list}>
            {pageItems.length === 0
              ? <li className={styles.empty}>속보가 없습니다.</li>
              : pageItems.map((a, i) => (
                <li key={a.id}>
                  <button
                    className={styles.item}
                    onClick={() => navigate(`/article/${a.id}`, { state: { article: a } })}
                  >
                    <span className={styles.rank}>{start + i + 1}</span>
                    <span className={styles.itemTitle}>{a.title}</span>
                  </button>
                </li>
              ))
            }
          </ul>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </section>
  )
})

export default BreakingWidget
