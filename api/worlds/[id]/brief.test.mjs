import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  getCurrentCreativeBrief: vi.fn(),
  saveCreativeBrief: vi.fn(),
  handleOptions: vi.fn(() => false),
  readRequestJson: vi.fn(),
  sendApiError: vi.fn(),
  sendJson: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  },
}));

vi.mock("../../../server.mjs", () => server);
import handler from "./brief.js";
function response() { return { writeHead: vi.fn(), end: vi.fn() }; }

describe("현재 창작 브리프 API 계약", () => {
  beforeEach(() => vi.clearAllMocks());
  it("GET은 소유가 확인된 세계의 현재 브리프를 반환한다", async () => {
    const brief = { id: "brief-1", worldId: "world-1", intent: "잃어버린 지도를 찾는다.", approved: true };
    server.getCurrentCreativeBrief.mockResolvedValue({ worldId: "world-1", brief });
    const res = response();
    await handler({ method: "GET", query: { id: "world-1" } }, res);
    expect(server.getCurrentCreativeBrief).toHaveBeenCalledWith("world-1");
    expect(server.sendJson).toHaveBeenCalledWith(res, 200, { worldId: "world-1", brief });
  });
  it("GET은 배열 경로 파라미터의 첫 세계 ID만 사용한다", async () => {
    server.getCurrentCreativeBrief.mockResolvedValue({ worldId: "world-1", brief: null });
    const res = response();

    await handler({ method: "GET", query: { id: ["world-1", "ignored"] } }, res);

    expect(server.getCurrentCreativeBrief).toHaveBeenCalledWith("world-1");
  });
  it("GET은 로컬 URL에서 세계 ID를 찾아 사용한다", async () => {
    server.getCurrentCreativeBrief.mockResolvedValue({ worldId: "world-local", brief: null });
    const res = response();

    await handler({ method: "GET", url: "/api/worlds/world-local/brief?preview=1" }, res);

    expect(server.getCurrentCreativeBrief).toHaveBeenCalledWith("world-local");
  });
  it("POST는 approved가 boolean true인 브리프만 저장한다", async () => {
    const payload = { approved: true, intent: "잃어버린 지도를 찾는다.", conflict: "도시는 지도를 금지한다.", tone: "고요하고 불길하게", requiredElements: ["역류하는 비"], sessionGoal: "첫 선택을 찾는다." };
    server.readRequestJson.mockResolvedValue(payload);
    server.saveCreativeBrief.mockResolvedValue({ id: "brief-1", worldId: "world-1", approved: true });
    const req = Readable.from([JSON.stringify(payload)]); req.method = "POST"; req.query = { id: "world-1" };
    const res = response();
    await handler(req, res);
    expect(server.saveCreativeBrief).toHaveBeenCalledWith("world-1", payload);
    expect(server.sendJson).toHaveBeenCalledWith(res, 201, expect.objectContaining({ id: "brief-1" }));
  });
  it("POST는 승인되지 않은 브리프를 구조화 오류로 거부한다", async () => {
    server.readRequestJson.mockResolvedValue({ approved: "true" });
    const res = response();
    await handler({ method: "POST", query: { id: "world-1" } }, res);
    expect(server.saveCreativeBrief).not.toHaveBeenCalled();
    expect(server.sendApiError).toHaveBeenCalledWith(res, expect.objectContaining({ code: "BRIEF_NOT_APPROVED" }), "창작 브리프를 처리하지 못했습니다.");
  });
});
