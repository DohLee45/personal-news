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

Every article returned by any `/api/news`, `/api/breaking`, or `/api/ranking` endpoint already carries pre-computed bias fields. The analysis runs once during RSS fetch and is never recomputed on the frontend.

```
Google News RSS (feedparser, asyncio.to_thread)
  └─ _fetch_feed()                     [news_fetcher.py]
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

---

### 2. Frontend article history — 2-stage save (`hooks/useHistory.js`)

```
Card click
  └─ addStage1(article)
       • detectDebateStage1(title)   [utils/debateDetector.js]
         JS port of backend Rule 2 only (kw_score ≥ 8 → true, else null)
       • Saves to pn_history with _stage:1, is_debate = backend value ?? Stage1 result

Article detail page (STEP 8, not yet implemented)
  └─ updateStage2(id, patch)
       • Overwrites is_debate, biasTag, biasScore after full body crawl
       • Sets _stage:2
```

`pn_history` max 100 items — oldest deleted on overflow. Duplicate `id` → move to front + update `clickedAt`.

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

`useFeed(category, keywords, search, history)` uses a **module-level `Map`** (not React state) as a 5-minute cache keyed by `${category}|${keywords.join(',')}|${search}`.

- On cache hit: serves stale data immediately → sets `isStale=true` → fetches in background
- On cache miss: shows spinner until first response
- Only `isLoading && articles.length === 0` triggers the blocking spinner; background revalidation is non-blocking
- `refresh()` deletes the cache entry before re-fetching

**Cache key changes** (tab switch, keyword change, new search) trigger a new fetch and abort the previous `AbortController`.

---

### 5. Search — dual-path (`components/SearchBar.jsx`)

```
Input change
  ├─ onInstantSearch(q)   fires immediately → filters already-loaded articles in MainPage
  └─ debounce 300ms → onSearch(q) → triggers RSS API fetch via useFeed

Enter key
  └─ clears debounce → onSearch(q) immediately
```

**ArticleCard display mode** based on search type:
- In-app filter (`instantQuery` set): `isSearchResult=false` → shows full `biasTag`
- RSS new search (`rssQuery` set, no `instantQuery`): `isSearchResult=true` → shows only S_media from `utils/mediaBias.js` client lookup (27 Korean media outlets), with note "상세 진입 시 전체 분석 표시"

---

## Backend TODO Stubs (not yet implemented)

These files contain only `# TODO` comments and will be implemented in later STEPs:

| File | STEP | Purpose |
|------|------|---------|
| `services/article_cache.py` | 7 | In-memory cache, 6-hour TTL, md5(URL) key |
| `services/ai_writer.py` | 7 | Agent A — OpenRouter summary + bias analysis |
| `services/recommendation.py` | 7 | Agent C — related article recommendations |
| `services/crawler.py` | 8 | httpx + BeautifulSoup body crawl |
| `routers/analysis.py` | 7 | POST /api/analysis (currently returns stub message) |

`services/usage_tracker.py` — also a stub; will enforce 90 calls/day + 20/min rate limit for OpenRouter.

---

## Frontend TODO Stubs

- `utils/biasDetector.js` — stub (`// TODO`), not yet used anywhere
- `pages/ArticlePage.jsx` — shows article preview from router `state`; progressive loading (crawl → AI → recommend) is STEP 8
- `pages/AnalysisPage.jsx` — UP Score / Shannon entropy / trend chart is STEP 10

---

## Data Files (`backend/data/`)

Four JSON files loaded with `@lru_cache(maxsize=1)` — read once, held in memory:

| File | Contents | Used by |
|------|----------|---------|
| `media_bias.json` | 65 언론사 `{bias, score}` | `bias_analyzer._calc_s_media()` |
| `category_keywords.json` | 9 categories, 706 keywords | `category_classifier` |
| `known_stance.json` | 9 issues, org→pro/con/neutral | `bias_analyzer`, `debate_detector` |
| `debate_patterns.json` | vs_patterns(76), pro_con_pairs(28), policy(53), social(70), emotional, factual, bias | `debate_detector`, `bias_analyzer` |

**Do not regenerate these files** — they are pre-validated source data.

---

## Production Build Notes

`npm run build` writes to `backend/static/`. The `main.py` mounts `/assets` as static files and catches all non-`/api` paths with a catch-all SPA route. **API routers must be registered before the static mount** — this ordering is already correct and must not be changed.

On Render free tier, `backend/static/` is part of the same deployed service. No separate frontend deployment or CORS config is needed.
