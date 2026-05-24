import { memo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './HeadlineNews.module.css'

const BIAS_CLASS = {
  '중립·사실': styles.biasNeutral,
  '균형 보도': styles.biasNeutral,
  '성향 있음': styles.biasHas,
  '관점 포함': styles.biasHas,
  '편향 주의': styles.biasWarning,
  '강한 논조': styles.biasWarning,
}

function relativeTime(iso) {
  if (!iso) return ''
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  if (mins  < 1)  return '방금'
  if (mins  < 60) return `${mins}분 전`
  if (hours < 24) return `${hours}시간 전`
  if (hours < 48) return '어제'
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`
}

/**
 * HeadlineNews — 최신/최상단 1건을 크게 표시
 *
 * @param {{ article: object, onRead?: (a:object)=>void }} props
 */
const HeadlineNews = memo(function HeadlineNews({ article, onRead }) {
  const navigate = useNavigate()

  const handleClick = useCallback(() => {
    if (onRead) onRead(article)
    navigate(`/article/${article.id}`, { state: { article } })
  }, [article, onRead, navigate])

  if (!article) return null

  const biasClass = BIAS_CLASS[article.biasTag] || styles.biasNeutral

  return (
    <article
      className={styles.card}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
      aria-label={`헤드라인: ${article.title}`}
    >
      {/* 메타 */}
      <div className={styles.meta}>
        <span className={styles.label}>헤드라인</span>
        {article.category && (
          <span className={styles.category}>{article.category}</span>
        )}
        {article.is_debate === true && (
          <span className={styles.debateBadge}>⚡ 논쟁</span>
        )}
        <span className={styles.time}>{relativeTime(article.published)}</span>
      </div>

      {/* 제목 (Serif, 크게) */}
      <h2 className={styles.title}>{article.title}</h2>

      {/* 요약 */}
      {article.summary && (
        <p className={styles.summary}>{article.summary}</p>
      )}

      {/* 하단 */}
      <div className={styles.footer}>
        <span className={styles.source}>{article.source}</span>
        {article.biasTag && (
          <span className={`${styles.biasTag} ${biasClass}`}>
            {article.biasTag}
          </span>
        )}
      </div>
    </article>
  )
})

export default HeadlineNews
