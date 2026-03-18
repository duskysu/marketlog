module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, date, month } = req.body || {};
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const TD_KEY = process.env.TWELVE_DATA_KEY;

  try {
    if (type === "daily") {
      const data = await fetchDailyData(TD_KEY);
      data.summary = GEMINI_KEY
        ? await generateSummary(GEMINI_KEY, buildDailyPrompt(data, date))
        : "（未設定 Gemini API 金鑰）";
      return res.status(200).json(data);
    }
    if (type === "monthly") {
      const data = await fetchMonthlyData(TD_KEY, month);
      data.summary = GEMINI_KEY
        ? await generateSummary(GEMINI_KEY, buildMonthlyPrompt(data, month))
        : "（未設定 Gemini API 金鑰）";
      return res.status(200).json(data);
    }
    return res.status(400).json({ error: "Invalid type" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};

// 循序查詢，每筆間隔 300ms 避免超過頻率限制
async function fetchSequential(pairs, apiKey) {
  const results = {};
  for (const [key, sym] of pairs) {
    results[key] = await tdQuote(sym, apiKey);
    await sleep(300);
  }
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tdQuote(symbol, apiKey) {
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.status === "error" || !d.close) return empty();
    const price = parseFloat(d.close);
    const chg = parseFloat(d.percent_change);
    return {
      value: price > 1000
        ? price.toLocaleString("en-US", { maximumFractionDigits: 2 })
        : price.toFixed(price < 10 ? 4 : 2),
      change: isNaN(chg) ? "—" : (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%",
      dir: isNaN(chg) ? "neutral" : chg > 0 ? "pos" : chg < 0 ? "neg" : "neutral",
    };
  } catch {
    return empty();
  }
}

async function fetchDailyData(apiKey) {
  const pairs = [
    ["djia",        "DJIA"],
    ["sp500",       "SPX"],
    ["nasdaq",      "IXIC"],
    ["sox",         "SOX"],
    ["russell2000", "RUT"],
    ["taiex",       "TAIEX"],
    ["tsmc",        "2330:TWSE"],
    ["usdtwd",      "USD/TWD"],
    ["us10y",       "US10Y"],
    ["us2y",        "US2Y"],
    ["us30y",       "US30Y"],
    ["agg",         "AGG"],
    ["dxy",         "DXY"],
    ["eurusd",      "EUR/USD"],
    ["usdjpy",      "USD/JPY"],
    ["gold",        "XAU/USD"],
    ["wti",         "WTI"],
    ["brent",       "BRENT"],
    ["btc",         "BTC/USD"],
  ];
  return await fetchSequential(pairs, apiKey);
}

async function fetchMonthlyData(apiKey, month) {
  const pairs = [
    ["sp500_close",  "SPX"],
    ["nasdaq_close", "IXIC"],
    ["djia_close",   "DJIA"],
    ["us10y_close",  "US10Y"],
    ["dxy_close",    "DXY"],
    ["gold_close",   "XAU/USD"],
    ["taiex_close",  "TAIEX"],
    ["tsmc_close",   "2330:TWSE"],
    ["usdtwd_close", "USD/TWD"],
  ];
  const q = await fetchSequential(pairs, apiKey);
  const macro = await fetchFREDData(month);
  return {
    ism_mfg:      empty("請手動填入"),
    ism_svc:      empty("請手動填入"),
    unemployment: macro.unemployment,
    cpi_yoy:      macro.cpi_yoy,
    core_cpi_yoy: macro.core_cpi_yoy,
    pce_yoy:      macro.pce_yoy,
    core_pce_yoy: macro.core_pce_yoy,
    fed_rate:     macro.fed_rate,
    tw_exports:   empty("請手動填入"),
    tw_orders:    empty("請手動填入"),
    tw_leading:   empty("請手動填入"),
    tw_mfg_pmi:   empty("請手動填入"),
    tw_svc_pmi:   empty("請手動填入"),
    ...q,
  };
}

async function fetchFREDData(month) {
  const FRED_KEY = "cfa1b3b4a3e34ae5b0a4a71da2a2a2b4";
  const base = "https://api.stlouisfed.org/fred/series/observations";
  const [year, mo] = (month || "2025-01").split("-");
  const obsStart = `${year}-${mo}-01`;
  const seriesMap = {
    unemployment: "UNRATE",
    cpi_yoy:      "CPIAUCSL",
    core_cpi_yoy: "CPILFESL",
    pce_yoy:      "PCEPI",
    core_pce_yoy: "PCEPILFE",
    fed_rate:     "FEDFUNDS",
  };
  const results = {};
  for (const [key, id] of Object.entries(seriesMap)) {
    try {
      const url = `${base}?series_id=${id}&observation_start=${obsStart}&sort_order=desc&limit=2&file_type=json&api_key=${FRED_KEY}`;
      const r = await fetch(url);
      const json = await r.json();
      const obs = json.observations?.[0];
      if (obs && obs.value !== ".") {
        const val = parseFloat(obs.value);
        if (key === "fed_rate") {
          results[key] = { value: val.toFixed(2) + "%", change: "—", dir: "neutral" };
        } else if (key === "unemployment") {
          results[key] = { value: val.toFixed(1) + "%", change: "—", dir: "neutral" };
        } else {
          results[key] = { value: val.toFixed(1), change: "—", dir: "neutral" };
        }
      } else {
        results[key] = empty();
      }
    } catch { results[key] = empty(); }
  }
  return results;
}

async function generateSummary(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
    }),
  });
  if (!r.ok) throw new Error("Gemini error: " + (await r.text()).slice(0, 200));
  const json = await r.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || "摘要無法生成。";
}

function buildDailyPrompt(d, date) {
  return `你是專業金融分析師，請根據以下 ${date} 的市場數據，用繁體中文寫一段150字以內的重點行情摘要。

美股：道瓊 ${d.djia?.value}(${d.djia?.change})、S&P500 ${d.sp500?.value}(${d.sp500?.change})、那斯達克 ${d.nasdaq?.value}(${d.nasdaq?.change})、費半 ${d.sox?.value}(${d.sox?.change})
台股：加權 ${d.taiex?.value}(${d.taiex?.change})、台積電 ${d.tsmc?.value}(${d.tsmc?.change})、新台幣 ${d.usdtwd?.value}
債券：美10Y ${d.us10y?.value}(${d.us10y?.change})
外匯：DXY ${d.dxy?.value}(${d.dxy?.change})、黃金 ${d.gold?.value}(${d.gold?.change})
能源：WTI ${d.wti?.value}(${d.wti?.change})、BTC ${d.btc?.value}(${d.btc?.change})

請直接輸出摘要，不要標題。`;
}

function buildMonthlyPrompt(d, month) {
  return `你是專業金融分析師，請根據以下 ${month} 的總體經濟數據，用繁體中文寫一段200字以內的月度總經分析摘要。

美國：失業率 ${d.unemployment?.value}、CPI ${d.cpi_yoy?.value}、Core CPI ${d.core_cpi_yoy?.value}、PCE ${d.pce_yoy?.value}、Fed利率 ${d.fed_rate?.value}
月收盤：S&P500 ${d.sp500_close?.value}(${d.sp500_close?.change})、那斯達克 ${d.nasdaq_close?.value}、台灣加權 ${d.taiex_close?.value}、DXY ${d.dxy_close?.value}、黃金 ${d.gold_close?.value}

請直接輸出摘要，不要標題。`;
}

function empty(msg) {
  return { value: msg || "—", change: "—", dir: "neutral" };
}
