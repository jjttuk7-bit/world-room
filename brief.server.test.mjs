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
});
