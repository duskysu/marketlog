import yahooFinance from "yahoo-finance2";

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
      const data = await fetchDailyData();
      if (GEMINI_KEY) {
        data.summary = await generateSummary(GEMINI_KEY, buildDailyPrompt(data, date));
      } else {
        data.summary = "（未設定 Gemini API 金鑰）";
      }
      return res.status(200).json(data);
    }
    if (type === "monthly") {
      const data = await fetchMonthlyData(month);
      if (GEMINI_KEY) {
        data.summary = await generateSummary(GEMINI_KEY, buildMonthlyPrompt(data, month));
      } else {
        data.summary = "（未設定 Gemini API 金鑰）";
      }
      return res.status(200).json(data);
    }
    return res.status(400).json({ error: "Invalid type" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

async function getQuotes(symbols) {
  const results = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const q = await yahooFinance.quote(sym);
      const chg = q.regularMarketChangePercent;
      results[sym] = {
        value: fmt(q.regularMarketPrice, sym),
        change: chg != null ? (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%" : "—",
        dir: chg == null ? "neutral" : chg > 0 ? "pos" : chg < 0 ? "neg" : "neutral",
      };
    } catch {
      results[sym] = empty();
    }
  }));
  return results;
}

function fmt(val, sym) {
  if (val == null) return "—";
  if (sym && (sym.includes("TNX") || sym.includes("TYX") || sym.includes("IRX")))
    return val.toFixed(3) + "%";
  if (sym && (sym.includes("TWD") || sym.includes("JPY") || sym.includes("=X")))
    return val.toFixed(3);
  if (val > 1000) return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return val.toFixed(2);
}

async function fetchDailyData() {
  const symbols = [
    "^DJI", "^GSPC", "^IXIC", "^SOX", "^RUT",
    "^TWII", "2330.TW", "TWD=X",
    "^TNX", "^IRX", "^TYX", "AGG",
    "DX-Y.NYB", "EURUSD=X", "JPY=X",
    "GC=F", "CL=F", "BZ=F", "BTC-USD",
  ];
  const q = await getQuotes(symbols);
  return {
    djia:        q["^DJI"]      || empty(),
    sp500:       q["^GSPC"]     || empty(),
    nasdaq:      q["^IXIC"]     || empty(),
    sox:         q["^SOX"]      || empty(),
    russell2000: q["^RUT"]      || empty(),
    taiex:       q["^TWII"]     || empty(),
    tsmc:        q["2330.TW"]   || empty(),
    usdtwd:      q["TWD=X"]     || empty(),
    us10y:       q["^TNX"]      || empty(),
    us2y:        q["^IRX"]      || empty(),
    us30y:       q["^TYX"]      || empty(),
    agg:         q["AGG"]       || empty(),
    dxy:         q["DX-Y.NYB"]  || empty(),
    eurusd:      q["EURUSD=X"]  || empty(),
    usdjpy:      q["JPY=X"]     || empty(),
    gold:        q["GC=F"]      || empty(),
    wti:         q["CL=F"]      || empty(),
    brent:       q["BZ=F"]      || empty(),
    btc:         q["BTC-USD"]   || empty(),
  };
}

async function fetchMonthlyData(month) {
  const symbols = [
    "^GSPC", "^IXIC", "^DJI", "^TNX",
    "DX-Y.NYB", "GC=F", "^TWII", "2330.TW", "TWD=X",
  ];
  const q = await getQuotes(symbols);
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

async function fetchFREDData(month) {
  const FRED_KEY = "cfa1b3b4a3e34ae5b0a4a71da2a2a2b4";
  const base = "https://api.stlouisfed.org/fred/series/observations";
  const [year, mo] = (month || "").split("-");
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
  await Promise.all(Object.entries(seriesMap).map(async ([key, id]) => {
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
    } catch {
      results[key] = empty();
    }
  }));
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
