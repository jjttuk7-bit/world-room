import { createClientSecret, errorPayload, handleOptions, readRequestJson, sendJson } from "../server.mjs";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { error: "허용되지 않는 메서드입니다." });
    return;
  }

  try {
    const brief = req.method === "POST" ? await readRequestJson(req) : undefined;
    sendJson(res, 200, await createClientSecret(brief));
  } catch (error) {
    const payload = errorPayload(error);
    sendJson(res, payload.status, payload.body);
  }
}