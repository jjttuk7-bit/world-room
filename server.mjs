import { createHash, randomUUID } from "node:crypto";
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
const defaultWorkspaceOwnerId = process.env.WORLD_ROOM_OWNER_ID ?? "00000000-0000-0000-0000-000000000001";

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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function errorPayload(error, fallback = "요청을 처리하지 못했습니다.") {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : "UPSTREAM_FAILURE";
  const message = error instanceof Error ? error.message : fallback;
  return { status, body: { error: { code, message } } };
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

const STORY_LIMITS = Object.freeze({
  worldCharacters: 3000,
  transcriptItems: 16,
  transcriptCharacters: 10000,
  canonItems: 24,
  canonCharacters: 6000,
  itemCharacters: 1000,
});

function boundedText(value, label, max) {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new Error(`${label}은 ${max}자 이하여야 합니다.`);
  return text;
}

function uniqueIds(items) {
  return [...new Set(items.map((item) => String(item.id ?? "").trim()).filter(Boolean))];
}

function parseResponseText(data) {
  const text = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).find((item) => item.text)?.text;
  if (!text) throw new Error("장면 초안 응답이 비어 있습니다.");
  try { return JSON.parse(text); } catch { throw new Error("장면 초안 응답 형식이 올바르지 않습니다."); }
}

function sentenceCount(body) {
  return String(body).trim().split(/[.!?…。]+(?:\s|$)/).filter(Boolean).length;
}

const CREATIVE_BRIEF_LIMITS = Object.freeze({
  intent: 1200,
  conflict: 800,
  tone: 400,
  requiredElements: 8,
  requiredElement: 240,
  sessionGoal: 600,
});

function validateCreativeBriefRequestUnsafe(payload) {
  const intent = boundedText(payload?.intent, "창작 의도", CREATIVE_BRIEF_LIMITS.intent);
  if (!intent) throw new Error("창작 의도가 필요합니다.");
  const conflict = boundedText(payload?.conflict, "핵심 갈등", CREATIVE_BRIEF_LIMITS.conflict);
  const tone = boundedText(payload?.tone, "분위기와 문체", CREATIVE_BRIEF_LIMITS.tone);
  const rawElements = Array.isArray(payload?.requiredElements) ? payload.requiredElements : [];
  if (rawElements.length > CREATIVE_BRIEF_LIMITS.requiredElements) throw new Error("반드시 포함할 요소는 최대 8개까지 입력할 수 있습니다.");
  const requiredElements = rawElements.map((item) => boundedText(item, "반드시 포함할 요소", CREATIVE_BRIEF_LIMITS.requiredElement)).filter(Boolean);
  const sessionGoal = boundedText(payload?.sessionGoal, "이번 대화의 목표", CREATIVE_BRIEF_LIMITS.sessionGoal);
  return { intent, conflict, tone, requiredElements, sessionGoal };
}

export function validateCreativeBriefRequest(payload) {
  try {
    return validateCreativeBriefRequestUnsafe(payload);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "VALIDATION_ERROR", error instanceof Error ? error.message : "창작 브리프 요청이 올바르지 않습니다.");
  }
}

function parseCreativeBriefResponse(data) {
  const generated = parseResponseText(data);
  return validateCreativeBriefRequestUnsafe(generated);
}

export async function generateCreativeBrief(payload, options = {}) {
  const request = validateCreativeBriefRequest(payload);
  const secret = options.apiKey ?? apiKey;
  if (!secret) throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "OpenAI-Safety-Identifier": safetyIdentifier() },
    body: JSON.stringify({
      model: process.env.OPENAI_BRIEF_MODEL ?? summaryModel,
      input: [
        { role: "system", content: "당신은 한국어 소설 창작 스튜디오의 기획 편집자입니다. 사용자의 창작 의도를 존중해 대화를 시작하기 전의 짧고 구체적인 창작 브리프를 제안합니다. 알 수 없는 내용은 빈 문자열 또는 빈 배열로 두며, 이야기를 새로 시작하거나 설정을 단정하지 않습니다." },
        { role: "user", content: JSON.stringify(request) },
      ],
      text: { format: { type: "json_schema", name: "world_room_creative_brief", schema: { type: "object", additionalProperties: false, required: ["intent", "conflict", "tone", "requiredElements", "sessionGoal"], properties: { intent: { type: "string" }, conflict: { type: "string" }, tone: { type: "string" }, requiredElements: { type: "array", items: { type: "string" } }, sessionGoal: { type: "string" } } } } },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "창작 브리프 제안에 실패했습니다.");
  return { ...parseCreativeBriefResponse(data), approved: false };
}

