import { handleOptions, sendJson } from "../server.mjs";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  sendJson(res, 200, { ok: true });
}
