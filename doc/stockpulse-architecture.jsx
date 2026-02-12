import { useState } from "react";

const modules = {
  ingestion: {
    title: "📡 Data Ingestion Layer",
    color: "#3b82f6",
    desc: "Event-driven collectors zbierające dane z wielu źródeł w real-time",
    services: [
      {
        name: "Social Collector",
        tech: "NestJS + Bull Queue",
        sources: ["Twitter/X API v2 (Filtered Stream)", "Reddit API (PRAW equiv.)", "StockTwits API", "Discord webhooks"],
        details: "Filtruje po $TICKER cashtags, key influencers, volume spikes. Rate-limit aware z exponential backoff."
      },
      {
        name: "News Collector",
        tech: "NestJS + Cheerio + Puppeteer",
        sources: ["Benzinga News API", "Finnhub News", "Yahoo Finance RSS", "SEC EDGAR RSS", "Google News"],
        details: "RSS polling co 30s + WebSocket feeds gdzie dostępne. Deduplication przez content hashing (SimHash)."
      },
      {
        name: "SEC Filing Collector",
        tech: "NestJS + EDGAR Full-Text Search",
        sources: ["EDGAR XBRL API", "13F filings", "Form 4 (insider trades)", "8-K (material events)", "10-K/10-Q"],
        details: "Monitoruje nowe filingi co 60s. Parsuje XBRL do structured JSON. Alert na insider trades > $100K."
      },
      {
        name: "Alt Data Collector",
        tech: "NestJS + Cron jobs",
        sources: ["Google Trends API", "GitHub stars/commits", "Glassdoor reviews", "Patent filings", "Job postings (Indeed/LinkedIn)"],
        details: "Daily/weekly batch collection. Normalizacja danych do wspólnego schematu."
      }
    ]
  },
  processing: {
    title: "🧠 AI Processing Layer",
    color: "#8b5cf6",
    desc: "NLP pipeline z sentiment analysis, entity recognition i event classification",
    services: [
      {
        name: "Sentiment Engine",
        tech: "FinBERT + Claude API",
        sources: ["HuggingFace FinBERT", "Claude Haiku (fast)", "Custom fine-tuned models"],
        details: "2-stage: FinBERT for bulk scoring (fast, free), Claude Haiku for nuanced analysis on high-impact items. Score: -1.0 to +1.0 z confidence level."
      },
      {
        name: "Entity Extractor (NER)",
        tech: "spaCy + Custom Rules",
        sources: ["Ticker recognition ($AAPL)", "Person detection (CEO names)", "Event types (merger, earnings)", "Price/number extraction"],
        details: "Mapuje entities do knowledge graph. Rozpoznaje aliasy (Google = Alphabet = GOOGL). Linkuje do company profiles."
      },
      {
        name: "Event Classifier",
        tech: "Claude Haiku + Rule Engine",
        sources: ["Earnings beat/miss", "FDA approval/rejection", "Insider buy/sell", "Analyst upgrade/downgrade", "M&A announcement", "Guidance change"],
        details: "Klasyfikuje events z priority score. High-priority events triggerują natychmiastowe alerty."
      },
      {
        name: "Anomaly Detector",
        tech: "Statistical + ML",
        sources: ["Mention volume spike detection", "Sentiment shift detection", "Unusual trading pattern", "Cross-source correlation"],
        details: "Z-score na volume wzmianek vs 30-day avg. Alert gdy > 3σ. Korelacja z price action w 15min windows."
      }
    ]
  },
  storage: {
    title: "💾 Data & Event Layer",
    color: "#059669",
    desc: "Event-driven architecture z CQRS pattern — Twoja domena EDA",
    services: [
      {
        name: "Event Bus",
        tech: "Redis Streams / BullMQ",
        sources: ["NewArticleEvent", "SentimentScoreEvent", "AnomalyDetectedEvent", "InsiderTradeEvent"],
        details: "Central event bus. Każdy moduł publikuje i subskrybuje events. Dead letter queue dla failed processing. Replay capability."
      },
      {
        name: "Time-Series DB",
        tech: "TimescaleDB (PostgreSQL ext.)",
        sources: ["Sentiment scores over time", "Mention volumes", "Price correlation data", "Alert history"],
        details: "Hypertables z automatic partitioning. Continuous aggregates na 1h/4h/1d. Retention policy 2 lata."
      },
      {
        name: "Search Index",
        tech: "Elasticsearch / Meilisearch",
        sources: ["Full-text article search", "Ticker-based filtering", "Date range queries", "Faceted search"],
        details: "Real-time indexing. Custom analyzers dla financial terminology. Fuzzy matching na company names."
      },
      {
        name: "Cache Layer",
        tech: "Redis",
        sources: ["Hot sentiment scores", "Trending tickers", "Rate limit counters", "Session data"],
        details: "TTL-based caching. Pub/Sub dla real-time dashboard updates. Sorted sets dla leaderboards/trending."
      }
    ]
  },
  delivery: {
    title: "📊 Delivery Layer",
    color: "#dc2626",
    desc: "Dashboard, alerty i API do własnych modeli tradingowych",
    services: [
      {
        name: "Real-time Dashboard",
        tech: "React + WebSocket + Recharts",
        sources: ["Sentiment heatmap", "Trending tickers", "Alert feed", "Anomaly timeline", "Cross-source correlation view"],
        details: "SSE/WebSocket push. Dark theme (trader-friendly). Customizable watchlists. Mobile responsive."
      },
      {
        name: "Alert System",
        tech: "NestJS + Notification service",
        sources: ["Telegram bot", "Discord webhook", "Email (SendGrid)", "Push notifications"],
        details: "Configurable alert rules per ticker. Throttling (max 1 alert per ticker per 15min). Priority levels: INFO, WARNING, CRITICAL."
      },
      {
        name: "REST/GraphQL API",
        tech: "NestJS + Swagger + GraphQL",
        sources: ["/api/sentiment/{ticker}", "/api/alerts", "/api/news/search", "/api/anomalies", "/api/filings/{ticker}"],
        details: "API keys + rate limiting. Webhook support dla external integrations. OpenAPI docs. GraphQL dla flexible queries."
      },
      {
        name: "AI Scoring Engine",
        tech: "NestJS + Claude API",
        sources: ["Composite sentiment score", "News momentum score", "Insider activity score", "Social buzz score", "Overall conviction score"],
        details: "Weighted composite score per ticker. Daily/weekly recalculation. Backtesting against historical price data."
      }
    ]
  }
};

