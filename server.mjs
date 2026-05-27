import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

loadLocalEnv();

const port = Number(process.env.PORT ?? 8787);
const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";
const apiKey = process.env.OPENAI_API_KEY;
const summaryModel = process.env.OPENAI_SUMMARY_MODEL ?? "gpt-5.4-mini";
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function createDefaultRepository() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return createSupabaseRepository(supabase);
}

function safetyIdentifier() {
  return createHash("sha256").update(process.env.WORLD_ROOM_USER_ID ?? "world-room-local-user").digest("hex");
}

export async function createClientSecret() {
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

export function readRequestJson(req) {
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

function toCardType(type) {
  const map = {
    settings: "setting",
    characters: "character",
    conflicts: "conflict",
    sceneHooks: "scene_hook",
  };
  return map[type];
}

function createCanonCards(worldId, sessionId, canonUpdates = {}) {
  return Object.entries(canonUpdates).flatMap(([group, values]) => {
    const type = toCardType(group);
    if (!type || !Array.isArray(values)) return [];

    return values
      .map((value, index) => String(value).trim())
      .filter(Boolean)
      .map((content, index) => ({
        id: `${sessionId}-${type}-${index + 1}`,
        worldId,
        type,
        title: content.slice(0, 80),
        content,
        sourceSessionId: sessionId,
      }));
  });
}

function normalizeSummary(summary, fallbackTitle) {
  return {
    title: String(summary?.title || fallbackTitle || "World Room 세션").slice(0, 80),
    summary: String(summary?.summary || ""),
    canonUpdates: {
      settings: Array.isArray(summary?.canonUpdates?.settings) ? summary.canonUpdates.settings : [],
      characters: Array.isArray(summary?.canonUpdates?.characters) ? summary.canonUpdates.characters : [],
      conflicts: Array.isArray(summary?.canonUpdates?.conflicts) ? summary.canonUpdates.conflicts : [],
      sceneHooks: Array.isArray(summary?.canonUpdates?.sceneHooks) ? summary.canonUpdates.sceneHooks : [],
    },
    nextQuestions: Array.isArray(summary?.nextQuestions) ? summary.nextQuestions : [],
    continuityBrief: String(summary?.continuityBrief || summary?.summary || ""),
  };
}

async function summarizeSession(payload) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");
  }

  const transcriptText = cleanTranscript(payload.transcript)
    .map((line) => `${line.speaker}: ${line.text}`)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier(),
    },
    body: JSON.stringify({
      model: summaryModel,
      input: [
        {
          role: "system",
          content:
            "당신은 작가 작업실 World Room의 세션 정리자입니다. 사용자의 세계 만들기 대화를 한국어 JSON으로 구조화합니다.",
        },
        {
          role: "user",
          content: `아래 transcript와 world sparks를 바탕으로 저장용 JSON만 반환하세요.
필드: title, summary, canonUpdates(settings, characters, conflicts, sceneHooks), nextQuestions, continuityBrief.

TRANSCRIPT:
${transcriptText}

SPARKS:
${(payload.sparks ?? []).join("\n")}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "world_room_session_summary",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title", "summary", "canonUpdates", "nextQuestions", "continuityBrief"],
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              canonUpdates: {
                type: "object",
                additionalProperties: false,
                required: ["settings", "characters", "conflicts", "sceneHooks"],
                properties: {
                  settings: { type: "array", items: { type: "string" } },
                  characters: { type: "array", items: { type: "string" } },
                  conflicts: { type: "array", items: { type: "string" } },
                  sceneHooks: { type: "array", items: { type: "string" } },
                },
              },
              nextQuestions: { type: "array", items: { type: "string" } },
              continuityBrief: { type: "string" },
            },
          },
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message ?? "세션 요약 생성에 실패했습니다.");
  }

  const text = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).find((item) => item.text)?.text;
  if (!text) {
    throw new Error("세션 요약 응답이 비어 있습니다.");
  }
  return JSON.parse(text);
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

  const fallbackTitle = String(payload?.title || transcript.find((line) => line.speaker === "사용자")?.text || "World Room 세션").slice(0, 80);
  const summary = normalizeSummary(options.summary, fallbackTitle);
  const worldId = payload?.worldId || `world-${stamp}`;
  const sessionId = `${stamp}-world-room`;

  const session = {
    id: sessionId,
    worldId,
    title: summary.title,
    createdAt: now.toISOString(),
    model: options.model ?? model,
    voice: options.voice ?? voice,
    transcript,
    sparks,
    summary: summary.summary,
    nextQuestions: summary.nextQuestions,
  };

  return {
    world: {
      id: worldId,
      title: summary.title,
      summary: summary.summary,
      continuityBrief: summary.continuityBrief,
      latestSessionId: sessionId,
    },
    session,
    canonCards: createCanonCards(worldId, sessionId, summary.canonUpdates),
  };
}

export async function saveSessionRecord(payload, options = {}) {
  const summary = options.summary ?? (options.summarize ? await options.summarize(payload) : await summarizeSession(payload));
  const record = buildSessionRecord(payload, { ...options, summary });
  const repository = options.repository ?? createDefaultRepository();

  if (!repository) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.");
  }

  return repository.saveSession(record);
}

export async function listRecentWorlds(limit = 3) {
  const repository = createDefaultRepository();
  if (!repository) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.");
  }
  return repository.listRecentWorlds(limit);
}

export function handleOptions(req, res) {
  if (req.method !== "OPTIONS") return false;
  sendJson(res, 204, {});
  return true;
}

export { sendJson };

export function createSupabaseRepository(supabase) {
  async function assertNoError(result) {
    if (result?.error) {
      throw new Error(result.error.message ?? "Supabase 저장에 실패했습니다.");
    }
    return result;
  }

  return {
    async saveSession(record) {
      await assertNoError(
        await supabase
          .from("worlds")
          .upsert({
            id: record.world.id,
            title: record.world.title,
            summary: record.world.summary,
            continuity_brief: record.world.continuityBrief,
            updated_at: new Date().toISOString(),
          })
          .select()
          .limit(1),
      );

      await assertNoError(
        await supabase
          .from("sessions")
          .upsert({
            id: record.session.id,
            world_id: record.session.worldId,
            title: record.session.title,
            transcript: record.session.transcript,
            sparks: record.session.sparks,
            summary: record.session.summary,
            next_questions: record.session.nextQuestions,
            model: record.session.model,
            voice: record.session.voice,
            created_at: record.session.createdAt,
          })
          .select()
          .limit(1),
      );

      if (record.canonCards.length) {
        await assertNoError(
          await supabase.from("canon_cards").insert(
            record.canonCards.map((card) => ({
              id: card.id,
              world_id: card.worldId,
              type: card.type,
              title: card.title,
              content: card.content,
              source_session_id: card.sourceSessionId,
            })),
          ),
        );
      }

      await assertNoError(
        await supabase
          .from("worlds")
          .update({
            latest_session_id: record.world.latestSessionId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", record.world.id)
          .select()
          .limit(1),
      );

      return {
        ok: true,
        path: `supabase/worlds/${record.world.id}`,
        worldId: record.world.id,
        sessionId: record.session.id,
      };
    },

    async listRecentWorlds(limit = 3) {
      const result = await assertNoError(
        await supabase
          .from("worlds")
          .select("id,title,summary,continuity_brief,latest_session_id,updated_at")
          .order("updated_at", { ascending: false })
          .limit(limit),
      );

      return (result.data ?? []).map((world) => ({
        id: world.id,
        title: world.title,
        summary: world.summary,
        continuityBrief: world.continuity_brief,
        latestSessionId: world.latest_session_id,
        updatedAt: world.updated_at,
      }));
    },
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

  if (req.url === "/worlds/recent" && req.method === "GET") {
    try {
      sendJson(res, 200, { worlds: await listRecentWorlds(3) });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "최근 세계를 불러오지 못했습니다." });
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
