"""편향도 분석기

B_total = W1·S_media + W2·S_text + W3·S_quote + W4·S_struct

등록 언론사: W1=0.30 / W2=0.35 / W3=0.20 / W4=0.15
미등록 언론사: W1=0.15 / W2=0.50 / W3=0.20 / W4=0.15
"""

import re
from dataclasses import dataclass

from services.data_loader import load_debate_patterns, load_known_stance, load_media_bias
from services.debate_detector import DebateAnalysis, detect_debate

# ── 가중치 ─────────────────────────────────────────────────────────────────────
# Gentzkow & Shapiro (2010): S_media 비중 축소
# Groseclose & Milyo (2005) / Spinde et al. (2024): S_text + S_quote 비중 확대
_W_REGISTERED   = (0.15, 0.45, 0.25, 0.15)   # 합계 1.0
_W_UNREGISTERED = (0.10, 0.50, 0.25, 0.15)   # 합계 1.0

# ── 이중부정 해소 상수 ──────────────────────────────────────────────────────────
_NEGATION_WORDS = [
    '않', '안', '못', '없', '아니', '거부', '철회', '반대',
    '반박', '중단', '폐지', '취소', '보류',
]
_NEGATION_COMPOUNDS = re.compile(
    r'(미실현|미이행|미완성|미준수|불가|불법|불공정|불필요|불합리|'
    r'비효율|비리|비합리|비공개|무효|무능|무책임|무관심|'
    r'반정부|반기업|반민주|반헌법|반환경|탈규제|탈원전|탈탄소)'
)

# 기사 카테고리 → known_stance 카테고리 매핑 (5개 통합 카테고리 기준)
_STANCE_CATEGORY_MAP: dict[str, list[str]] = {
    "정치":      ["국방·안보", "default"],
    "경제":      ["금융규제", "default"],
    "시사·사회": ["노동", "부동산", "의료", "교육", "환경", "default"],
    "과학기술":  ["기술규제", "default"],
    "스포츠·연예": [],
}

# 태그 레이블 (논쟁형 vs 비논쟁형)
_TAGS_DEBATE = [
    (0.30, "중립·사실",  "green"),
    (0.60, "성향 있음",  "yellow"),
    (1.01, "편향 주의",  "red"),
]
_TAGS_NORMAL = [
    (0.30, "균형 보도",  "green"),
    (0.60, "관점 포함",  "yellow"),
    (1.01, "강한 논조",  "red"),
]


# ── 결과 구조체 ────────────────────────────────────────────────────────────────
@dataclass
class BiasResult:
    bias_score: float   # 0.0 ~ 1.0
    bias_tag:   str     # 태그 레이블
    viewpoint:  str     # 보수 / 진보 / 중립
    is_debate:  bool
    components: dict    # {s_media, s_text, s_quote, s_struct}


# ── 이중부정 해소기 ────────────────────────────────────────────────────────────
def _count_negations(sentence: str) -> int:
    """문장 내 부정 표현의 수를 반환한다."""
    count = sum(1 for w in _NEGATION_WORDS if w in sentence)
    count += len(_NEGATION_COMPOUNDS.findall(sentence))
    return count


def resolve_double_negation(sentence: str, direction: str) -> str:
    """부정 표현이 2개 이상이면 방향을 반전(pro↔con)한다."""
    if direction == "neutral":
        return direction
    if _count_negations(sentence) >= 2:
        return "con" if direction == "pro" else "pro"
    return direction


# ── S_media ────────────────────────────────────────────────────────────────────
def _calc_s_media(source: str) -> tuple[float, bool]:
    """(편향 점수, 등록 여부) 반환."""
    m = load_media_bias()
    if source in m:
        return float(m[source]["score"]), True
    return 0.3, False


