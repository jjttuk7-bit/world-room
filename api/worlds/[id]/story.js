import { createGeneratedStoryDraft, getWorldStory, handleOptions, readRequestJson, sendApiError, sendJson } from "../../../server.mjs";

function worldIdFor(req) {
  const value = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(value ?? req.url?.match(/^\/api\/worlds\/([^/?#]+)\/story/)?.[1] ?? "").trim();
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const worldId = worldIdFor(req);
  try {
    if (req.method === "GET") {
      sendJson(res, 200, await getWorldStory(worldId));
      return;
    }
    if (req.method === "POST") {
      const payload = await readRequestJson(req);
      if (payload.worldId && String(payload.worldId) !== worldId) throw new Error("요청 세계 ID가 경로와 일치하지 않습니다.");
      sendJson(res, 201, await createGeneratedStoryDraft({ ...payload, worldId }));
      return;
    }
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "허용되지 않는 메서드입니다." } });
  } catch (error) {
    sendApiError(res, error, "이야기 작업을 처리하지 못했습니다.");
  }
}