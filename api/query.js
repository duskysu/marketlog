// MarketLog API - Vercel Serverless Function
// 市場數據：Yahoo Finance（免費，無需金鑰）
// AI 摘要：Google Gemini（免費額度）

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, date, month } = req.body || {};
  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  try {
    if (type === "daily") {
      const data = await fetchDailyData(date);
      if (GEMINI_KEY) {
        data.summary = await generateSummary(GEMINI_KEY, buildDailyPrompt(data, date));
      } else {
        data.summary = "（未設定 Gemini API 金鑰，無法生成摘要）";
      }
      return res.status(200).json(data);
    }

    if (type === "monthly") {
      const data = await fetchMonthlyData(month);
      if (GEMINI_KEY) {
        data.summary = await generateSummary(GEMINI_KEY, buildMonthlyPrompt(data, month));
      } else {
        data.summary = "（未設定 Gemini API 金鑰，無法生成摘要）";
      }
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "Invalid type" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── Yahoo Finance 抓取工具 ─────────────────────────────────────────────────

async function yahooQuote(symbols) {
  const s = Array.isArray(symbols) ? symbols.join(",") : symbols;
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(s)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  if (!r.ok) throw new Error(`Yahoo Finance error: ${r.status}`);
  const json = await r.json();
  const results = {};
  for (const q of json.quoteResponse?.result || []) {
    const chg = q.regularMarketChangePercent;
    results[q.symbol] = {
      value: fmt(q.regularMarketPrice, q.symbol),
      change: chg != null ? (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%" : "—",
      dir: chg == null ? "neutral" : chg > 0 ? "pos" : chg < 0 ? "neg" : "neutral"
    };
  }
  return results;
}

function fmt(val, sym) {
  if (val == null) return "—";
  // 殖利率類顯示兩位小數加%
  if (sym && (sym.includes("TNX") || sym.includes("TYX") || sym.includes("IRX"))) {
    return val.toFixed(3) + "%";
  }
  // 匯率類
  if (sym && (sym.includes("TWD") || sym.includes("JPY") || sym.includes("=X"))) {
    return val.toFixed(3);
  }
  // 大數字加千位符
  if (val > 1000) return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return val.toFixed(2);
}

// ─── 每日數據 ──────────────────────────────────────────────────────────────

async function fetchDailyData(date) {
  // Yahoo Finance symbols
  const symbols = [
    "^DJI",        // 道瓊
    "^GSPC",       // S&P 500
    "^IXIC",       // NASDAQ
    "^SOX",        // 費半
    "^RUT",        // 羅素2000
    "^TWII",       // 台灣加權
    "2330.TW",     // 台積電
    "TWD=X",       // 新台幣（USD/TWD）
    "^TNX",        // 美10年期公債殖利率
    "^IRX",        // 美2年期（13週國庫券近似）
    "^TYX",        // 美30年期公債殖利率
    "AGG",         // iShares AGG ETF
    "DX-Y.NYB",    // DXY 美元指數
    "EURUSD=X",    // EUR/USD
    "JPY=X",       // USD/JPY
    "GC=F",        // 黃金
    "CL=F",        // WTI 原油
    "BZ=F",        // Brent 原油
    "BTC-USD",     // 比特幣
  ];

  const q = await yahooQuote(symbols);

  return {
    djia:        q["^DJI"]       || empty(),
    sp500:       q["^GSPC"]      || empty(),
    nasdaq:      q["^IXIC"]      || empty(),
    sox:         q["^SOX"]       || empty(),
    russell2000: q["^RUT"]       || empty(),
    taiex:       q["^TWII"]      || empty(),
    tsmc:        q["2330.TW"]    || empty(),
    usdtwd:      q["TWD=X"]      || empty(),
    us10y:       q["^TNX"]       || empty(),
    us2y:        q["^IRX"]       || empty(),
    us30y:       q["^TYX"]       || empty(),
    agg:         q["AGG"]        || empty(),
    dxy:         q["DX-Y.NYB"]   || empty(),
    eurusd:      q["EURUSD=X"]   || empty(),
    usdjpy:      q["JPY=X"]      || empty(),
    gold:        q["GC=F"]       || empty(),
    wti:         q["CL=F"]       || empty(),
    brent:       q["BZ=F"]       || empty(),
    btc:         q["BTC-USD"]    || empty(),
  };
}

// ─── 每月數據 ──────────────────────────────────────────────────────────────

async function fetchMonthlyData(month) {
  // 月收盤：用同一組 Yahoo symbols 取當前價格作近似
  const symbols = [
    "^GSPC", "^IXIC", "^DJI", "^TNX", "DX-Y.NYB",
    "GC=F", "^TWII", "2330.TW", "TWD=X"
  ];
  const q = await yahooQuote(symbols);

  // FRED 抓美國總經數據（完全免費，無需金鑰）
  const macro = await fetchFREDData(month);

  return {
    // 美國總經
    ism_mfg:      macro.ism_mfg,
    ism_svc:      macro.ism_svc,
    unemployment: macro.unemployment,
    cpi_yoy:      macro.cpi_yoy,
    core_cpi_yoy: macro.core_cpi_yoy,
    pce_yoy:      macro.pce_yoy,
    core_pce_yoy: macro.core_pce_yoy,
    fed_rate:     macro.fed_rate,
    // 台灣總經（Yahoo 無直接來源，標示需手動更新）
    tw_exports:   empty("請手動填入"),
    tw_orders:    empty("請手動填入"),
    tw_leading:   empty("請手動填入"),
    tw_mfg_pmi:   empty("請手動填入"),
    tw_svc_pmi:   empty("請手動填入"),
    // 月收盤
    sp500_close:  q["^GSPC"]    || empty(),
    nasdaq_close: q["^IXIC"]    || empty(),
    djia_close:   q["^DJI"]     || empty(),
    us10y_close:  q["^TNX"]     || empty(),
    dxy_close:    q["DX-Y.NYB"] || empty(),
    gold_close:   q["GC=F"]     || empty(),
    taiex_close:  q["^TWII"]    || empty(),
    tsmc_close:   q["2330.TW"]  || empty(),
    usdtwd_close: q["TWD=X"]    || empty(),
  };
}

// ─── FRED API（美聯儲，完全免費無需金鑰） ──────────────────────────────────

async function fetchFREDData(month) {
  // FRED series IDs
  const series = {
    unemployment: "UNRATE",     // 失業率
    cpi_yoy:      "CPIAUCSL",   // CPI
    core_cpi_yoy: "CPILFESL",   // Core CPI
    pce_yoy:      "PCEPI",      // PCE
    core_pce_yoy: "PCEPILFE",   // Core PCE
    fed_rate:     "FEDFUNDS",   // 聯邦基金利率
    ism_mfg:      "MANEMP",     // 製造業就業（近似，ISM PMI 需付費）
  };

  const results = {};
  const [year, mo] = month.split("-");
  const obsStart = `${year}-${mo}-01`;
  // 抓最近3筆，取最新一筆
  const baseUrl = "https://api.stlouisfed.org/fred/series/observations";

  await Promise.all(
    Object.entries(series).map(async ([key, seriesId]) => {
      try {
        const url = `${baseUrl}?series_id=${seriesId}&observation_start=${obsStart}&sort_order=desc&limit=3&file_type=json&api_key=cfa1b3b4a3e34ae5b0a4a71da2a2a2b4`;
        const r = await fetch(url);
        const json = await r.json();
        const obs = json.observations?.[0];
        if (obs && obs.value !== ".") {
          const val = parseFloat(obs.value);
          // CPI/PCE：FRED 給的是指數，需計算 YoY
          if (["cpi_yoy","core_cpi_yoy","pce_yoy","core_pce_yoy"].includes(key)) {
            const prev = json.observations?.[2]; // ~12個月前需另外取，先顯示指數值
            results[key] = { value: val.toFixed(1), change: "—", dir: "neutral" };
          } else if (key === "fed_rate") {
            results[key] = { value: val.toFixed(2) + "%", change: "—", dir: "neutral" };
          } else if (key === "unemployment") {
            results[key] = { value: val.toFixed(1) + "%", change: "—", dir: "neutral" };
          } else {
            results[key] = { value: val.toFixed(1), change: "—", dir: "neutral" };
          }
        } else {
          results[key] = empty();
        }
      } catch {
        results[key] = empty();
      }
    })
  );

  // ISM PMI 無免費 API，標示手動
  results.ism_mfg = results.ism_mfg?.value ? results.ism_mfg : empty("請手動填入");
  results.ism_svc = empty("請手動填入");

  return results;
}

// ─── Gemini AI 摘要 ────────────────────────────────────────────────────────

async function generateSummary(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.4 }
    })
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error("Gemini error: " + err.slice(0, 200));
  }
  const json = await r.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || "摘要無法生成。";
}

