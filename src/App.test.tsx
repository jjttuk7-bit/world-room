import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes("/worlds/") && options?.method === "DELETE") {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (url.includes("/worlds/recent")) {
        return { ok: true, json: async () => ({ worlds: [{ id: "world-1", title: "안개 도시", summary: "밤마다 골목이 바뀌는 도시.", continuityBrief: "안개 도시와 사라진 지도 제작자를 이어간다.", updatedAt: "2026-05-27T18:33:21.000Z" }] }) };
      }
      if (String(url).includes("/story/drafts")) {
        return { ok: true, json: async () => ({ worldId: "world-1", drafts: [] }) };
      }
      if (String(url).includes("/story")) {
        return {
          ok: true,
          json: async () => ({
            worldId: "world-1",
            scenes: [{ id: "scene-1", worldId: "world-1", draftId: "draft-1", title: "안개 속의 나룻배", content: "유나는 물길이 사라진 운하에 작은 배를 띄웠다.", order: 1, acceptedAt: "2026-08-01T10:00:00.000Z", sourceTranscriptIds: ["turn-1"], relatedCanonIds: ["canon-1"] }],
            canon: [{ id: "canon-1", worldId: "world-1", type: "character", title: "유나", content: "유나는 사라진 지도를 찾는 나룻배 사공이다.", sourceSessionId: "session-1", createdAt: "2026-08-01T09:00:00.000Z" }, { id: "canon-2", worldId: "world-1", type: "conflict", title: "사라진 물길", content: "새벽마다 운하 하나가 지도에서 사라진다.", sourceSessionId: "session-1", createdAt: "2026-08-01T09:00:00.000Z" }],
          }),
        };
      }
      if (String(url).includes("/brief")) {
        return {
          ok: true,
          json: async () => ({
            worldId: "world-1",
            brief: {
              id: "brief-1",
              worldId: "world-1",
              intent: "사라진 지도를 찾는 사공의 첫 항해",
              conflict: "도시는 지도를 금지한다.",
              tone: "고요하고 불길하게",
              requiredElements: ["역류하는 비"],
              sessionGoal: "첫 선택을 찾는다.",
              approved: true,
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
});

afterEach(() => cleanup());

describe("World Room 앱", () => {
  it("대시보드 대신 작가용 세 가지 작업 모드를 보여준다", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "World Room" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "작업 모드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "대화" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "원고" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "세계 성경" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "어떤 이야기를 만들고 싶으세요?" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "만들고 싶은 이야기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "브리프를 먼저 정리하세요" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "세계 저장" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "최근 세계" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("세계 이름")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("세계 씨앗")).not.toBeInTheDocument();
  });

  it("새 세계 설정은 필요할 때 열리는 대화상자에만 둔다", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "새 세계" }));
    expect(screen.getByRole("dialog", { name: "새 세계 열기" })).toBeInTheDocument();
    expect(screen.getByLabelText("세계 이름")).toHaveValue("");
    expect(screen.getByLabelText("세계 씨앗")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("세계 씨앗"), { target: { value: "비가 위로 내리는 항구 도시" } });
    fireEvent.click(screen.getByRole("button", { name: "어두운" }));
    fireEvent.click(screen.getByRole("button", { name: "미스터리" }));
    fireEvent.click(screen.getByRole("button", { name: "선택지 제안" }));
    expect(screen.getByLabelText("세계 씨앗")).toHaveValue("비가 위로 내리는 항구 도시");
    expect(screen.getByRole("button", { name: "어두운" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "미스터리" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "선택지 제안" })).toHaveAttribute("aria-pressed", "true");
  });

  it("이어 보던 세계에서 새 세계를 열면 이전 세계 연결과 세션 기록을 비운다", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ }));
    expect(screen.getByText("안개 도시", { selector: ".world-name" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "새 세계" }));
    expect(screen.getByLabelText("세계 이름")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("세계 이름"), { target: { value: "유리 바다" } });
    fireEvent.change(screen.getByLabelText("세계 씨앗"), { target: { value: "파도 아래 도서관" } });
    fireEvent.click(screen.getByRole("button", { name: "이 세계 열기" }));

    expect(screen.queryByRole("dialog", { name: "새 세계 열기" })).not.toBeInTheDocument();
    expect(screen.getByText("유리 바다", { selector: ".world-name" })).toBeInTheDocument();
    expect(screen.queryByText("안개 도시", { selector: ".world-name" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "세계 저장" })).toBeDisabled();
  });

  it("새 세계를 열면 이전 세계의 저장된 원고와 세계 성경을 비운다", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/worlds/world-1/story"));

    fireEvent.click(screen.getByRole("button", { name: "새 세계" }));
    fireEvent.change(screen.getByLabelText("세계 이름"), { target: { value: "새 항구" } });
    fireEvent.click(screen.getByRole("button", { name: "이 세계 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "원고" }));

    expect(screen.getByRole("heading", { name: "아직 채택된 장면이 없습니다" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "안개 속의 나룻배" })).not.toBeInTheDocument();
  });
  it("새 세계 입력을 취소해도 현재 세계의 메타데이터를 바꾸지 않는다", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ }));
    fireEvent.click(screen.getByRole("button", { name: "새 세계" }));
    fireEvent.change(screen.getByLabelText("세계 이름"), { target: { value: "취소할 세계" } });
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.getByText("안개 도시", { selector: ".world-name" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "새 세계" }));
    expect(screen.getByLabelText("세계 이름")).toHaveValue("");
  });

  it("새 세계 대화상자를 네이티브 모달로 연다", async () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "새 세계" }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
  });
  it("새 세계 대화상자는 취소한 뒤 다시 열 수 있다", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "새 세계" }));
    const dialog = screen.getByRole("dialog", { name: "새 세계 열기" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "새 세계 열기" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "새 세계" }));
    expect(screen.getByRole("dialog", { name: "새 세계 열기" })).toBeInTheDocument();
  });
  it("원고와 세계 성경 모드에서 각각의 작업 맥락을 연다", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    expect(screen.getByRole("heading", { name: "원고" })).toBeInTheDocument();
    expect(screen.getByText("채택한 장면이 이곳에서 한 편의 이야기로 이어집니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "세계 성경" }));
    expect(screen.getByRole("heading", { name: "세계 성경" })).toBeInTheDocument();
    expect(screen.getByText("인물, 장소, 규칙과 사건을 대화의 근거와 함께 보관합니다.")).toBeInTheDocument();
  });

  it("보관함에서만 저장한 세계 목록을 연다", async () => {
    render(<App />);
    expect(screen.queryByRole("heading", { name: "최근 세계" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    expect(await screen.findByRole("heading", { name: "최근 세계" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ })).toBeInTheDocument();
  });

  it("대화 근거가 없으면 장면 초안 만들기를 안내한다", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ }));
    expect(screen.getByRole("button", { name: "장면 초안 만들기" })).toBeDisabled();
    expect(screen.getByText("장면 초안은 대화가 충분히 쌓인 뒤 만들 수 있습니다.")).toBeInTheDocument();
  });

  it("새 대화를 저장하면 저장된 세계를 바로 선택해 장면 초안을 만들 수 있다", async () => {
    let channel: EventTarget & { readyState: string; send: ReturnType<typeof vi.fn> } | undefined;
    class FakePeerConnection {
      connectionState = "new";
      ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      addTrack = vi.fn();
      createDataChannel() {
        channel = Object.assign(new EventTarget(), { readyState: "open", send: vi.fn() });
        return channel as unknown as RTCDataChannel;
      }
      async createOffer() { return { type: "offer" as const, sdp: "offer" }; }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      close() {}
    }
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [{ enabled: true }], getTracks: () => [] })) },
    });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url === "/api/creative-brief") return { ok: true, json: async () => ({ intent: "안개 속 항구의 사공", conflict: "사라진 지도", tone: "몽환적", requiredElements: [], sessionGoal: "첫 장면" , approved: false }) } as Response;
      if (url === "/api/token") return { ok: true, json: async () => ({ value: "ephemeral-key" }) } as Response;
      if (url === "https://api.openai.com/v1/realtime/calls") return { ok: true, text: async () => "answer" } as Response;
      if (url === "/api/sessions" && options?.method === "POST") return { ok: true, json: async () => ({ ok: true, path: "supabase/worlds/world-saved", worldId: "world-saved", sessionId: "session-saved" }) } as Response;
      if (url.includes("/worlds/recent")) return { ok: true, json: async () => ({ worlds: [] }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "만들고 싶은 이야기" }), { target: { value: "안개 속 항구의 사공 이야기" } });
    fireEvent.click(screen.getByRole("button", { name: "방향 정리하기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "이 브리프로 대화 시작" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "이 브리프로 대화 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "대화 시작" }));
    await waitFor(() => expect(channel).toBeDefined());
    channel?.dispatchEvent(new Event("open"));
    channel?.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "안개 속 항구의 사공은 사라진 지도를 찾아야 합니다." }) }));
    channel?.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "response.audio_transcript.done", transcript: "설정: 항구의 물길은 매일 밤 다른 기억을 품습니다." }) }));
    await waitFor(() => expect(screen.getByRole("button", { name: "세계 저장" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "세계 저장" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "장면 초안 만들기" })).toBeEnabled());
    expect(screen.queryByText("저장한 세계를 이어가면 장면 초안을 기록할 수 있습니다.")).not.toBeInTheDocument();
  });
  it("저장된 원고를 순서대로 보여주고 세계 성경을 유형별 근거와 함께 묶는다", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/worlds/world-1/story"));

    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    expect(await screen.findByRole("heading", { name: "안개 속의 나룻배" })).toBeInTheDocument();
    expect(screen.getByText("대화 근거 1개 · 세계 성경 1개")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "세계 성경" }));
    expect(screen.getByRole("heading", { name: "인물" })).toBeInTheDocument();
    expect(screen.getByText("유나는 사라진 지도를 찾는 나룻배 사공이다.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "미해결 갈등" })).toBeInTheDocument();
    expect(screen.getByText("새벽마다 운하 하나가 지도에서 사라진다.")).toBeInTheDocument();
    expect(screen.getAllByText(/세션 근거/)).toHaveLength(2);
  });
  it("저장된 세계를 삭제할 수 있다", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 삭제/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/worlds/world-1", { method: "DELETE" }));
  });
  it("저장된 세계의 브리프를 불러와 명시적으로 이어 말하기를 선택한 뒤에만 대화를 시작한다", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/worlds/world-1/brief"));
    expect(screen.getByRole("button", { name: "지난 브리프로 이어가기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "브리프를 먼저 정리하세요" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "지난 브리프로 이어가기" }));

    expect(screen.getByRole("button", { name: "대화 시작" })).toBeEnabled();
  });

  it("저장된 세계에서 새 브리프를 승인하면 활성 브리프를 저장한다", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes("/worlds/recent")) return { ok: true, json: async () => ({ worlds: [{ id: "world-1", title: "안개 도시", summary: "밤마다 골목이 바뀌는 도시.", continuityBrief: "", updatedAt: "2026-05-27T18:33:21.000Z" }] }) } as Response;
      if (url === "/api/worlds/world-1/brief" && !options?.method) return { ok: true, json: async () => ({ worldId: "world-1", brief: null }) } as Response;
      if (url === "/api/creative-brief") return { ok: true, json: async () => ({ intent: "사라진 지도 제작자의 귀환", conflict: "도시는 지도를 금지한다.", tone: "고요하고 불길하게", requiredElements: ["역류하는 비"], sessionGoal: "첫 장면을 연다.", approved: false }) } as Response;
      if (url === "/api/worlds/world-1/brief" && options?.method === "POST") return { ok: true, json: async () => ({ id: "brief-2", worldId: "world-1", approved: true }) } as Response;
      if (url.includes("/story/drafts")) return { ok: true, json: async () => ({ worldId: "world-1", drafts: [] }) } as Response;
      if (url.includes("/story")) return { ok: true, json: async () => ({ worldId: "world-1", scenes: [], canon: [] }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/worlds/world-1/brief"));
    fireEvent.change(screen.getByRole("textbox", { name: "만들고 싶은 이야기" }), { target: { value: "지도 제작자의 귀환" } });
    fireEvent.click(screen.getByRole("button", { name: "방향 정리하기" }));
    await screen.findByRole("button", { name: "이 브리프로 대화 시작" });
    fireEvent.click(screen.getByRole("button", { name: "이 브리프로 대화 시작" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/worlds/world-1/brief", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"approved":true'),
    })));
  });
});
