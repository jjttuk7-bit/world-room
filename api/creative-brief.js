import { generateCreativeBrief, handleOptions, readRequestJson, sendApiError, sendJson } from "../server.mjs";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "허용되지 않는 메서드입니다." } });
    return;
  }
  try {
    sendJson(res, 200, await generateCreativeBrief(await readRequestJson(req)));
  } catch (error) {
    sendApiError(res, error, "창작 브리프를 제안하지 못했습니다.");
  }
}