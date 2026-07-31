import { acceptSavedStoryDraft, handleOptions, readRequestJson, reviseSavedStoryDraft, sendJson } from "../../../server.mjs";

function draftIdFor(req) {
  const value = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(value ?? req.url?.match(/^\/api\/story\/drafts\/([^/?#]+)/)?.[1] ?? "").trim();
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const draftId = draftIdFor(req);
  try {
    const payload = await readRequestJson(req);
    if (req.method === "PATCH") {
      sendJson(res, 200, await reviseSavedStoryDraft(payload.worldId, draftId, payload));
      return;
    }
    if (req.method === "POST" && payload.action === "accept") {
      sendJson(res, 200, await acceptSavedStoryDraft(payload.worldId, draftId));
      return;
    }
    sendJson(res, 405, { error: "허용되지 않는 메서드입니다." });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "장면 초안을 처리하지 못했습니다." });
  }
}