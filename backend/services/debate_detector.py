"""논쟁 감지기 — keyword_score + structure_score 이중 판정

판정 규칙:
  Rule 1: structure_score ≥ 1 AND (keyword + structure) ≥ 5 → 논쟁형
  Rule 2: keyword_score ≥ 8                                 → 논쟁형 (구조 불문)
  ※ 키워드만 5~7점이어도 구조 증거 없으면 비논쟁형
"""

import re
from dataclasses import dataclass

from services.data_loader import load_debate_patterns, load_known_stance

# ── A vs B 정규식 ──────────────────────────────────────────────────────────────
_AVS_B_RE = re.compile(
    r"[가-힣a-zA-Z0-9]+\s*(?:vs|VS)\s*[가-힣a-zA-Z0-9]+"
)
# ── 인용문 감지 ────────────────────────────────────────────────────────────────
_QUOTE_RE = re.compile(r'[""「\'](.*?)[""」\']', re.DOTALL)


# ── 결과 구조체 ────────────────────────────────────────────────────────────────
@dataclass
class DebateAnalysis:
    is_debate: bool
    viewpoint: str   # 논쟁형: "pro"/"con"/"neutral"  비논쟁형: "positive"/"negative"/"neutral"
    kw_score: int    # 디버깅용 세부 점수
    st_score: int


# ── keyword_score 계산 ─────────────────────────────────────────────────────────
def _keyword_score(title: str, content: str) -> int:
    p = load_debate_patterns()
    score = 0

    # ① vs_patterns 제목 매칭: +3 (1회 상한)
    if any(kw in title for kw in p.get("vs_patterns", [])):
        score += 3

    # ② pro_con_pairs 본문 양쪽 존재: +2 per pair
    for pair in p.get("pro_con_pairs", []):
        if isinstance(pair, list) and len(pair) == 2:
            if pair[0] in content and pair[1] in content:
                score += 2

    # ③ policy_keywords 본문 2개+: +2 (1회 상한)
    policy_hits = sum(1 for kw in p.get("policy_keywords", []) if kw in content)
    if policy_hits >= 2:
        score += 2

    # ④ social_issue_keywords — 제목: +2 / 본문만: +1 (1회 상한)
    social_kws = p.get("social_issue_keywords", [])
    if any(kw in title for kw in social_kws):
        score += 2
    elif any(kw in content for kw in social_kws):
        score += 1

    return score


# ── structure_score 계산 ───────────────────────────────────────────────────────
def _structure_score(title: str, content: str) -> int:
    p = load_debate_patterns()
    score = 0

    # ① A vs B 정규식: +4
    if _AVS_B_RE.search(title) or _AVS_B_RE.search(content):
        score += 4

    # ② 인용문 2개+ 방향 다름: +3 (contrast 있음) / +1 (contrast 불명)
    quotes = _QUOTE_RE.findall(content)
    if len(quotes) >= 2:
        has_contrast = any(conn in content for conn in p.get("contrast_connectors", []))
        score += 3 if has_contrast else 1

    # ③ contrast_connectors 1개=+1 / 2개+=+2
    connector_hits = sum(1 for c in p.get("contrast_connectors", []) if c in content)
    if connector_hits >= 2:
        score += 2
    elif connector_hits == 1:
        score += 1

    # ④ 의문형 제목: +1
    if "?" in title or "？" in title:
        score += 1

    return score


# ── 논쟁형 관점: pro / con / neutral ──────────────────────────────────────────
def _debate_viewpoint(title: str, content: str) -> str:
    """논쟁형 기사에서 기사가 지지하는 입장을 반환한다."""
    p = load_debate_patterns()
    ks = load_known_stance()
    text = title + " " + content
    pro = con = 0

    # pro_con_pairs: 제목에 어느 쪽 단어가 나왔는지 (pair[0]=진보/개혁, pair[1]=보수/현상유지)
    for pair in p.get("pro_con_pairs", []):
        if isinstance(pair, list) and len(pair) == 2:
            if pair[0] in title:
                pro += 1
            elif pair[1] in title:
                con += 1

    # known_stance 기관 언급 — 전 카테고리 합산
    for cat_data in ks.values():
        if isinstance(cat_data, dict):
            for org, stance in cat_data.items():
                if org in text:
                    if stance == "pro":
                        pro += 1
                    elif stance == "con":
                        con += 1

    # 감성어 신호
    emotional = p.get("emotional", {})
    if any(w in text for w in emotional.get("strong_positive_propaganda", [])):
        pro += 1
    if any(w in text for w in emotional.get("strong_negative", [])):
        con += 1

    if pro > con:
        return "pro"
    if con > pro:
        return "con"
    return "neutral"


# ── 비논쟁형 관점: positive / negative / neutral ───────────────────────────────
def _nondebate_viewpoint(title: str, content: str) -> str:
    """비논쟁형 기사의 논조를 반환한다."""
    p = load_debate_patterns()
    text = title + " " + content
    emotional = p.get("emotional", {})

    pos = sum(1 for w in emotional.get("strong_positive_propaganda", []) if w in text)
    neg = sum(1 for w in emotional.get("strong_negative", []) if w in text)

    if pos > neg:
        return "positive"
    if neg > pos:
        return "negative"
    return "neutral"


# ── 공개 API ───────────────────────────────────────────────────────────────────
def detect_debate(title: str, content: str = "") -> DebateAnalysis:
    """제목·본문을 분석하여 논쟁 여부와 관점(viewpoint)을 반환한다.

    Args:
        title:   기사 제목
        content: 기사 본문 또는 RSS 요약 (없으면 빈 문자열)

    Returns:
        DebateAnalysis(is_debate, viewpoint, kw_score, st_score)
    """
    kw = _keyword_score(title, content)
    st = _structure_score(title, content)

    # Rule 1: 구조 증거 존재 + 합산 임계
    # Rule 2: 키워드만으로도 압도적
    is_debate = (st >= 1 and (kw + st) >= 5) or (kw >= 8)

    viewpoint = _debate_viewpoint(title, content) if is_debate \
        else _nondebate_viewpoint(title, content)

    return DebateAnalysis(is_debate=is_debate, viewpoint=viewpoint,
                          kw_score=kw, st_score=st)
