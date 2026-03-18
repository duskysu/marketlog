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

async function tdQuote(symbol, apiKey) {
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const r = await fetch(url);
    const d = a
