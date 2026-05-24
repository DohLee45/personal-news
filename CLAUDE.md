# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> The parent-level `../CLAUDE.md` contains project overview, hard constraints, and coding conventions. **Read it first.** This file covers implementation-level details that require understanding multiple files together.

---

## Development Commands

### Running both servers (required for full functionality)

**Backend** (from `backend/`):
```bash
uvicorn main:app --reload --port 8000
```
Requires `OPENROUTER_API_KEY` in `backend/.env` (see `.env.example`).

**Frontend** (from `frontend/`):
```bash
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # Production build → outputs to ../backend/static/
```

The Vite dev proxy forwards `/api/*` → `localhost:8000`. In production, `main.py` serves the React build directly from `backend/static/`.

**There is no test runner configured** in either the frontend or backend.

---

## Key Architectural Flows

### 1. Article bias analysis pipeline (backend-only, synchronous at fetch time)

Every article returned by any `/api/news`, `/api/breaking`, or `/api/ranking` endpoint already carries pre-computed bias fields. The analysis runs once during RSS fetch and is cached for 5 minutes per `keyword:when` key.

```
fetch_google_news(keyword, max_items, when="7d")   [news_fetcher.py]
  ├─ _feed_cache hit → return cached list immediately (5-min TTL)
  └─ cache miss → _fetch_feed()
       ├─ classify_category()          [category_classifier.py]  → category string
       └─ analyze()                    [bias_analyzer.py]
            ├─ _calc_s_media()         media_bias.json lookup
            ├─ _calc_s_text()          sentence direction + double-negation resolver
            ├─ _calc_s_quote()         citation diversity + stance-org imbalance
            ├─ _calc_s_struct()        emotional title + assertive templates + rhetorical ?
            └─ detect_debate()         [debate_detector.py]
                 ├─ _keyword_score()   vs_patterns/pro_con_pairs/policy/social (+3/+2/+2/+2)
                 └─ _structure_score() A-vs-B regex/quotes/connectors/question (+4/+3/+1/+1)
```

**Article dict shape** (returned to frontend):
```json
{ "id", "title", "link", "source", "published", "summary",
  "category", "biasTag", "biasScore", "viewpoint", "is_debate" }
```

**Bias weights** — registered media: `(S_media=0.30, S_text=0.35, S_quote=0.20, S_struct=0.15)`; unregistered: `(0.15, 0.50, 0.20, 0.15)`.

**Debate detection rules:**
- Rule 1: `st_score ≥ 1 AND (kw_score + st_score) ≥ 5`
- Rule 2: `kw_score ≥ 8` (title alone, structure irrelevant)

**Tag labels** by `is_debate`:
| Score | `is_debate=true` | `is_debate=false` |
|-------|-----------------|-------------------|
| < 0.30 | 중립·사실 🟢 | 균형 보도 🟢 |
| 0.30–0.60 | 성향 있음 🟡 | 관점 포함 🟡 |
| ≥ 0.60 | 편향 주의 🔴 | 강한 논조 🔴 |

**`when` parameter:** All `fetch_google_news` callers pass an explicit `when` value:
- 메인 피드 `/api/news`: `when` is a query param (default `"7d"`); search requests send `when=20d`
- 속보 `/api/breaking`: `when="1d"` (fixed)
- 인기 `/api/ranking`: `when="7d"` (fixed)
- 추천 `recommendation.py`: `when="7d"` with 14d fallback

---

### 2. Frontend article history — 2-stage save (`hooks/useHistory.js`)

```
Card click (MainPage / RelatedCard)
  └─ addStage1(article)
       • detectDebateStage1(title)   [utils/debateDetector.js]
         JS port of backend Rule 2 only (kw_score ≥ 8 → true, else null)
       • Saves to pn_history with _stage:1

ArticlePage — POST /api/analysis completes
  └─ updateStage2(id, patch)
       • Overwrites is_debate, biasTag, biasScore with full-body analysis result
       • Sets _stage:2
```

`pn_history` max 100 items — oldest deleted on overflow. Duplicate `id` → move to front + update `clickedAt`. Clicking a related article (internal navigation) also calls `addStage1`.

---

### 3. Interest scoring (`utils/interestScore.js`)

`sortByInterest(articles, userKeywords, history)` applies different weights based on history size:

| Condition | Formula |
|-----------|---------|
| `history.length < 10` (cold start) | `kw×0.7 + freshness×0.3` |
| Normal | `kw×0.5 + frequency×0.3 + freshness×0.2` |

- **keyword score**: title substring match +2, category-representative keyword match +1 (cap 10)
- **freshness**: linear decay 1.0 → 0.0 over 168 hours (7 days)
- **frequency**: `sameCategory reads / total reads` (0–1)

---

### 4. Feed fetch + stale-while-revalidate (`hooks/useFeed.js`)

`useFeed(keywords, search, history)` — **no `category` parameter**. Tab switching is client-side `articles.filter(a => a.category === activeTab)` with no API re-call.

