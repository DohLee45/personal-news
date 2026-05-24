/**
 * 프론트엔드 논쟁 감지 — 제목 기반 1차 판정 (Stage 1)
 *
 * 백엔드 debate_detector._keyword_score() 핵심 규칙을 JS 포팅.
 * 제목(title)만 사용 → 백엔드 Rule 2 기준만 적용:
 *   keyword_score ≥ 8  → true  (명확한 논쟁)
 *   keyword_score <  8  → null  (Stage 2 보류 — 상세 진입 시 본문으로 재판정)
 */

/** VS 대립 패턴 (+3점/개) */
const VS_PATTERNS = [
  '갑론을박', '찬반', '찬반논란', '대(對)', '논란',
  '대립', '충돌', '대결', '격돌', '논쟁',
  '시비', '갈등', '분열', '대치', '반발',
  '공방', '신경전', '맞불', '파문', '반박',
  ' vs ', ' vs.', 'vs ',
]

/** 사회 쟁점 키워드 (+2점/개, 최대 +4) */
const SOCIAL_ISSUES = [
  '주4일제', '낙태', '사형제', '동성혼', '차별금지',
  '이민정책', '최저임금', '의대정원', '노동개혁', '연금개혁',
  '교육개혁', '부동산규제', '탈원전', '원자력', '탄소세',
  '기본소득', '안락사', '대입', '병역', '이민',
]

/** 정책 키워드 — 2개 이상 동시 → +2 */
const POLICY_KWS = ['개혁', '규제', '법안', '제도', '정책', '조례', '법률', '입법']

/**
 * 제목 기반 keyword_score 계산 (정수 반환)
 * @param {string} title
 * @returns {number}
 */
export function titleKeywordScore(title) {
  if (!title) return 0
  const t = title.toLowerCase()
  let score = 0

  // VS 패턴: +3점
  for (const p of VS_PATTERNS) {
    if (t.includes(p.toLowerCase())) score += 3
  }

  // 사회 쟁점: +2점씩, 최대 +4 (2개 cap)
  let socialHits = 0
  for (const s of SOCIAL_ISSUES) {
    if (t.includes(s.toLowerCase())) {
      score += 2
      socialHits++
      if (socialHits >= 2) break
    }
  }

  // 정책 키워드 2개+ 동시 등장 → +2
  const policyCnt = POLICY_KWS.filter(k => t.includes(k)).length
  if (policyCnt >= 2) score += 2

  return score
}

/**
 * Stage 1 논쟁 판정 (제목만 사용)
 * @param {string} title
 * @returns {true | null}  true=논쟁 확정 / null=Stage 2 보류
 */
export function detectDebateStage1(title) {
  return titleKeywordScore(title) >= 8 ? true : null
}
