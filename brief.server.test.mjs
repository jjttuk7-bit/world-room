import { describe, expect, it, vi } from "vitest";
import {
  buildApprovedBriefOpeningContext,
  generateCreativeBrief,
  validateCreativeBriefRequest,
} from "./server.mjs";

const request = {
  intent: "기억을 잃은 잠수사의 첫 귀환 장면을 만들고 싶다.",
  conflict: "수면으로 가면 도시가 무너진다.",
  tone: "고요하고 불길한 해양 SF",
  requiredElements: ["역류하는 비", "금지된 지도"],
  sessionGoal: "첫 장면의 선택을 확정한다.",
};

describe("창작 브리프 서버", () => {
  it("창작 의도 없이 브리프 생성을 요청하면 검증 오류를 반환한다", () => {
    expect(() => validateCreativeBriefRequest({ ...request, intent: " " })).toThrow("창작 의도");
  });

  it("구조화된 브리프 제안을 만들고 승인 전에는 시작 맥락을 숨긴다", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify(request),
      }),
    }));

    const brief = await generateCreativeBrief(request, { apiKey: "test-key", fetchImpl });

    expect(brief).toEqual({ ...request, approved: false });
    expect(buildApprovedBriefOpeningContext(brief)).toBe("");
    expect(buildApprovedBriefOpeningContext({ ...brief, approved: true })).toContain("역류하는 비");
  });

  it("승인된 브리프를 Realtime 세션의 최우선 instructions로 보낸다", async () => {
    vi.resetModules();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ value: "client-secret" }) }));
    vi.stubGlobal("fetch", fetchImpl);
    const { createClientSecret } = await import("./server.mjs");

    await createClientSecret({ ...request, approved: true });

    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(requestBody.session.instructions).toContain("승인된 창작 브리프를 최우선으로 따른다");
    expect(requestBody.session.instructions).toContain("기억을 잃은 잠수사의 첫 귀환 장면을 만들고 싶다.");
    expect(requestBody.session.instructions).toContain("수면으로 가면 도시가 무너진다.");
    expect(requestBody.session.instructions).toContain("고요하고 불길한 해양 SF");
    expect(requestBody.session.instructions).toContain("역류하는 비");
    expect(requestBody.session.instructions).toContain("첫 장면의 선택을 확정한다.");
    expect(requestBody.session.instructions).toContain("충돌하면 사용자 확인을 요청한다");
  });
});
