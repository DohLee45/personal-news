/**
 * formatUtils.js — 공통 포맷 유틸
 *
 * stripHtml  : HTML 태그 제거 (ArticleCard, HeadlineNews 공용)
 * relativeTime: ISO 시각 → "N분 전 / N시간 전 / 어제 / MM.DD"
 */

export function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}

export function relativeTime(iso) {
  if (!iso) return ''
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  if (mins  < 1)   return '방금'
  if (mins  < 60)  return `${mins}분 전`
  if (hours < 24)  return `${hours}시간 전`
  if (hours < 48)  return '어제'
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}