const dataFlow = [
  { from: "Twitter/X", to: "Social Collector", type: "stream" },
  { from: "Reddit", to: "Social Collector", type: "poll" },
  { from: "News APIs", to: "News Collector", type: "stream" },
  { from: "SEC EDGAR", to: "SEC Collector", type: "poll" },
  { from: "Collectors", to: "Event Bus", type: "events" },
  { from: "Event Bus", to: "Sentiment Engine", type: "process" },
  { from: "Event Bus", to: "NER + Classifier", type: "process" },
  { from: "Processed", to: "TimescaleDB", type: "store" },
  { from: "Processed", to: "Elasticsearch", type: "index" },
  { from: "Storage", to: "Dashboard", type: "serve" },
  { from: "Anomaly", to: "Alert System", type: "notify" },
];

const techStack = [
  { category: "Runtime", items: ["Node.js 20+", "TypeScript 5.x"] },
  { category: "Framework", items: ["NestJS 10+", "Bull/BullMQ", "TypeORM"] },
  { category: "AI/NLP", items: ["Claude API (Haiku)", "FinBERT (HuggingFace)", "spaCy (Python sidecar)"] },
  { category: "Data", items: ["PostgreSQL + TimescaleDB", "Redis 7+", "Elasticsearch 8"] },
  { category: "Frontend", items: ["React 18+", "Recharts", "TanStack Query"] },
  { category: "Infra", items: ["Docker Compose", "Azure Container Apps", "GitHub Actions CI/CD"] },
  { category: "APIs", items: ["Twitter API v2", "Reddit API", "Finnhub", "SEC EDGAR", "Benzinga"] },
];

