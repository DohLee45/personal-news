import { memo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMediaLean, getLeanLabel, getLeanColor } from '../utils/mediaBias'
import styles from './ArticleCard.module.css'

/* ── HTML 태그 방어 제거 ── */
function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}

/* ── 성향 태그 → CSS 클래스 ── */
const BIAS_CLASS = {
  '중립·사실': styles.biasNeutral,
  '균형 보도': styles.biasNeutral,
  '성향 있음': styles.biasHas,
  '관점 포함': styles.biasHas,
  '편향 주의': styles.biasWarning,
  '강한 논조': styles.biasWarning,
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
 * @param {{
 *   article: object,
 *   onRead?: (a: object) => void,
 *   isSearchResult?: boolean  // true → S_media만 표시, biasTag 숨김
 * }} props
 */
const ArticleCard = memo(function ArticleCard({ article, onRead, isSearchResult = false }) {
  const navigate = useNavigate()

  /* Stage 1: 카드 클릭 → addStage1 → navigate */
  const handleClick = useCallback(() => {
    if (onRead) onRead(article)
    navigate(`/article/${article.id}`, { state: { article } })
  }, [article, onRead, navigate])

  /* 검색 모드: S_media (언론사 성향) */
  const lean       = isSearchResult ? getMediaLean(article.source) : null
  const leanLabel  = lean ? getLeanLabel(lean) : null
  const leanColor  = lean ? getLeanColor(lean) : null

  /* 피드 모드: biasTag */
  const biasClass  = !isSearchResult
    ? (BIAS_CLASS[article.biasTag] || styles.biasNeutral)
    : null

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
        {article.is_debate === true && (
          <span className={styles.debateBadge}>⚡ 논쟁</span>
        )}
        <span className={styles.time}>{relativeTime(article.published)}</span>
      </div>

      {/* 제목 */}
      <h3 className={styles.title}>{article.title}</h3>

      {/* 요약: 피드 모드에서만 */}
      {!isSearchResult && article.summary && (
        <p className={styles.summary}>{stripHtml(article.summary)}</p>
      )}

      {/* 하단: 언론사 + 편향 태그 */}
      <div className={styles.footer}>
        <span className={styles.source}>{article.source}</span>

        {isSearchResult
          ? (
            /* 검색 결과: S_media 언론사 성향만 */
            leanLabel
              ? (
                <span
                  className={styles.mediaBiasChip}
                  style={{ color: leanColor, borderColor: leanColor }}
                >
                  {leanLabel}
                </span>
              )
              : null
          )
          : (
            /* 피드: 전체 biasTag */
            article.biasTag
              ? <span className={`${styles.biasTag} ${biasClass}`}>{article.biasTag}</span>
              : null
          )
        }
      </div>

      {/* 검색 모드 안내 */}
      {isSearchResult && (
        <span className={styles.searchNote}>상세 진입 시 전체 분석 표시</span>
      )}
    </article>
  )
})

export default ArticleCard
