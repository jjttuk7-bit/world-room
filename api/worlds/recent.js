import { handleOptions, listRecentWorlds, sendJson } from "../../server.mjs";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "허용되지 않는 메서드입니다." });
    return;
  }

  try {
    sendJson(res, 200, { worlds: await listRecentWorlds(3) });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "최근 세계를 불러오지 못했습니다." });
  }
}
