# Personal NEWS

AI 기반 뉴스 편향도 분석 서비스 — 관심 키워드로 큐레이션된 뉴스를 읽고, AI가 기사의 편향 성향을 실시간으로 분석합니다.

🔗 **배포 URL**: https://personal-news-be43.onrender.com

<img src="qr.png" alt="Personal NEWS QR Code" width="160" />

> QR 코드를 스캔하면 모바일에서 바로 접속할 수 있습니다.  
> 배포 URL 변경 시: `python generate_qr.py https://새URL.onrender.com`

---

## 실행 방법

### 사전 준비

```
Python 3.11+
Node.js 20+
OpenRouter API 키 (https://openrouter.ai/)
```

### 1. 백엔드

```bash
cd backend
pip install -r requirements.txt

# .env 파일 생성 (아래 환경 변수 설정)
cp .env.example .env

uvicorn main:app --reload --port 8000
```

### 2. 프론트엔드

```bash
cd frontend
npm install
npm run dev          # 개발 서버: http://localhost:5173
npm run build        # 프로덕션 빌드 → backend/static/
```

개발 서버에서는 Vite 프록시(`/api → localhost:8000`)가 자동으로 활성화됩니다.

---

## 환경 변수 (`.env`)

| 변수 | 설명 | 예시 |
|------|------|------|
| `OPENROUTER_API_KEY` | OpenRouter API 인증 키 | `sk-or-v1-...` |

```env
OPENROUTER_API_KEY=sk-or-v1-여기에키입력
```

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **닉네임 / 온보딩** | 최초 접속 시 닉네임(2–10자) 설정 → 관심 키워드 선택(최대 20개) |
| **개인화 피드** | 관심사 기반 정렬 + 6개 카테고리 탭 (전체/정치/경제/사회/과학기술/스포츠/연예) + 스테일-화이트-리밸리데이트 캐시 |
| **사이드바 위젯** | 속보 20건 · 시세 20개 · 인기 기사 20건 · 날씨(Open-Meteo) |
| **검색** | 앱내 즉시 필터 + Google News RSS 검색 · 최근 검색 기록 저장 |
| **기사 상세** | 점진적 로딩 — 편향 바(즉시) → 원문 요약(본문 추출, API 불필요) → 다른 시각 기사(RSS 자동) |
| **AI 정밀 분석** | "AI 정밀 분석" 버튼 → Agent A가 7필드 분석 + 논거 기반 추천 (API 1회) |
| **설정** | 관심 키워드 관리 · 검색 기록 · 닉네임 변경 (3탭) |
| **편향 분석** | UP Score + Shannon 다양성 + 7개 섹션 + 변화 추이 그래프 |

---

## 알고리즘 설명

### 편향도 분석 파이프라인 (백엔드)

RSS 수집 시 기사마다 4가지 요소를 측정해 편향도를 계산합니다.

```
S_media  (0.15) — media_bias.json: 65개 언론사 사전 등록 성향 점수
S_text   (0.45) — 문장 방향성 분석 + 이중 부정 해소
S_quote  (0.25) — 인용 다양성 + 발화 주체 불균형 (pro/con 편중)
S_struct (0.15) — 감성적 제목 + 단정 표현 + 수사 의문문 탐지
```

- **미등록 언론사**: S_media 0.10, S_text 0.50, S_quote 0.25, S_struct 0.15  
  인용 없음 시 S_quote 기본값 0.3 (판단 불가 = 낮은 편향 추정)
- **편향도 태그 (3종)**:
  - 0~0.3: 균형 보도 (초록)
  - 0.3~0.6: 관점 포함 (노랑)
  - 0.6~1.0: 편향 주의 (빨강)

### 기사 본문 수집

Google News RSS는 기사 본문을 제공하지 않으므로 별도 수집이 필요합니다.

```
Google News RSS 링크 (protobuf 인코딩)
→ googlenewsdecoder 패키지로 실제 URL 추출
→ httpx로 언론사 사이트 크롤링
→ BeautifulSoup4로 본문 텍스트 추출
→ 본문 기반 S_text/S_quote/S_struct 재계산
```

일부 언론사는 크롤링을 차단(403)하며, 본문 미확보 시 RSS 요약으로 대체됩니다.

### 카테고리별 RSS 수집

Google News 카테고리 피드를 사용하여 카테고리를 확정합니다.

| 카테고리 | RSS 방식 |
|----------|----------|
| 정치 | Google News 검색 RSS (`q=정치`) |
| 경제 | Google News 토픽 RSS (BUSINESS) |
| 사회 | Google News 검색 RSS (`q=사회`) |
| 과학기술 | Google News 토픽 RSS (TECHNOLOGY) |
| 스포츠 | Google News 토픽 RSS (SPORTS) |
| 연예 | Google News 토픽 RSS (ENTERTAINMENT) |

키워드 검색으로 수집된 기사는 제목 기반 간단 분류(`simple_classify`)로 카테고리를 자동 할당합니다.

### 기사 상세 페이지 구조

기사 진입 시 API 호출 없이 즉시 표시되며, AI 분석은 사용자 선택 시에만 실행됩니다.

**자동 표시 (API 0회)**  
① 편향도 바 + 태그 (즉시)  
② 원문 요약 — 본문 앞 5문장 추출 (크롤링 후 1~3초)  
③ 다른 시각 기사 — RSS 반대 성향 추천 (1~3초)

