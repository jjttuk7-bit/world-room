import { deleteWorldRecord, handleOptions, sendJson } from "../../server.mjs";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== "DELETE") {
    sendJson(res, 405, { error: "허용되지 않는 메서드입니다." });
    return;
  }

  try {
    sendJson(res, 200, await deleteWorldRecord(req.query.id));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "세계 삭제에 실패했습니다." });
  }
}
