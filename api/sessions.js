import { handleOptions, readRequestJson, saveSessionRecord, sendJson } from "../server.mjs";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "허용되지 않는 메서드입니다." });
    return;
  }

  try {
    const payload = await readRequestJson(req);
    sendJson(res, 200, await saveSessionRecord(payload));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "세션 저장에 실패했습니다." });
  }
}
