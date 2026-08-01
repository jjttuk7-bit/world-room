import { acceptSavedStoryDraft, handleOptions, holdSavedStoryDraft, readRequestJson, reviseSavedStoryDraft, sendApiError, sendJson } from "../../../server.mjs";

function draftIdFor(req) {
  const value = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(value ?? req.url?.match(/^\/api\/story\/drafts\/([^/?#]+)/)?.[1] ?? "").trim();
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const draftId = draftIdFor(req);
  try {
    const payload = await readRequestJson(req);
    if (req.method === "PATCH" && payload.action === "hold") {
      sendJson(res, 200, await holdSavedStoryDraft(payload.worldId, draftId));
      return;
    }
    if (req.method === "PATCH") {
      sendJson(res, 200, await reviseSavedStoryDraft(payload.worldId, draftId, payload));
      return;
    }
    if (req.method === "POST" && payload.action === "accept") {
      sendJson(res, 200, await acceptSavedStoryDraft(payload.worldId, draftId));
      return;
    }
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "허용되지 않는 메서드입니다." } });
  } catch (error) {
    sendApiError(res, error, "장면 초안을 처리하지 못했습니다.");
  }
}