Uses a **module-level `Map`** (not React state) as a 5-minute cache keyed by `${keywords.join(',')}|${search}`.

- On cache hit: serves stale data immediately → sets `isStale=true` → fetches in background
- On cache miss: shows spinner until first response
- Only `isLoading && articles.length === 0` triggers the blocking spinner
- `refresh()` deletes the cache entry before re-fetching
- `DEFAULT_KW = ['정치', '경제', '사회', 'AI', '스포츠', '연예']` — used when user has no keywords

**Fetch URLs:**
- Regular feed: `/api/news?keywords=...&max=50` (no `when` → backend default `7d`)
- Search: `/api/news?keywords=...&max=40&when=20d`

---

### 5. Search — dual-path (`components/SearchBar.jsx`)

```
Input change
  ├─ onInstantSearch(q)   fires immediately → client-side filter in MainPage
  └─ debounce 300ms → onSearch(q) → RSS API fetch via useFeed

Enter key
  ├─ clears debounce → onSearch(q) immediately
  └─ persistHistory(q)    ← ONLY Enter saves to pn_search_history
                            (typing/debounce does NOT save history)
```

---

### 6. ArticlePage — progressive loading

Immediately shows title, category, bias bar, and original link from router `state`. Then fires two parallel requests:

```
useEffect parallel:
  ├─ POST /api/analysis  (crawl + Agent A, 5–15 s)
  │    → skeleton UI while loading → AI summary + bias explanation on complete
  │    → updateStage2() called after completion
  └─ GET  /api/related   (RSS recommendation, 2–5 s)
       → shows related articles as soon as available
       → clicking a related article → addStage1() + navigate('/article/id') [internal]
```

**Skeleton UI:** `analysisPhase === 'loading'` renders `.skeletonSection` with shimmer bars instead of a spinner. CSS `@keyframes shimmer` is defined in `ArticlePage.module.css`.

**Section title** for recommendations: `is_debate` → "다른 논조 기사"; else → "다른 시각 기사".

---

### 7. Recommendation (`services/recommendation.py`)

`get_related_articles(title, source, exclude_url, is_debate)` handles **both debate and non-debate articles** (no early return on `is_debate=False`).

**2-stage fallback:**
1. Fetch `when="7d"` → if ≥ 3 results, use them
2. If < 3 results → retry with `when="14d"`
3. If still 0 → return empty list

**Filter logic:** opposite-lean articles per `media_bias.json`, same source ≤ 2 items, total ≤ 5.

---

## Caching Architecture

| Layer | Location | Key | TTL |
|-------|----------|-----|-----|
| Backend feed | `news_fetcher._feed_cache` (dict) | `keyword:when` | 5 min |
| Backend breaking | `breaking._cache` (dict) | single entry | 2 min |
| Backend ranking | `ranking._cache` (dict) | single entry | 1 hr |
| Backend market | `market._cache` (dict) | single entry | 5 min |
| Backend article/AI | `article_cache.py` (dict) | `md5(url)` | 6 hr |
| Frontend feed | `useFeed._cache` (module Map) | `keywords\|search` | 5 min |
| Frontend weather | `localStorage pn_weather` | single entry | 30 min |

---

## Data Files (`backend/data/`)

Four JSON files loaded with `@lru_cache(maxsize=1)` — read once, held in memory:

| File | Contents | Used by |
|------|----------|---------|
| `media_bias.json` | 65 언론사 `{bias, score}` | `bias_analyzer._calc_s_media()` |
| `category_keywords.json` | **5 categories**, ~700 keywords | `category_classifier` |
| `known_stance.json` | 9 issues, org→pro/con/neutral | `bias_analyzer`, `debate_detector` |
| `debate_patterns.json` | vs_patterns(76), pro_con_pairs(28), policy(53), social(70), emotional, factual, bias | `debate_detector`, `bias_analyzer` |

**5 categories**: 정치, 경제, 시사·사회, 과학기술, 스포츠·연예  
**`_STANCE_CATEGORY_MAP`** in `bias_analyzer.py` maps these 5 article categories to `known_stance.json` issue keys.  
**Do not regenerate these files** — they are pre-validated source data.

---

## Lazy Loading (App.jsx)

`ArticlePage`, `AnalysisPage`, `SettingsPage` are loaded as separate Vite chunks via `React.lazy()`. `NicknamePage`, `OnboardingPage`, `MainPage` remain eagerly loaded. All routes are wrapped in `<Suspense>` with a CSS-module fallback.

---

## Production Build Notes

`npm run build` writes to `backend/static/`. The `main.py` mounts `/assets` as static files and catches all non-`/api` paths with a catch-all SPA route. **API routers must be registered before the static mount** — this ordering is already correct and must not be changed.

On Render free tier, `backend/static/` is part of the same deployed service. No separate frontend deployment or CORS config is needed.
