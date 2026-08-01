import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import handler from "./drafts.js";

function response() {
  const state = { status: null, headers: null, body: null };
  return {
    state,
    writeHead(status, headers) { state.status = status; state.headers = headers; },
    end(body) { state.body = body ? JSON.parse(body) : null; },
  };
}

describe("이야기 초안 API 계약", () => {
  it("PATCH를 CORS 허용 메서드에 포함한다", async () => {
    const res = response();
    await handler({ method: "OPTIONS" }, res);
    expect(res.state.status).toBe(204);
    expect(res.state.headers["Access-Control-Allow-Methods"]).toContain("PATCH");
  });

  it("잘못된 초안 요청은 400 구조화 오류로 반환한다", async () => {
    const req = Readable.from(["{}"]);
    req.method = "POST";
    const res = response();
    await handler(req, res);
    expect(res.state.status).toBe(400);
    expect(res.state.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "세계 ID가 필요합니다." } });
  });
});