export function buildApprovedBriefOpeningContext(brief) {
  if (!brief?.approved) return "";
  const approved = validateCreativeBriefRequestUnsafe(brief);
  return [
    "오늘의 창작 브리프:",
    `창작 의도: ${approved.intent}`,
    approved.conflict && `핵심 갈등: ${approved.conflict}`,
    approved.tone && `분위기와 문체: ${approved.tone}`,
    approved.requiredElements.length > 0 && `반드시 포함할 요소: ${approved.requiredElements.join(", ")}`,
    approved.sessionGoal && `이번 대화의 목표: ${approved.sessionGoal}`,
    "새 이야기를 독단적으로 시작하지 말고, 이 브리프의 어느 지점부터 열지 한 가지 질문으로 물으세요.",
  ].filter(Boolean).join("\n");
}
function validateStoryDraftRequestUnsafe(payload) {
  const worldId = String(payload?.worldId ?? "").trim();
  if (!worldId) throw new Error("세계 ID가 필요합니다.");
  const sessionId = String(payload?.sessionId ?? "").trim() || null;
  const worldTitle = boundedText(payload?.world?.title, "세계 제목", 160);
  const continuityBrief = boundedText(payload?.world?.continuityBrief ?? payload?.world?.summary, "세계 설명", STORY_LIMITS.worldCharacters);
  const rawTranscript = Array.isArray(payload?.transcript) ? payload.transcript : [];
  if (!rawTranscript.length) throw new Error("장면 초안에 사용할 대화가 없습니다.");
  if (rawTranscript.length > STORY_LIMITS.transcriptItems) throw new Error("대화 맥락은 최대 16개까지 사용할 수 있습니다.");
  const transcript = rawTranscript.map((line) => ({
    id: boundedText(line?.id, "대화 ID", 160),
    speaker: boundedText(line?.speaker ?? "대화자", "화자", 80),
    text: boundedText(line?.text, "대화 내용", STORY_LIMITS.itemCharacters),
  }));
  if (transcript.some((line) => !line.id || !line.text)) throw new Error("대화 ID와 내용이 필요합니다.");
  if (transcript.reduce((total, line) => total + line.text.length, 0) > STORY_LIMITS.transcriptCharacters) throw new Error("대화 맥락이 너무 깁니다.");
  const rawCanon = Array.isArray(payload?.canon) ? payload.canon : [];
  if (rawCanon.length > STORY_LIMITS.canonItems) throw new Error("세계 성경은 최대 24개까지 사용할 수 있습니다.");
  const canon = rawCanon.map((card) => ({
    id: boundedText(card?.id, "세계 성경 ID", 160),
    type: boundedText(card?.type ?? "setting", "세계 성경 종류", 80),
    content: boundedText(card?.content, "세계 성경 내용", STORY_LIMITS.itemCharacters),
  }));
  if (canon.some((card) => !card.id || !card.content)) throw new Error("세계 성경 ID와 내용이 필요합니다.");
  if (canon.reduce((total, card) => total + card.content.length, 0) > STORY_LIMITS.canonCharacters) throw new Error("세계 성경 맥락이 너무 깁니다.");
  return { worldId, sessionId, world: { title: worldTitle, continuityBrief }, transcript, canon };
}

