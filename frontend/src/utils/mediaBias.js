/**
 * 클라이언트 사이드 언론사 편향 조회 (S_media 즉시 표시용)
 *
 * 검색 결과 카드에서 백엔드 full-analysis(biasTag) 대신
 * 언론사 이름만으로 편향 성향을 즉시 표시할 때 사용.
 * (나머지 3요소 S_text/S_quote/S_struct는 상세 진입 시 계산)
 */

const BIAS_MAP = {
  // 보수
  '조선일보': 'conservative', '조선비즈': 'conservative',
  '동아일보': 'conservative', '동아닷컴': 'conservative',
  'TV조선': 'conservative',  '채널A': 'conservative',
  'MBN': 'conservative',     '문화일보': 'conservative',

  // 중도 보수
  '중앙일보': 'moderate_right', 'JoongAng': 'moderate_right',
  '매일경제': 'moderate_right', 'MK': 'moderate_right',
  '한국경제': 'moderate_right', '서울경제': 'moderate_right',
  '이데일리': 'moderate_right',

  // 중립·공영
  'KBS': 'neutral', '연합뉴스': 'neutral', '뉴시스': 'neutral',
  '뉴스1': 'neutral', 'YTN': 'neutral', 'SBS': 'neutral',
  '아이뉴스24': 'neutral', 'ZDNet': 'neutral', '디지털타임스': 'neutral',

  // 중도 진보
  'MBC': 'moderate_left', 'JTBC': 'moderate_left',
  '한국일보': 'moderate_left', '시사IN': 'moderate_left',
  '머니투데이': 'moderate_left',

  // 진보
  '한겨레': 'progressive', '경향신문': 'progressive',
  '오마이뉴스': 'progressive', '프레시안': 'progressive',
  '민중의소리': 'progressive',
}

const LEAN_LABELS = {
  conservative:    '보수 성향',
  moderate_right:  '중도 보수',
  neutral:         '중립',
  moderate_left:   '중도 진보',
  progressive:     '진보 성향',
}

/** CSS 변수 or hex 컬러 (ArticleCard inline style에서 직접 사용) */
const LEAN_COLORS = {
  conservative:   '#e74c3c',
  moderate_right: '#e67e22',
  neutral:        '#27ae60',
  moderate_left:  '#3498db',
  progressive:    '#2980b9',
}

/**
 * 언론사명으로 편향 성향 코드 조회
 * @param {string} source
 * @returns {'conservative'|'moderate_right'|'neutral'|'moderate_left'|'progressive'|null}
 */
export function getMediaLean(source) {
  if (!source) return null
  for (const [media, lean] of Object.entries(BIAS_MAP)) {
    if (source.includes(media)) return lean
  }
  return null
}

/** 편향 코드 → 한국어 레이블 */
export function getLeanLabel(lean) {
  return lean ? LEAN_LABELS[lean] ?? null : null
}

/** 편향 코드 → hex 컬러 (null → '#aaa') */
export function getLeanColor(lean) {
  return lean ? (LEAN_COLORS[lean] ?? '#aaa') : '#aaa'
}
