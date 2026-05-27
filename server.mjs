import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

loadLocalEnv();

const port = Number(process.env.PORT ?? 8787);
const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";
const apiKey = process.env.OPENAI_API_KEY;

const instructions = `
당신은 World Room의 실시간 한국어 세계 만들기 동반자입니다.
사용자와 빠르게 턴을 주고받으며 설정, 인물, 갈등, 장면 훅을 함께 발명합니다.
답변은 음성 대화에 맞게 짧고 생동감 있게 말합니다.
매번 하나의 좋은 질문으로 사용자가 다음 선택을 말하게 돕습니다.
중요한 단서는 줄 앞에 "설정:", "인물:", "갈등:", "장면:" 또는 "훅:" 라벨을 붙여 남깁니다.
`;

function loadLocalEnv() {
  if (!existsSync(".env")) return;

  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed
      .slice(equalsIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function safetyIdentifier() {
  return createHash("sha256").update(process.env.WORLD_ROOM_USER_ID ?? "world-room-local-user").digest("hex");
}

async function createClientSecret() {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");
  }

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier(),
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        instructions,
        reasoning: { effort: "low" },
        audio: {
          input: {
            transcription: { model: "gpt-realtime-whisper" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              silence_duration_ms: 520,
            },
          },
          output: { voice },
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message ?? "OpenAI Realtime client secret 발급에 실패했습니다.");
  }
  return data;
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON 형식이 올바르지 않습니다."));
      }
    });
    req.on("error", reject);
  });
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function cleanTranscript(transcript) {
  if (!Array.isArray(transcript)) return [];
  return transcript
    .filter((line) => line && typeof line.text === "string" && line.text.trim())
    .map((line) => ({
      id: String(line.id ?? ""),
      speaker: String(line.speaker ?? "시스템"),
      text: line.text.trim(),
      final: Boolean(line.final),
    }));
}

export function buildSessionRecord(payload, options = {}) {
  const now = options.now ?? new Date();
  const stamp = formatTimestamp(now);
  const transcript = cleanTranscript(payload?.transcript);
  const hasConversation = transcript.some((line) => line.speaker === "사용자" || line.speaker === "동반자");

  if (!hasConversation) {
    throw new Error("저장할 대화 기록이 없습니다.");
  }

  const sparks = Array.isArray(payload?.sparks)
    ? payload.sparks.map((spark) => String(spark).trim()).filter(Boolean)
    : [];

  return {
    id: `${stamp}-world-room`,
    title: String(payload?.title || transcript.find((line) => line.speaker === "사용자")?.text || "World Room 세션").slice(0, 80),
    createdAt: now.toISOString(),
    model: options.model ?? model,
    voice: options.voice ?? voice,
    transcript,
    sparks,
  };
}

export async function saveSessionRecord(payload, options = {}) {
  const sessionsDir = options.sessionsDir ?? join(process.cwd(), "sessions");
  const record = buildSessionRecord(payload, options);
  const fileName = `${record.id}.json`;

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(sessionsDir, fileName), `${JSON.stringify(record, null, 2)}\n`, "utf8");

  return {
    ok: true,
    path: `sessions/${fileName}`,
  };
}

export function createServer() {
  return http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.url === "/health") {
    sendJson(res, 200, { ok: true, model, voice });
    return;
  }

  if (req.url === "/token" && req.method === "GET") {
    try {
      const data = await createClientSecret();
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "알 수 없는 서버 오류" });
    }
    return;
  }

  if (req.url === "/sessions" && req.method === "POST") {
    try {
      const payload = await readRequestJson(req);
      const result = await saveSessionRecord(payload);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "세션 저장에 실패했습니다." });
    }
    return;
  }

  sendJson(res, 404, { error: "찾을 수 없는 경로입니다." });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`World Room token server listening on http://localhost:${port}`);
  });
}
