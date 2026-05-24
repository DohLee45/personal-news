import { memo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './ArticleCard.module.css'

/* ── HTML 태그 방어 제거 ── */
function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}

/**
 * 출판 시각 → "N분 전 / N시간 전 / 어제 / MM.DD"
 */
function relativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  if (mins  < 1)   return '방금'
  if (mins  < 60)  return `${mins}분 전`
  if (hours < 24)  return `${hours}시간 전`
  if (hours < 48)  return '어제'
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

/**
 * ArticleCard
 *
 * 메인 뉴스룸: 제목·카테고리·언론사·시간만 표시 (성향 태그 없음)
 * 성향 데이터(biasTag, biasScore, viewpoint, is_debate)는 pn_history에 저장되지만 UI에는 표시 안 함
 *
 * @param {{
 *   article: object,
 *   onRead?: (a: object) => void,
 *   isSearchResult?: boolean
 * }} props
 */
const ArticleCard = memo(function ArticleCard({ article, onRead, isSearchResult = false }) {
  const navigate = useNavigate()

  const handleClick = useCallback(() => {
    if (onRead) onRead(article)
    navigate(`/article/${article.id}`, { state: { article } })
  }, [article, onRead, navigate])

  return (
    <article
      className={styles.card}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
      aria-label={article.title}
    >
      {/* 상단 메타 */}
      <div className={styles.meta}>
        {article.category && (
          <span className={styles.category}>{article.category}</span>
        )}
        <span className={styles.time}>{relativeTime(article.published)}</span>
      </div>

      {/* 제목 */}
      <h3 className={styles.title}>{article.title}</h3>

      {/* 요약: 피드 모드에서만 */}
      {!isSearchResult && article.summary && (
        <p className={styles.summary}>{stripHtml(article.summary)}</p>
      )}

      {/* 하단: 언론사만 */}
      <div className={styles.footer}>
        <span className={styles.source}>{article.source}</span>
      </div>
    </article>
  )
})

export default ArticleCard