export function validateStoryDraftRequest(payload) {
  try {
    return validateStoryDraftRequestUnsafe(payload);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "VALIDATION_ERROR", error instanceof Error ? error.message : "장면 초안 요청이 올바르지 않습니다.");
  }
}
export async function generateStoryDraft(payload, options = {}) {
  const context = validateStoryDraftRequest(payload);
  const secret = options.apiKey ?? apiKey;
  if (!secret) throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "OpenAI-Safety-Identifier": safetyIdentifier() },
    body: JSON.stringify({
      model: process.env.OPENAI_STORY_MODEL ?? summaryModel,
      input: [{ role: "system", content: "당신은 한국어 소설 창작 스튜디오의 장면 초안 작가입니다. 제공된 세계와 대화 근거만 사용해 3~6문장의 응집된 장면을 작성합니다. 설정을 확정하지 말고 제안으로 씁니다." }, { role: "user", content: JSON.stringify(context) }],
      text: {
        format: {
          type: "json_schema",
          name: "world_room_story_draft",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title", "body", "sourceTranscriptIds", "relatedCanonIds"],
            properties: {
              title: { type: "string" },
              body: { type: "string" },
              sourceTranscriptIds: { type: "array", items: { type: "string" } },
              relatedCanonIds: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "장면 초안 생성에 실패했습니다.");
  const generated = parseResponseText(data);
  const title = boundedText(generated.title, "초안 제목", 160);
  const body = boundedText(generated.body, "초안 본문", 5000);
  const sentences = sentenceCount(body);
  if (sentences < 3 || sentences > 6) throw new Error("장면 초안은 3~6문장이어야 합니다.");
  const sourceTranscriptIds = uniqueIds(Array.isArray(generated.sourceTranscriptIds) ? generated.sourceTranscriptIds.map((id) => ({ id })) : []);
  const relatedCanonIds = uniqueIds(Array.isArray(generated.relatedCanonIds) ? generated.relatedCanonIds.map((id) => ({ id })) : []);
  const availableTranscriptIds = new Set(uniqueIds(context.transcript));
  const availableCanonIds = new Set(uniqueIds(context.canon));
  if (sourceTranscriptIds.some((id) => !availableTranscriptIds.has(id))) throw new Error("초안이 제공되지 않은 대화 근거를 참조했습니다.");
  if (relatedCanonIds.some((id) => !availableCanonIds.has(id))) throw new Error("초안이 제공되지 않은 세계 성경 근거를 참조했습니다.");
  return { id: `draft-${randomUUID()}`, worldId: context.worldId, sessionId: context.sessionId, title, body, status: "proposed", sourceTranscriptIds, relatedCanonIds, createdAt: new Date().toISOString() };
}

export async function createGeneratedStoryDraft(payload, options = {}) {
  const context = validateStoryDraftRequest(payload);
  const repository = options.repository ?? createDefaultRepository();
  if (!repository) throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.");
  await repository.assertWorldOwned(context.worldId);
  const draft = await generateStoryDraft(context, options);
  return repository.insertStoryDraft(draft, { worldChecked: true });
}
export async function getWorldStory(worldId, options = {}) {
  const cleanWorldId = String(worldId ?? "").trim();
  if (!cleanWorldId) throw new ApiError(400, "VALIDATION_ERROR", "세계 ID가 필요합니다.");
  const repository = options.repository ?? createDefaultRepository();
  if (!repository) throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.");
  await repository.assertWorldOwned(cleanWorldId);
  const [scenes, canon] = await Promise.all([
    repository.listWorldManuscript(cleanWorldId, { worldChecked: true }),
    repository.listWorldCanon(cleanWorldId, { worldChecked: true }),
  ]);
  return { worldId: cleanWorldId, scenes, canon };
}

export async function listWorldDrafts(worldId, options = {}) {
  const cleanWorldId = String(worldId ?? "").trim();
  if (!cleanWorldId) throw new ApiError(400, "VALIDATION_ERROR", "세계 ID가 필요합니다.");
  const repository = options.repository ?? createDefaultRepository();
  if (!repository) throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.");
  await repository.assertWorldOwned(cleanWorldId);
  return { worldId: cleanWorldId, drafts: await repository.listStoryDrafts(cleanWorldId, { worldChecked: true }) };
}

export async function holdSavedStoryDraft(worldId, draftId, options = {}) {
  const cleanWorldId = String(worldId ?? "").trim();
  const cleanDraftId = String(draftId ?? "").trim();
  if (!cleanWorldId || !cleanDraftId) throw new ApiError(400, "VALIDATION_ERROR", "세계 ID와 초안 ID가 필요합니다.");
  const repository = options.repository ?? createDefaultRepository();
  if (!repository) throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.");
  await repository.assertWorldOwned(cleanWorldId);
  return repository.holdStoryDraft(cleanWorldId, cleanDraftId, { worldChecked: true });
}

export async function reviseSavedStoryDraft(worldId, draftId, payload, options = {}) {
  const cleanWorldId = String(worldId ?? "").trim();
  const cleanDraftId = String(draftId ?? "").trim();
  if (!cleanWorldId || !cleanDraftId) throw new Error("세계 ID와 초안 ID가 필요합니다.");
  const title = boundedText(payload?.title, "초안 제목", 160);
  const body = boundedText(payload?.body, "초안 본문", 5000);
  const sentences = sentenceCount(body);
  if (sentences < 3 || sentences > 6) throw new Error("장면 초안은 3~6문장이어야 합니다.");
  const repository = options.repository ?? createDefaultRepository();
  if (!repository) throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.");
  return repository.reviseStoryDraft(cleanWorldId, cleanDraftId, { id: `draft-${randomUUID()}`, title, body, createdAt: new Date().toISOString() });
}

export async function acceptSavedStoryDraft(worldId, draftId, options = {}) {
  const cleanWorldId = String(worldId ?? "").trim();
  const cleanDraftId = String(draftId ?? "").trim();
  if (!cleanWorldId || !cleanDraftId) throw new Error("세계 ID와 초안 ID가 필요합니다.");
  const repository = options.repository ?? createDefaultRepository();
  if (!repository) throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.");
  return repository.acceptStoryDraft(cleanWorldId, cleanDraftId);
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

export async function deleteWorldRecord(worldId, options = {}) {
  const cleanWorldId = String(worldId ?? "").trim();
  if (!cleanWorldId) {
    throw new Error("삭제할 세계 ID가 없습니다.");
  }

  const repository = options.repository ?? createDefaultRepository();
  if (!repository) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.");
  }
  return repository.deleteWorld(cleanWorldId);
}

export function handleOptions(req, res) {
  if (req.method !== "OPTIONS") return false;
  sendJson(res, 204, {});
  return true;
}

export function sendApiError(res, error, fallback) {
  const { status, body } = errorPayload(error, fallback);
  sendJson(res, status, body);
}

export { sendJson };

export function createSupabaseRepository(supabase, { ownerId = defaultWorkspaceOwnerId } = {}) {
  async function assertWorldOwned(worldId) {
    const result = await assertNoError(
      await supabase.from("worlds").select("id").eq("id", worldId).eq("owner_id", ownerId).limit(1),
    );
    const world = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!world?.id) throw new ApiError(403, "WORLD_ACCESS_DENIED", "이 세계에 접근할 권한이 없습니다.");
    return world;
  }

  function toStoryDraft(row) {
    return {
      id: row.id, worldId: row.world_id, sessionId: row.session_id, title: row.title, body: row.body, status: row.status,
      sourceTranscriptIds: [...(row.source_transcript_ids ?? [])], relatedCanonIds: [...(row.related_canon_ids ?? [])],
      parentDraftId: row.parent_draft_id, createdAt: row.created_at,
    };
  }
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
            owner_id: ownerId,
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
            owner_id: ownerId,
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
              owner_id: ownerId,
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
          .eq("owner_id", ownerId)
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

    assertWorldOwned,

    async insertStoryDraft(draft, { worldChecked = false } = {}) {
      if (!worldChecked) await assertWorldOwned(draft.worldId);
      await assertNoError(
        await supabase.from("story_drafts").insert({
          id: draft.id,
          world_id: draft.worldId,
          owner_id: ownerId,
          session_id: draft.sessionId ?? null,
          title: draft.title,
          body: draft.body,
          status: draft.status ?? "proposed",
          source_transcript_ids: [...(draft.sourceTranscriptIds ?? [])],
          related_canon_ids: [...(draft.relatedCanonIds ?? [])],
          parent_draft_id: draft.parentDraftId ?? null,
          created_at: draft.createdAt ?? new Date().toISOString(),
        }),
      );
      return { ...draft };
    },

    async reviseStoryDraft(worldId, draftId, revision, { worldChecked = false } = {}) {
      if (!worldChecked) await assertWorldOwned(worldId);
      const result = await assertNoError(
        await supabase.rpc("revise_story_draft", {
          p_world_id: worldId,
          p_parent_draft_id: draftId,
          p_revision_id: revision.id,
          p_title: revision.title,
          p_body: revision.body,
          p_owner_id: ownerId,
          p_created_at: revision.createdAt ?? new Date().toISOString(),
        }),
      );
      const created = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!created) {
        throw new Error("수정된 초안을 찾을 수 없습니다.");
      }
      return {
        id: created.id,
        worldId: created.world_id,
        sessionId: created.session_id,
        title: created.title,
        body: created.body,
        status: created.status,
        sourceTranscriptIds: [...(created.source_transcript_ids ?? [])],
        relatedCanonIds: [...(created.related_canon_ids ?? [])],
        parentDraftId: created.parent_draft_id,
        createdAt: created.created_at,
      };
    },

    async acceptStoryDraft(worldId, draftId, acceptedAt = new Date().toISOString(), { worldChecked = false } = {}) {
      if (!worldChecked) await assertWorldOwned(worldId);
      const result = await assertNoError(
        await supabase.rpc("accept_story_draft", {
          p_world_id: worldId,
          p_draft_id: draftId,
          p_scene_id: `scene-${draftId}`,
          p_owner_id: ownerId,
          p_accepted_at: acceptedAt,
        }),
      );
      const scene = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!scene) {
        throw new Error("초안 채택 결과를 찾을 수 없습니다.");
      }
      return {
        id: scene.id,
        worldId: scene.world_id,
        draftId: scene.draft_id,
        title: scene.title,
        content: scene.content,
        order: scene.sequence,
        acceptedAt: scene.accepted_at,
        sourceTranscriptIds: [...(scene.source_transcript_ids ?? [])],
        relatedCanonIds: [...(scene.related_canon_ids ?? [])],
      };
    },
    async listWorldManuscript(worldId, { worldChecked = false } = {}) {
      if (!worldChecked) await assertWorldOwned(worldId);
      const result = await assertNoError(
        await supabase
          .from("story_scenes")
          .select("id,world_id,draft_id,title,content,sequence,status,accepted_at,source_transcript_ids,related_canon_ids")
          .eq("world_id", worldId)
          .eq("owner_id", ownerId)
          .eq("status", "accepted")
          .order("sequence", { ascending: true }),
      );
      return (result.data ?? []).map((scene) => ({
        id: scene.id,
        worldId: scene.world_id,
        draftId: scene.draft_id,
        title: scene.title,
        content: scene.content,
        order: scene.sequence,
        acceptedAt: scene.accepted_at,
        sourceTranscriptIds: [...(scene.source_transcript_ids ?? [])],
        relatedCanonIds: [...(scene.related_canon_ids ?? [])],
      }));
    },

    async listWorldCanon(worldId, { worldChecked = false } = {}) {
      if (!worldChecked) await assertWorldOwned(worldId);
      const result = await assertNoError(
        await supabase
          .from("canon_cards")
          .select("id,world_id,type,title,content,source_session_id,created_at")
          .eq("world_id", worldId)
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: true }),
      );
      return (result.data ?? []).map((card) => ({
        id: card.id, worldId: card.world_id, type: card.type, title: card.title, content: card.content,
        sourceSessionId: card.source_session_id, createdAt: card.created_at,
      }));
    },
    async listStoryDrafts(worldId, { worldChecked = false } = {}) {
      if (!worldChecked) await assertWorldOwned(worldId);
      const result = await assertNoError(
        await supabase
          .from("story_drafts")
          .select("id,world_id,session_id,title,body,status,source_transcript_ids,related_canon_ids,parent_draft_id,created_at")
          .eq("world_id", worldId)
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false }),
      );
      return (result.data ?? []).map(toStoryDraft);
    },

    async holdStoryDraft(worldId, draftId, { worldChecked = false } = {}) {
      if (!worldChecked) await assertWorldOwned(worldId);
      const result = await assertNoError(
        await supabase.from("story_drafts").update({ status: "held" }).eq("id", draftId).eq("world_id", worldId).eq("owner_id", ownerId).eq("status", "proposed").select("id,world_id,status"),
      );
      const held = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!held?.id) throw new ApiError(400, "DRAFT_NOT_HOLDABLE", "보류할 수 없는 초안입니다.");
      return { id: held.id, worldId: held.world_id, status: held.status };
    },
    async deleteWorld(worldId) {
      await assertNoError(await supabase.from("worlds").delete().eq("id", worldId).eq("owner_id", ownerId));
      return { ok: true, worldId };
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

  const worldMatch = req.url?.match(/^\/worlds\/([^/?#]+)$/);
  if (worldMatch && req.method === "DELETE") {
    try {
      sendJson(res, 200, await deleteWorldRecord(decodeURIComponent(worldMatch[1])));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "세계 삭제에 실패했습니다." });
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
