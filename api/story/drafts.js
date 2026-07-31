import { createGeneratedStoryDraft, handleOptions, listWorldDrafts, readRequestJson, sendApiError, sendJson } from "../../server.mjs";

function queryValue(req, key) {
  const value = Array.isArray(req.query?.[key]) ? req.query[key][0] : req.query?.[key];
  if (value !== undefined) return String(value).trim();
  try { return new URL(req.url ?? "", "http://localhost").searchParams.get(key)?.trim() ?? ""; } catch { return ""; }
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  try {
    if (req.method === "GET") {
      const worldId = queryValue(req, "worldId");
      sendJson(res, 200, await listWorldDrafts(worldId));
      return;
    }
    if (req.method === "POST") {
      sendJson(res, 201, await createGeneratedStoryDraft(await readRequestJson(req)));
      return;
    }
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "허용되지 않는 메서드입니다." } });
  } catch (error) {
    sendApiError(res, error, "장면 초안을 처리하지 못했습니다.");
  }
}