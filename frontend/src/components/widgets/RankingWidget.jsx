import { memo, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Pagination from '../Pagination'
import styles from './RankingWidget.module.css'

const PAGE_SIZE = 10
const REFRESH_MS = 60 * 60 * 1000   // 1시간

/**
 * RankingWidget — 인기 Top20, 10건×2페이지, 1시간 갱신
 * memo: props 없음 → 부모 리렌더 시 재렌더 방지
 */
const RankingWidget = memo(function RankingWidget() {
  const navigate  = useNavigate()
  const [articles, setArticles] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [page,     setPage]     = useState(1)

  const fetchRanking = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/ranking?page=1&size=10'),
        fetch('/api/ranking?page=2&size=10'),
      ])
      const [d1, d2] = await Promise.all([
        r1.ok ? r1.json() : { articles: [] },
        r2.ok ? r2.json() : { articles: [] },
      ])
      setArticles([...d1.articles, ...d2.articles])
    } catch {
      setError('랭킹을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRanking()
    const t = setInterval(fetchRanking, REFRESH_MS)
    return () => clearInterval(t)
  }, [fetchRanking])

  const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE))
  const start = (page - 1) * PAGE_SIZE
  const pageItems = articles.slice(start, start + PAGE_SIZE)

  function rankClass(n) {
    if (n === 1) return styles.rank1
    if (n === 2) return styles.rank2
    if (n === 3) return styles.rank3
    return styles.rankOther
  }

  return (
    <section className={styles.widget} aria-label="인기 기사">
      <div className={styles.head}>
        <h2 className={styles.title}>🔥 인기 기사</h2>
        <span className={styles.ttl}>1시간 갱신</span>
      </div>

      {loading && <p className={styles.loading}>불러오는 중…</p>}
      {error   && <p className={styles.error}>{error}</p>}
      {!loading && !error && (
        <>
          <ul className={styles.list}>
            {pageItems.length === 0
              ? <li className={styles.empty}>인기 기사가 없습니다.</li>
              : pageItems.map((a, i) => {
                  const n = start + i + 1
                  return (
                    <li key={a.id}>
                      <button
                        className={styles.item}
                        onClick={() => navigate(`/article/${a.id}`, { state: { article: a } })}
                      >
                        <span className={`${styles.rank} ${rankClass(n)}`}>{n}</span>
                        <div>
                          <div className={styles.itemTitle}>{a.title}</div>
                          {a.source && <div className={styles.source}>{a.source}</div>}
                        </div>
                      </button>
                    </li>
                  )
                })
            }
          </ul>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </section>
  )
})

export default RankingWidget
