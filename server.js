// Smart Talk AI - backend
// The browser talks to THIS server. This server talks to Pollinations AI.
// Your API key lives only here (in the .env file / hosting environment variables)
// and is never sent to the browser.

require("dotenv").config();
const express = require("express");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_URL =
  process.env.POLLINATIONS_API_URL ||
  "https://gen.pollinations.ai/v1/chat/completions";
const API_KEY = process.env.POLLINATIONS_API_KEY || "";
const MODEL = process.env.POLLINATIONS_MODEL || "openai";

const SYSTEM_PROMPT =
  "You are Smart Talk AI, a friendly and helpful assistant. " +
  "Answer clearly and concisely. Use short paragraphs and simple lists when useful. " +
  "Reply in the same language the user writes in.";

const MAX_MESSAGES = 20; // how many recent messages are sent as context
const MAX_CHARS = 4000; // max length of one message
const REQUEST_TIMEOUT_MS = 60000;

const app = express();
app.set("trust proxy", 1); // needed on hosts like Render/Railway so IPs are correct
app.use(express.json({ limit: "200kb" }));

// ---- Very small in-memory rate limiter (per IP) -------------------------
const hits = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

function rateLimit(req, res, next) {
  const now = Date.now();
  const entry = hits.get(req.ip);
  if (!entry || now > entry.resetAt) {
    hits.set(req.ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  entry.count += 1;
  if (entry.count > MAX_PER_WINDOW) {
    const wait = Math.ceil((entry.resetAt - now) / 1000);
    res.set("Retry-After", String(wait));
    return res.status(429).json({
      error: `Too many messages. Please wait ${wait} seconds and try again.`,
    });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of hits) if (now > e.resetAt) hits.delete(ip);
}, WINDOW_MS).unref();

// ---- Helpers -------------------------------------------------------------
function cleanMessages(input) {
  if (!Array.isArray(input)) return null;
  const cleaned = input
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_MESSAGES);
  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return null;
  }
  return cleaned;
}

function friendlyUpstreamError(status) {
  if (status === 401 || status === 403) {
    return "The AI service rejected the server's API key. Check POLLINATIONS_API_KEY.";
  }
  if (status === 402) {
    return "The AI service account is out of credits.";
  }
  if (status === 429) {
    return "The AI service is busy right now. Please try again in a moment.";
  }
  if (status >= 500) {
    return "The AI service is having problems. Please try again shortly.";
  }
  return "The AI service could not complete the request.";
}

// ---- API -----------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, configured: Boolean(API_KEY), model: MODEL });
});

app.post("/api/chat", rateLimit, async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error:
        "The server is missing POLLINATIONS_API_KEY. Add it to your .env file and restart.",
    });
  }

  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages) {
    return res
      .status(400)
      .json({ error: "Send at least one message to start the chat." });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error(`Pollinations error ${upstream.status}:`, detail.slice(0, 500));
      const status = upstream.status === 429 ? 429 : 502;
      return res
        .status(status)
        .json({ error: friendlyUpstreamError(upstream.status) });
    }

    const data = await upstream.json();
    const reply =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (typeof reply !== "string" || reply.trim() === "") {
      console.error("Empty reply from Pollinations:", JSON.stringify(data).slice(0, 500));
      return res
        .status(502)
        .json({ error: "The AI returned an empty answer. Please try again." });
    }

    res.json({ reply });
  } catch (err) {
    if (err.name === "AbortError") {
      return res
        .status(504)
        .json({ error: "The AI took too long to answer. Please try again." });
    }
    console.error("Chat request failed:", err);
    res
      .status(502)
      .json({ error: "Could not reach the AI service. Please try again." });
  } finally {
    clearTimeout(timer);
  }
});

// Unknown /api routes return JSON instead of HTML
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// ---- Frontend (static files) --------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// Bad JSON etc.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: "Invalid request." });
});

app.listen(PORT, () => {
  console.log(`Smart Talk AI running at http://localhost:${PORT}`);
  if (!API_KEY) {
    console.warn(
      "WARNING: POLLINATIONS_API_KEY is not set. Chat will not work until you add it to .env"
    );
  }
});
