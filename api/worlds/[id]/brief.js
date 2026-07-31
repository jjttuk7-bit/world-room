import { ApiError, getCurrentCreativeBrief, handleOptions, readRequestJson, saveCreativeBrief, sendApiError, sendJson } from "../../../server.mjs";

function worldIdFor(req) {
  const value = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(value ?? req.url?.match(/^\/api\/worlds\/([^/?#]+)\/brief/)?.[1] ?? "").trim();
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const worldId = worldIdFor(req);
  try {
    if (req.method === "GET") { sendJson(res, 200, await getCurrentCreativeBrief(worldId)); return; }
    if (req.method === "POST") {
      const brief = await readRequestJson(req);
      if (brief.approved !== true) throw new ApiError(400, "BRIEF_NOT_APPROVED", "승인된 창작 브리프만 저장할 수 있습니다.");
      sendJson(res, 201, await saveCreativeBrief(worldId, brief));
      return;
    }
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "허용되지 않는 메서드입니다." } });
  } catch (error) { sendApiError(res, error, "창작 브리프를 처리하지 못했습니다."); }
}