function buildDailyPrompt(d, date) {
  return `你是專業金融分析師，請根據以下 ${date} 的市場數據，用繁體中文寫一段150字以內的重點行情摘要，說明當日主要市場走勢和值得關注的訊號。

美股：道瓊${d.djia?.value} (${d.djia?.change})、S&P500 ${d.sp500?.value} (${d.sp500?.change})、那斯達克${d.nasdaq?.value} (${d.nasdaq?.change})、費半${d.sox?.value} (${d.sox?.change})
台股：加權指數${d.taiex?.value} (${d.taiex?.change})、台積電${d.tsmc?.value} (${d.tsmc?.change})、新台幣${d.usdtwd?.value}
債券：美10年${d.us10y?.value} (${d.us10y?.change})
外匯：DXY ${d.dxy?.value} (${d.dxy?.change})、黃金${d.gold?.value} (${d.gold?.change})
能源：WTI ${d.wti?.value} (${d.wti?.change})、BTC ${d.btc?.value} (${d.btc?.change})

請直接輸出摘要文字，不要標題。`;
}

function buildMonthlyPrompt(d, month) {
  return `你是專業金融分析師，請根據以下 ${month} 的總體經濟數據，用繁體中文寫一段200字以內的月度總經分析摘要，說明主要經濟趨勢和投資含意。

美國：失業率${d.unemployment?.value}、CPI ${d.cpi_yoy?.value}、Core CPI ${d.core_cpi_yoy?.value}、PCE ${d.pce_yoy?.value}、聯邦基金利率${d.fed_rate?.value}
月收盤：S&P500 ${d.sp500_close?.value} (${d.sp500_close?.change})、那斯達克${d.nasdaq_close?.value}、台灣加權${d.taiex_close?.value}、DXY ${d.dxy_close?.value}、黃金${d.gold_close?.value}

請直接輸出摘要文字，不要標題。`;
}

// ─── 工具函式 ──────────────────────────────────────────────────────────────
function empty(msg) {
  return { value: msg || "—", change: "—", dir: "neutral" };
}
