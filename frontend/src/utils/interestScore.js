/**
 * 관심도 점수 계산 유틸 (규칙 기반, API 없음)
 *
 * ─ 콜드스타트 (열람 < 10건): 키워드 70% + 신선도 30%
 * ─ 정상           (열람 ≥ 10건): 키워드 50% + 열람빈도 30% + 신선도 20%
 */

const COLD_START_THRESHOLD = 10

/* ── 카테고리 → 대표 키워드 매핑 (5개 통합 카테고리) ─────── */
const CATEGORY_KW_MAP = {
  '정치':      ['대통령','국회','여당','야당','선거','총선','대선','정치개혁','외교','안보','정책',
                '미국','중국','일본','러시아','북한','중동','전쟁','외교','제재','정상회담'],
  '경제':      ['GDP','물가','실업률','부동산','수출입','기업','스타트업','소비','경기침체','경제성장',
                '주식','코인','환율','금리','채권','은행','보험','ETF','코스피','비트코인'],
  '시사·사회': ['교육','의료','노동','복지','인권','여성','청년','범죄','재난','인구','이민','사회문제',
                '기후변화','탄소중립','재생에너지','원자력','미세먼지','생태계','ESG','환경'],
  '과학기술':  ['AI','반도체','우주','양자컴퓨터','바이오','로봇','전기차','배터리','스마트폰','메타버스',
                '블록체인','클라우드','사이버보안','드론','자율주행','빅데이터','5G','AR·VR','핀테크','헬스케어'],
  '스포츠·연예':['축구','야구','농구','배구','테니스','골프','수영','육상','올림픽','월드컵',
                '손흥민','류현진','이강인','KBO','UFC','e스포츠','메이저리그',
                'K-팝','영화','드라마','아이돌','OTT','넷플릭스','음악','공연','한류','게임'],
}

/* ── 개별 점수 계산 ─────────────────────────────────────────── */

/**
 * 키워드 점수 (0–10, cap)
 * 제목 포함: +2 / 카테고리 매칭: +1
 */
function calcKeywordScore(article, userKws) {
  if (!userKws || userKws.length === 0) return 0
  const title  = (article.title || '').toLowerCase()
  const catKws = CATEGORY_KW_MAP[article.category] || []
  let score = 0
  for (const kw of userKws) {
    const kwL = kw.toLowerCase()
    if (title.includes(kwL)) score += 2
    if (catKws.some(ck => ck.toLowerCase() === kwL)) score += 1
  }
  return Math.min(score, 10)
}

/**
 * 신선도 점수 (0–1)
 * 0시간 → 1.0, 168시간(7일) → 0.0
 */
function calcFreshnessScore(article) {
  if (!article.published) return 0.5
  const ageHours = (Date.now() - new Date(article.published).getTime()) / 3_600_000
  return Math.max(0, 1 - ageHours / 168)
}

/**
 * 카테고리 열람빈도 점수 (0–1)
 * 같은 카테고리 열람 비중으로 산출
 */
function calcFrequencyScore(article, history) {
  if (!history || history.length === 0) return 0
  const catCount = history.filter(h => h.category === article.category).length
  return catCount / history.length   // 0–1
}

/* ── 종합 점수 ──────────────────────────────────────────────── */

/**
 * 기사 종합 관심도 점수 (0–1)
 *
 * @param {object}   article  { title, category, published }
 * @param {string[]} userKws  사용자 관심 키워드
 * @param {object[]} history  열람 기록 배열 (pn_history)
 */
function calcInterestScore(article, userKws, history = []) {
  const kw   = calcKeywordScore(article, userKws) / 10   // normalize 0–1
  const fresh = calcFreshnessScore(article)
  const freq  = calcFrequencyScore(article, history)

  if (history.length < COLD_START_THRESHOLD) {
    // 콜드스타트: 키워드 70% + 신선도 30%
    return kw * 0.7 + fresh * 0.3
  }
  // 정상: 키워드 50% + 열람빈도 30% + 신선도 20%
  return kw * 0.5 + freq * 0.3 + fresh * 0.2
}

/**
 * 기사 배열을 종합 관심도 내림차순 정렬 (동점: 최신순)
 *
 * @param {object[]} articles
 * @param {string[]} userKws
 * @param {object[]} history
 */
export function sortByInterest(articles, userKws, history = []) {
  return [...articles].sort((a, b) => {
    const diff = calcInterestScore(b, userKws, history) - calcInterestScore(a, userKws, history)
    if (diff !== 0) return diff
    return (b.published || '') > (a.published || '') ? 1 : -1
  })
}
