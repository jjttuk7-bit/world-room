import { createGeneratedStoryDraft, handleOptions, readRequestJson, sendJson } from "../../server.mjs";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "허용되지 않는 메서드입니다." });
    return;
  }
  try {
    sendJson(res, 201, await createGeneratedStoryDraft(await readRequestJson(req)));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "장면 초안을 만들지 못했습니다." });
  }
}