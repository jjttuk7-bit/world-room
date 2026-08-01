import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.readyState = "closed";
  }

  send(message: string) {
    this.sent.push(message);
  }

  open() {
    this.readyState = "open";
    this.listeners.get("open")?.forEach((listener) => listener(new MessageEvent("open")));
  }
}

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  channel = new FakeDataChannel();

  addTrack() {}
  createDataChannel() {
    return this.channel as unknown as RTCDataChannel;
  }
  async createOffer() {
    return { type: "offer" as RTCSdpType, sdp: "offer-sdp" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {}
}

let peer: FakePeerConnection;

beforeEach(() => {
  peer = new FakePeerConnection();
  vi.stubGlobal("RTCPeerConnection", vi.fn(function FakeRTCPeerConnection() { return peer; }));
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [], getTracks: () => [] })),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes("/worlds/") && options?.method === "DELETE") {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (url.includes("/worlds/recent")) {
        return {
          ok: true,
          json: async () => ({
            worlds: [
              {
                id: "world-1",
                title: "안개 도시",
                summary: "밤마다 골목이 바뀌는 도시.",
                continuityBrief: "안개 도시와 사라진 지도 제작자를 이어간다.",
                updatedAt: "2026-05-27T18:33:21.000Z",
              },
            ],
          }),
        };
      }
      if (options === undefined || String(url).includes("localhost:8787/token")) {
        return { ok: true, json: async () => ({ value: "test-secret" }) };
      }
      return { ok: true, text: async () => "answer-sdp" };
    }),
  );
});

afterEach(() => {
  cleanup();
});

describe("World Room 앱", () => {
  it("한국어 Realtime 음성 세션 시작 화면을 보여준다", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "World Room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /세션 시작/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "세계 저장" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "설정: 아직 비어 있는 지도" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "떠다니는 항구 도시를 같이 만들어보자." })).not.toBeInTheDocument();
    expect(screen.getByText("아직 세계 단서가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "장면 열기" })).not.toBeInTheDocument();
    expect(screen.getByText("마이크 대기")).toBeInTheDocument();
    expect(screen.queryByText("/api/token")).not.toBeInTheDocument();
    expect(screen.queryByText("API 키는 브라우저가 아니라 로컬 서버에만 둡니다.")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "최근 세계" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /안개 도시 이어 말하기/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /안개 도시 삭제/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "새 세계 열기" })).toBeInTheDocument();
    expect(screen.getByLabelText("세계 이름")).toHaveValue("");
    expect(screen.getByLabelText("세계 씨앗")).toHaveValue("");
    expect(screen.getByRole("button", { name: /현재 세계 저장/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "몽환적" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "질문 위주" })).toHaveAttribute("aria-pressed", "true");
  });

  it("사용자가 세계 씨앗과 렌즈를 설정할 수 있다", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("세계 씨앗"), {
      target: { value: "비가 위로 내리는 항구 도시" },
    });
    fireEvent.click(screen.getByRole("button", { name: "어두운" }));
    fireEvent.click(screen.getByRole("button", { name: "미스터리" }));
    fireEvent.click(screen.getByRole("button", { name: "선택지 제안" }));

    expect(screen.getByLabelText("세계 씨앗")).toHaveValue("비가 위로 내리는 항구 도시");
    expect(screen.getByRole("button", { name: "어두운" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "미스터리" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "선택지 제안" })).toHaveAttribute("aria-pressed", "true");
  });

  it("창작 브리프를 Realtime 세션에 먼저 적용한 뒤 첫 응답을 요청한다", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("세계 이름"), { target: { value: "거꾸로 비가 내리는 항구" } });
    fireEvent.change(screen.getByLabelText("세계 씨앗"), { target: { value: "바다가 하늘로 흐른다" } });
    fireEvent.click(screen.getByRole("button", { name: "어두운" }));
    fireEvent.click(screen.getByRole("button", { name: "미스터리" }));
    fireEvent.click(screen.getByRole("button", { name: "선택지 제안" }));
    fireEvent.click(screen.getByRole("button", { name: /세션 시작/ }));

    await waitFor(() => expect(RTCPeerConnection).toHaveBeenCalled());
    peer.channel.open();

    await waitFor(() => expect(peer.channel.sent).toHaveLength(3));

    const events = peer.channel.sent.map((message) => JSON.parse(message));
    expect(events.map((event) => event.type)).toEqual(["session.update", "conversation.item.create", "response.create"]);
    expect(events[0].session.instructions).toContain("거꾸로 비가 내리는 항구");
    expect(events[0].session.instructions).toContain("바다가 하늘로 흐른다");
    expect(events[0].session.instructions).toContain("어두운");
    expect(events[0].session.instructions).toContain("미스터리");
    expect(events[0].session.instructions).toContain("선택지 제안");
    expect(events[0].session.instructions).toContain("사용자에게 확인");
  });
  it("저장 세계를 이어갈 때 이전 새 세계 렌즈를 세션 지침에 섞지 않는다", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "어두운" }));
    fireEvent.click(screen.getByRole("button", { name: "미스터리" }));
    fireEvent.click(screen.getByRole("button", { name: "선택지 제안" }));
    fireEvent.click(await screen.findByRole("button", { name: "안개 도시 이어 말하기" }));
    fireEvent.click(screen.getByRole("button", { name: /세션 시작/ }));

    await waitFor(() => expect(RTCPeerConnection).toHaveBeenCalled());
    peer.channel.open();
    await waitFor(() => expect(peer.channel.sent).toHaveLength(3));

    const instructions = JSON.parse(peer.channel.sent[0]).session.instructions;
    expect(instructions).toContain("안개 도시와 사라진 지도 제작자를 이어간다.");
    expect(instructions).toContain("분위기: 아직 정해지지 않음");
    expect(instructions).toContain("장르: 아직 정해지지 않음");
    expect(instructions).toContain("동반자 방식: 아직 정해지지 않음");
    expect(instructions).not.toContain("어두운");
    expect(instructions).not.toContain("미스터리");
    expect(instructions).not.toContain("선택지 제안");
  });
  it("저장된 세계를 삭제할 수 있다", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /안개 도시 삭제/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/worlds/world-1", { method: "DELETE" });
    });
  });
});