const phases = [
  {
    phase: "Phase 1 — MVP (4-6 tyg.)",
    color: "#3b82f6",
    tasks: [
      "NestJS monorepo setup z Bull queues",
      "Twitter + Reddit collectors (2 źródła)",
      "FinBERT sentiment scoring (bulk)",
      "TimescaleDB schema + basic storage",
      "Simple REST API endpoints",
      "Telegram alert bot",
      "Docker Compose local dev"
    ]
  },
  {
    phase: "Phase 2 — Core (6-8 tyg.)",
    color: "#8b5cf6",
    tasks: [
      "News API collectors (Finnhub, Benzinga)",
      "SEC EDGAR filing monitor",
      "Claude Haiku integration (nuanced analysis)",
      "Event classification pipeline",
      "Anomaly detection (z-score)",
      "React dashboard v1 (sentiment heatmap)",
      "WebSocket real-time updates"
    ]
  },
  {
    phase: "Phase 3 — Advanced (8-12 tyg.)",
    color: "#059669",
    tasks: [
      "Alt data collectors (Google Trends, patents)",
      "Cross-source correlation engine",
      "AI Scoring Engine (composite scores)",
      "GraphQL API + Swagger docs",
      "Advanced dashboard (watchlists, charts)",
      "Backtesting module vs historical prices",
      "Azure deployment + monitoring"
    ]
  },
  {
    phase: "Phase 4 — Edge (ongoing)",
    color: "#dc2626",
    tasks: [
      "Custom FinBERT fine-tuning",
      "Options flow / dark pool integration",
      "Earnings call transcript analysis",
      "Multi-language support (PL, PT-BR)",
      "Mobile app (React Native)",
      "ML-based signal generation",
      "Community features + sharing"
    ]
  }
];

const costEstimate = [
  { item: "Twitter/X API (Basic)", cost: "$100/mo", note: "Filtered Stream, 10K tweets/mo" },
  { item: "Reddit API", cost: "Free", note: "100 req/min z OAuth" },
  { item: "Finnhub", cost: "Free/$0", note: "Free tier: 60 calls/min" },
  { item: "SEC EDGAR", cost: "Free", note: "Rate limit: 10 req/sec" },
  { item: "Benzinga News", cost: "$79/mo", note: "Real-time news feed" },
  { item: "Claude API (Haiku)", cost: "~$50-150/mo", note: "Zależnie od volume" },
  { item: "TimescaleDB Cloud", cost: "$29/mo", note: "Lub self-hosted za darmo" },
  { item: "Azure Container Apps", cost: "$50-100/mo", note: "Pay-per-use" },
  { item: "Redis Cloud", cost: "$7/mo", note: "Lub self-hosted" },
  { item: "TOTAL (estimate)", cost: "$315-465/mo", note: "MVP setup" },
];