# ── S_text ─────────────────────────────────────────────────────────────────────
def _classify_sentence_direction(sentence: str, category: str) -> str:
    """문장 하나의 방향성(pro/con/neutral)을 분류한다.

    Method A: BIAS_KEYWORDS 강도
    Method B: known_stance 기관 언급
    """
    pats = load_debate_patterns()
    stance_all = load_known_stance()
    cat_keys = _STANCE_CATEGORY_MAP.get(category, ["default"])

    # Method B: 기관 언급 집계
    pro_hits = con_hits = 0
    for key in cat_keys + ["default"]:
        for org, stance in stance_all.get(key, {}).items():
            if org in sentence:
                if stance == "pro":
                    pro_hits += 1
                elif stance == "con":
                    con_hits += 1

    # 감성어 신호
    emotional = pats.get("emotional", {})
    has_neg = any(w in sentence for w in emotional.get("strong_negative", []))
    has_pos = any(w in sentence for w in emotional.get("strong_positive_propaganda", []))

    if has_neg and not has_pos:
        con_hits += 1  # 비판적 어조 → 보수/반정부 신호
    if has_pos and not has_neg:
        pro_hits += 1  # 긍정 선전 어조

    if pro_hits > con_hits:
        return "pro"
    if con_hits > pro_hits:
        return "con"
    return "neutral"


def _split_sentences(text: str) -> list[str]:
    """한국어 문장 분리 (마침표·느낌표·물음표 기준)."""
    parts = re.split(r'(?<=[.!?。])\s+', text.strip())
    return [p.strip() for p in parts if p.strip()]


def _calc_s_text(text: str, category: str) -> float:
    """방향성 편향 지수(S_text) 산출."""
    sentences = _split_sentences(text)
    if not sentences:
        return 0.0

    directions: list[str] = []
    for sent in sentences:
        raw_dir = _classify_sentence_direction(sent, category)
        final_dir = resolve_double_negation(sent, raw_dir)
        directions.append(final_dir)

    total = len(directions)
    pro_ratio     = directions.count("pro")     / total
    con_ratio     = directions.count("con")     / total
    neutral_ratio = directions.count("neutral") / total

    direction_imbalance = abs(pro_ratio - con_ratio)
    neutral_bonus = neutral_ratio * 0.3
    return round(min(direction_imbalance * (1.0 - neutral_bonus), 1.0), 4)


# ── S_quote ────────────────────────────────────────────────────────────────────
_DIRECT_QUOTE_RE = re.compile(r'[""「『](.*?)[""」』]', re.DOTALL)


def _calc_s_quote(text: str, category: str) -> float:
    """인용 다양성·입장 균형 지수(S_quote) 산출."""
    pats = load_debate_patterns()

    # 직접 인용
    direct_count = len(_DIRECT_QUOTE_RE.findall(text))
    # 간접 인용 (팩트 표현)
    factual_count = sum(1 for phrase in pats.get("factual", []) if phrase in text)

    if direct_count == 0 and factual_count == 0:
        return 0.3  # 인용 없음 → 판단 불가 (0.5 과대평가 방지)

    # 인용 다양성: 3건 이상이면 다양한 것으로 간주
    total_citations = direct_count + factual_count
    diversity_score = min(total_citations / 3.0, 1.0)

    # 기관 입장 불균형
    stance_all = load_known_stance()
    cat_keys = _STANCE_CATEGORY_MAP.get(category, ["default"])
    pro_orgs = con_orgs = 0
    for key in cat_keys + ["default"]:
        for org, stance in stance_all.get(key, {}).items():
            if org in text:
                if stance == "pro":
                    pro_orgs += 1
                elif stance == "con":
                    con_orgs += 1

    total_orgs = pro_orgs + con_orgs
    stance_imbalance = (
        abs(pro_orgs - con_orgs) / total_orgs if total_orgs else 0.0
    )

    s_quote = stance_imbalance * (1.0 - diversity_score * 0.3)
    return round(min(s_quote, 1.0), 4)