**버튼 클릭 시 (API 1회)**  
④ AI 정밀 분석 — 편향 판별 · 찬반 입장 · 중도 시각 · 맥락 · AI 점수 · 교차검증 · 논거 기반 추천 (5~15초)

원문 요약은 역피라미드 뉴스 구조를 활용한 본문 앞부분 추출이며, AI가 아닌 자체 처리입니다.

### UP (Unbalanced Perspective) Score

사용자의 Stage 2 분석 완료 기사 열람 이력을 분석합니다.

```
UP(u) = 0.35 × D_opinion + 0.25 × D_source + 0.25 × D_bimodal + 0.15 × D_intensity
다양성 점수 = (1 − UP) × 100
```

| 요소 | 설명 |
|------|------|
| **D_opinion** | 관점편중도 — 찬성/반대 기사 비율의 시간 감쇠 가중 평균(반감기 7일) |
| **D_source** | 언론사편중도 — 보수·진보 언론사 비율 차이 |
| **D_bimodal** | 이봉성 — Kitchens et al.(2020) 방법론, 양극화 패턴 탐지 |
| **D_intensity** | 편향강도 — 편향 점수 평균 × 0.6 + 고편향(≥0.6) 비율 × 0.4 |

**등급 기준**: 다양성 ≥71 높음(녹색) / 41–70 보통(노란색) / ≤40 낮음(빨간색)

**이봉성 경고**: `D_bimodal > 0.3 AND D_opinion < 0.2` — 찬반 극단 기사만 읽고 중도 시각 부족

### Shannon 주제 다양성

```
H = −Σ p_i × ln(p_i)
주제 다양성 = H / ln(카테고리 수) × 100
```

### AI 에이전트 (OpenRouter)

| 에이전트 | 트리거 | 역할 |
|----------|--------|------|
| **Agent A** (분석관) | "AI 정밀 분석" 버튼 클릭 (수동) | 편향 판별 · 찬반 입장 · 중도 시각 · 맥락 정보 · AI 편향도 점수 · 교차검증 · 논거 기반 추천 (API 1회) |

- **기본 모델**: `deepseek/deepseek-v4-flash:free`
- **폴백 모델**: `openai/gpt-oss-120b:free` (HTTP 429 수신 시 자동 전환)
- **일일 한도**: 90건 / **분당 한도**: 20건
- **캐시**: URL md5 키, TTL 6시간

### 1차 논조 추천 (Agent 없이 무료 자동)

```
기사 제목 → 키워드 추출 (3글자+ 한국어, 일반명사 131개 제외)
→ Google News RSS 재수집
→ 반대 성향 언론사 필터링
   - 보수 계열 원본 → 진보·중립 추천
   - 진보 계열 원본 → 보수·중립 추천
   - 같은 언론사 최대 2건, 총 최대 5건
```

---

## 데이터 저장 (localStorage)

| 키 | 내용 | 최대 |
|----|------|------|
| `pn_nickname` | 사용자 닉네임 | — |
| `pn_onboarded` | 온보딩 완료 여부 | — |
| `pn_keywords` | 관심 키워드 목록 | 20개 |
| `pn_history` | 열람 기록 (기사 + 편향 메타) | 100건 |
| `pn_search_history` | 검색 기록 `{q, at}[]` | 10건 |
| `pn_analysis_history` | UP Score 분석 이력 | 30건 |

---

## 배포 (Render)

`render.yaml`이 이미 포함되어 있어 Git 연동만으로 자동 배포됩니다.

### 단계별 가이드

```
1. https://render.com → New Web Service
2. GitHub 저장소 연결 (Personal NEWS 레포)
3. render.yaml 자동 감지 → 설정 확인
4. Environment → Add Secret → OPENROUTER_API_KEY 입력
5. Create Web Service → 빌드 시작 (~3–5분)
6. 배포 URL 확인 후 QR 재생성:
   python generate_qr.py https://your-service.onrender.com
```

### 빌드 흐름 (render.yaml)

```
buildCommand:
  pip install -r backend/requirements.txt   ← Python 의존성
  cd frontend && npm ci && npm run build    ← React → backend/static/

startCommand:
  bash start.sh → cd backend → uvicorn main:app --port $PORT
```

- FastAPI가 React 빌드(`backend/static/`)를 직접 서빙 (동일 오리진, CORS 불필요)
- API 라우터 등록 → `/assets` StaticFiles 마운트 → `/{path}` SPA catch-all 순서 고정
- `backend/static/`은 `.gitignore`에 포함 — Render 빌드 시 자동 생성
- UptimeRobot `/api/health` 핑으로 무료 티어 15분 슬립 방지

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 19, Vite, CSS Modules, React Router |
| 백엔드 | FastAPI, httpx, feedparser, BeautifulSoup4, googlenewsdecoder, yfinance |
| AI | OpenRouter (deepseek-v4-flash / gpt-oss-120b) |
| 날씨 | Open-Meteo API (무료, 인증 불필요) |
| 배포 | Render free tier |

---

## 참고 논문

- Matakos et al. (2017) — viewpoint diversity measurement
- Kitchens et al. (2020) — echo chamber bias correction
- Shannon (1948) — entropy-based diversity
- Gentzkow & Shapiro (2010) — content-based media slant measurement
- Groseclose & Milyo (2005) — citation-based media bias scoring