export default function StockPulseArchitecture() {
  const [activeModule, setActiveModule] = useState("ingestion");
  const [activeService, setActiveService] = useState(null);
  const [view, setView] = useState("architecture");

  const mod = modules[activeModule];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#e4e4e7",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    }}>
      {/* Header */}
      <div style={{
        padding: "32px 24px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(59,130,246,0.08) 0%, transparent 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 28 }}>⚡</span>
          <h1 style={{
            fontSize: 28,
            fontWeight: 800,
            margin: 0,
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6, #dc2626)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.5px",
          }}>StockPulse</h1>
          <span style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 4,
            background: "rgba(139,92,246,0.2)",
            color: "#a78bfa",
            fontWeight: 600,
          }}>v1.0 ARCHITECTURE</span>
        </div>
        <p style={{ margin: 0, color: "#71717a", fontSize: 13 }}>
          Intelligent Stock News Intelligence & Sentiment Analysis Platform
        </p>
        <p style={{ margin: "4px 0 0", color: "#52525b", fontSize: 11 }}>
          NestJS + Event-Driven Architecture + AI/NLP Pipeline
        </p>
      </div>

      {/* View Tabs */}
      <div style={{
        display: "flex",
        gap: 2,
        padding: "12px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        {[
          { id: "architecture", label: "🏗️ Architektura" },
          { id: "techstack", label: "🔧 Tech Stack" },
          { id: "roadmap", label: "🗺️ Roadmap" },
          { id: "costs", label: "💰 Koszty" },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              background: view === tab.id ? "rgba(59,130,246,0.15)" : "transparent",
              color: view === tab.id ? "#60a5fa" : "#71717a",
              transition: "all 0.2s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "20px 24px" }}>

        {/* ═══ ARCHITECTURE VIEW ═══ */}
        {view === "architecture" && (
          <>
            {/* Module Selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              {Object.entries(modules).map(([key, m]) => (
                <button
                  key={key}
                  onClick={() => { setActiveModule(key); setActiveService(null); }}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    border: `1px solid ${activeModule === key ? m.color : "rgba(255,255,255,0.08)"}`,
                    background: activeModule === key ? `${m.color}15` : "rgba(255,255,255,0.02)",
                    color: activeModule === key ? m.color : "#a1a1aa",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.2s",
                  }}
                >
                  {m.title}
                </button>
              ))}
            </div>

            {/* Data Flow Diagram */}
            <div style={{
              background: "rgba(255,255,255,0.02)",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.06)",
              padding: 20,
              marginBottom: 20,
              overflowX: "auto",
            }}>
              <div style={{ fontSize: 11, color: "#71717a", marginBottom: 12, fontWeight: 600 }}>
                DATA FLOW
              </div>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                color: "#a1a1aa",
                flexWrap: "wrap",
              }}>
                <span style={{ color: "#3b82f6", fontWeight: 700 }}>Sources</span>
                <span style={{ color: "#52525b" }}>→</span>
                <span style={{ background: "rgba(59,130,246,0.1)", padding: "4px 10px", borderRadius: 4, color: "#60a5fa" }}>Collectors</span>
                <span style={{ color: "#52525b" }}>→</span>
                <span style={{ background: "rgba(5,150,105,0.1)", padding: "4px 10px", borderRadius: 4, color: "#34d399" }}>Event Bus</span>
                <span style={{ color: "#52525b" }}>→</span>
                <span style={{ background: "rgba(139,92,246,0.1)", padding: "4px 10px", borderRadius: 4, color: "#a78bfa" }}>AI Pipeline</span>
                <span style={{ color: "#52525b" }}>→</span>
                <span style={{ background: "rgba(5,150,105,0.1)", padding: "4px 10px", borderRadius: 4, color: "#34d399" }}>Storage</span>
                <span style={{ color: "#52525b" }}>→</span>
                <span style={{ background: "rgba(220,38,38,0.1)", padding: "4px 10px", borderRadius: 4, color: "#f87171" }}>Dashboard / Alerts / API</span>
              </div>
            </div>

            {/* Module Description */}
            <div style={{
              padding: 16,
              background: `${mod.color}08`,
              borderRadius: 10,
              border: `1px solid ${mod.color}20`,
              marginBottom: 16,
            }}>
              <p style={{ margin: 0, fontSize: 13, color: "#a1a1aa" }}>{mod.desc}</p>
            </div>

            {/* Services Grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}>
              {mod.services.map((svc, i) => (
                <div
                  key={i}
                  onClick={() => setActiveService(activeService === i ? null : i)}
                  style={{
                    padding: 16,
                    borderRadius: 10,
                    border: `1px solid ${activeService === i ? mod.color + "40" : "rgba(255,255,255,0.06)"}`,
                    background: activeService === i ? `${mod.color}0a` : "rgba(255,255,255,0.02)",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#e4e4e7" }}>
                      {svc.name}
                    </h3>
                    <span style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: `${mod.color}15`,
                      color: mod.color,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}>{svc.tech}</span>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: activeService === i ? 12 : 0 }}>
                    {svc.sources.map((src, j) => (
                      <span key={j} style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        borderRadius: 3,
                        background: "rgba(255,255,255,0.04)",
                        color: "#71717a",
                      }}>{src}</span>
                    ))}
                  </div>

                  {activeService === i && (
                    <div style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                      fontSize: 12,
                      color: "#a1a1aa",
                      lineHeight: 1.6,
                    }}>
                      {svc.details}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ═══ TECH STACK VIEW ═══ */}
        {view === "techstack" && (
          <div style={{ display: "grid", gap: 12 }}>
            {techStack.map((cat, i) => (
              <div key={i} style={{
                padding: 16,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)",
              }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#71717a",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 10,
                }}>{cat.category}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {cat.items.map((item, j) => (
                    <span key={j} style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      background: "rgba(59,130,246,0.08)",
                      color: "#93c5fd",
                      fontSize: 12,
                      fontWeight: 500,
                    }}>{item}</span>
                  ))}
                </div>
              </div>
            ))}

            <div style={{
              marginTop: 8,
              padding: 16,
              borderRadius: 10,
              border: "1px solid rgba(139,92,246,0.2)",
              background: "rgba(139,92,246,0.05)",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa", marginBottom: 8 }}>
                💡 Dlaczego ten stack?
              </div>
              <div style={{ fontSize: 12, color: "#a1a1aa", lineHeight: 1.7 }}>
                <p style={{ margin: "0 0 8px" }}>
                  <strong style={{ color: "#e4e4e7" }}>NestJS</strong> — Twój główny stack + natywne wsparcie dla Bull queues, WebSockets, CQRS, microservices. Idealny do EDA.
                </p>
                <p style={{ margin: "0 0 8px" }}>
                  <strong style={{ color: "#e4e4e7" }}>FinBERT (Python sidecar)</strong> — Darmowy, specjalizowany model NLP do financial sentiment. Runs jako osobny microservice z REST API, wywoływany z NestJS.
                </p>
                <p style={{ margin: "0 0 8px" }}>
                  <strong style={{ color: "#e4e4e7" }}>Claude Haiku</strong> — Dla nuanced analysis: earnings call summaries, event classification, complex sentiment. Szybki + tani.
                </p>
                <p style={{ margin: "0 0 8px" }}>
                  <strong style={{ color: "#e4e4e7" }}>TimescaleDB</strong> — PostgreSQL z time-series superpowers. Znasz SQL Server — przejście jest naturalne. Continuous aggregates = automatyczne rollup'y.
                </p>
                <p style={{ margin: 0 }}>
                  <strong style={{ color: "#e4e4e7" }}>Redis Streams</strong> — Event bus bez Kafki. Prostsze, wystarczające na start. Migration path do Kafka gdy scale wymusi.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ROADMAP VIEW ═══ */}
        {view === "roadmap" && (
          <div style={{ display: "grid", gap: 16 }}>
            {phases.map((p, i) => (
              <div key={i} style={{
                padding: 20,
                borderRadius: 12,
                border: `1px solid ${p.color}25`,
                background: `${p.color}05`,
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 14,
                }}>
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    background: `${p.color}20`,
                    color: p.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 800,
                  }}>{i + 1}</div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#e4e4e7" }}>
                    {p.phase}
                  </h3>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {p.tasks.map((task, j) => (
                    <div key={j} style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      fontSize: 12,
                      color: "#a1a1aa",
                    }}>
                      <span style={{
                        marginTop: 2,
                        width: 6,
                        height: 6,
                        minWidth: 6,
                        borderRadius: "50%",
                        background: p.color,
                        opacity: 0.5,
                      }} />
                      {task}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ COSTS VIEW ═══ */}
        {view === "costs" && (
          <div>
            <div style={{
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.06)",
              overflow: "hidden",
            }}>
              {costEstimate.map((row, i) => {
                const isTotal = row.item.includes("TOTAL");
                return (
                  <div key={i} style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 1fr",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom: i < costEstimate.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    background: isTotal ? "rgba(59,130,246,0.08)" : "transparent",
                    fontSize: 12,
                  }}>
                    <span style={{
                      color: isTotal ? "#60a5fa" : "#a1a1aa",
                      fontWeight: isTotal ? 700 : 400,
                    }}>{row.item}</span>
                    <span style={{
                      color: isTotal ? "#60a5fa" : "#34d399",
                      fontWeight: 700,
                      textAlign: "right",
                    }}>{row.cost}</span>
                    <span style={{ color: "#52525b", fontSize: 11 }}>{row.note}</span>
                  </div>
                );
              })}
            </div>

            <div style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 10,
              border: "1px solid rgba(5,150,105,0.2)",
              background: "rgba(5,150,105,0.05)",
              fontSize: 12,
              color: "#a1a1aa",
              lineHeight: 1.7,
            }}>
              <strong style={{ color: "#34d399" }}>💡 Oszczędności:</strong> FinBERT jest darmowy i pokrywa ~80% sentiment analysis. Claude Haiku wchodzi tylko dla high-priority items. Self-hosted DB na Twoim home lab = $0. Twitter API Basic może wystarczyć na start — upgrade do Pro ($5K/mo) tylko jeśli potrzebujesz pełnego Firehose.
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "16px 24px",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        fontSize: 11,
        color: "#3f3f46",
        textAlign: "center",
      }}>
        StockPulse Architecture Blueprint • NestJS + EDA + AI/NLP • Designed for Przemek
      </div>
    </div>
  );
}