# ── S_struct ───────────────────────────────────────────────────────────────────
def _calc_s_struct(title: str, text: str) -> float:
    """제목 자극성·단언적 어조·수사 의문문 지수(S_struct) 산출."""
    pats = load_debate_patterns()
    emotional = pats.get("emotional", {})
    bias_pats = pats.get("bias", {})

    # 제목 감성어 밀도 (title_gap)
    all_emotional = (
        emotional.get("strong_negative", []) +
        emotional.get("strong_positive_propaganda", [])
    )
    title_emotional = sum(1 for w in all_emotional if w in title)
    title_gap = min(title_emotional / 2.0, 1.0)

    # 단언적 표현 비율 (assertive_ratio)
    def _match_templates(templates: list[str], target: str) -> int:
        return sum(
            1 for t in templates
            if (stripped := t.lstrip("~").strip()) and stripped in target
        )

    assertive_score = (
        _match_templates(bias_pats.get("strong", []), text) * 1.0 +
        _match_templates(bias_pats.get("medium", []), text) * 0.5 +
        _match_templates(bias_pats.get("weak",   []), text) * 0.2
    )
    assertive_ratio = min(assertive_score / 3.0, 1.0)

    # 수사 의문문 비율 (rhetorical_ratio)
    q_count = title.count("?") + title.count("？")
    rhetorical_ratio = min(q_count / 2.0, 1.0)

    s_struct = title_gap * 0.40 + assertive_ratio * 0.35 + rhetorical_ratio * 0.25
    return round(min(s_struct, 1.0), 4)


# ── 편향 태그 ──────────────────────────────────────────────────────────────────
def _get_bias_tag(score: float, is_debate: bool) -> str:
    table = _TAGS_DEBATE if is_debate else _TAGS_NORMAL
    for threshold, label, _ in table:
        if score < threshold:
            return label
    return table[-1][1]


# ── 관점 분류 ──────────────────────────────────────────────────────────────────
def _get_viewpoint(source: str, s_text: float, text: str, category: str) -> str:
    """언론사 성향 + S_text 방향으로 관점을 결정한다."""
    m = load_media_bias()
    media_bias = m.get(source, {}).get("bias", "neutral")

    # 기관 방향 신호
    stance_all = load_known_stance()
    cat_keys = _STANCE_CATEGORY_MAP.get(category, ["default"])
    pro_hits = con_hits = 0
    for key in cat_keys + ["default"]:
        for org, stance in stance_all.get(key, {}).items():
            if org in text:
                if stance == "pro":
                    pro_hits += 1
                elif stance == "con":
                    con_hits += 1

    text_leans_pro = pro_hits > con_hits
    text_leans_con = con_hits > pro_hits

    if media_bias == "conservative":
        # 텍스트가 정반대면 진보, 아니면 보수
        return "진보" if text_leans_pro else "보수"
    if media_bias == "progressive":
        return "보수" if text_leans_con else "진보"
    # neutral 언론사: 텍스트 방향 우선
    if text_leans_pro:
        return "진보"
    if text_leans_con:
        return "보수"
    return "중립"


# ── 공개 API ───────────────────────────────────────────────────────────────────
def analyze(
    title: str,
    source: str,
    summary: str,
    category: str = "시사·사회",
) -> BiasResult:
    """기사 제목·출처·요약을 받아 BiasResult를 반환한다.

    Args:
        title:    기사 제목
        source:   언론사명
        summary:  RSS 요약문
        category: 분류된 카테고리

    Returns:
        BiasResult (bias_score, bias_tag, viewpoint, is_debate, components)
    """
    text = title + " " + summary

    s_media, is_registered = _calc_s_media(source)
    s_text   = _calc_s_text(text, category)
    s_quote  = _calc_s_quote(text, category)
    s_struct = _calc_s_struct(title, summary)

    # DebateAnalysis: is_debate + viewpoint(pro/con/neutral or positive/negative/neutral)
    debate: DebateAnalysis = detect_debate(title, summary)

    w = _W_REGISTERED if is_registered else _W_UNREGISTERED
    b_total = round(
        w[0] * s_media + w[1] * s_text + w[2] * s_quote + w[3] * s_struct,
        4,
    )
    b_total = min(b_total, 1.0)

    bias_tag = _get_bias_tag(b_total, debate.is_debate)

    return BiasResult(
        bias_score = b_total,
        bias_tag   = bias_tag,
        viewpoint  = debate.viewpoint,   # debate_detector에서 결정
        is_debate  = debate.is_debate,
        components = {
            "s_media":  s_media,
            "s_text":   s_text,
            "s_quote":  s_quote,
            "s_struct": s_struct,
            "kw_score": debate.kw_score,
            "st_score": debate.st_score,
        },
    )
