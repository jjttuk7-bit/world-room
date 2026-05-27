import { useEffect, useMemo, useRef, useState } from "react";
import { appendTranscriptLine, reduceRealtimeEvent } from "./realtime/events";
import type { RealtimeSignal, TranscriptLine } from "./realtime/events";

type SessionState = "idle" | "requesting" | "connecting" | "ready" | "listening" | "speaking" | "recovering" | "ended" | "error";

const tokenUrl = import.meta.env.VITE_REALTIME_TOKEN_URL ?? "/api/token";
const sessionSaveUrl = import.meta.env.VITE_SESSION_SAVE_URL ?? "/api/sessions";
const recentWorldsUrl = import.meta.env.VITE_RECENT_WORLDS_URL ?? "/api/worlds/recent";
const worldsUrl = import.meta.env.VITE_WORLDS_URL ?? "/api/worlds";

type RecentWorld = {
  id: string;
  title: string;
  summary: string;
  continuityBrief: string;
  updatedAt?: string;
};

const openingPrompts = [
  "떠다니는 항구 도시를 같이 만들어보자.",
  "눈이 내리는 사막 왕국에서 첫 장면을 열어줘.",
  "주인공에게 이상한 결핍 하나를 줘.",
  "평화로운 마을에 오늘 터질 갈등을 만들어줘.",
];

const moodOptions = ["몽환적", "어두운", "따뜻한", "기묘한", "모험적"];
const genreOptions = ["판타지", "SF", "미스터리", "호러", "동화", "동양풍"];
const companionModes = ["질문 위주", "선택지 제안", "장면 묘사", "인물 중심"];

const validationItems = [
  "브라우저가 마이크 권한을 요청하고, 거부 시 오류 문구가 보이는가",
  "세션 시작 후 상태가 연결 중에서 대화 준비로 바뀌는가",
  "내 목소리와 모델 음성이 오디오로 오가며 끊김이 과하지 않은가",
  "네트워크를 끊었다가 다시 연결했을 때 세션 재시작 안내가 보이는가",
  "설정, 인물, 갈등, 장면 훅이 transcript 또는 단서 패널에 남는가",
];

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [statusText, setStatusText] = useState("마이크 대기");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([
    {
      id: "welcome",
      speaker: "시스템",
      text: "세션을 시작하면 World Room 동반자가 한국어 음성으로 세계, 인물, 갈등, 장면 훅을 함께 만들어줍니다.",
      final: true,
    },
  ]);
  const [sparks, setSparks] = useState<string[]>([
    "설정: 아직 비어 있는 지도",
    "인물: 이름을 기다리는 주인공",
    "갈등: 첫 질문이 세계의 방향을 정합니다",
  ]);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [muted, setMuted] = useState(false);
  const [recentWorlds, setRecentWorlds] = useState<RecentWorld[]>([]);
  const [selectedWorld, setSelectedWorld] = useState<RecentWorld | null>(null);
  const [worldTitle, setWorldTitle] = useState("");
  const [worldSeed, setWorldSeed] = useState("");
  const [mood, setMood] = useState(moodOptions[0]);
  const [genre, setGenre] = useState(genreOptions[0]);
  const [companionMode, setCompanionMode] = useState(companionModes[0]);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stateLabel = useMemo(() => {
    const labels: Record<SessionState, string> = {
      idle: "대기",
      requesting: "권한 요청",
      connecting: "연결 중",
      ready: "대화 준비",
      listening: "듣는 중",
      speaking: "말하는 중",
      recovering: "정리 중",
      ended: "종료됨",
      error: "오류",
    };
    return labels[sessionState];
  }, [sessionState]);

  const canSaveWorld = transcript.some((line) => line.speaker === "사용자" || line.speaker === "동반자");
  const isRealtimeReady = sessionState === "ready" || sessionState === "listening" || sessionState === "speaking";

  useEffect(() => {
    void loadRecentWorlds();
  }, []);

  async function loadRecentWorlds() {
    try {
      const response = await fetch(recentWorldsUrl);
      if (!response.ok) return;
      const result = await response.json();
      setRecentWorlds((result.worlds ?? []).slice(0, 3));
    } catch {
      setRecentWorlds([]);
    }
  }

  async function startSession() {
    if (sessionState === "requesting" || sessionState === "connecting") return;

    stopSession(false);
    setError("");
    setSessionState("requesting");
    setStatusText("마이크 권한을 확인하는 중");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      setSessionState("connecting");
      setStatusText("Realtime 세션을 여는 중");

      const tokenResponse = await fetch(tokenUrl);
      if (!tokenResponse.ok) {
        throw new Error(await tokenResponse.text());
      }
      const tokenData = await tokenResponse.json();
      const ephemeralKey = tokenData.value ?? tokenData.client_secret?.value;
      if (!ephemeralKey) {
        throw new Error("서버가 Realtime client secret을 반환하지 않았습니다.");
      }

      const peer = new RTCPeerConnection();
      peerRef.current = peer;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;
      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0];
      };

      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.addEventListener("open", () => {
        setSessionState("ready");
        setStatusText("대화 준비 완료");
        sendOpeningGreeting();
      });
      channel.addEventListener("message", (event) => handleRealtimeMessage(event.data));
      channel.addEventListener("close", () => {
        setSessionState((current) => (current === "ended" ? current : "recovering"));
        setStatusText("데이터 채널이 닫혔습니다. 세션을 다시 시작할 수 있습니다.");
      });
      channel.addEventListener("error", () => {
        setError("데이터 채널 오류가 발생했습니다. 세션을 다시 시작해 주세요.");
        setSessionState("error");
      });

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          setSessionState("recovering");
          setStatusText("연결이 흔들립니다. 계속 실패하면 세션을 다시 시작하세요.");
        }
        if (peer.connectionState === "connected") {
          setSessionState("ready");
          setStatusText("낮은 지연으로 연결됨");
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(await sdpResponse.text());
      }

      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "세션 시작 중 알 수 없는 오류가 발생했습니다.";
      setError(message);
      setStatusText("연결 실패");
      setSessionState("error");
      stopSession(false);
    }
  }

  function stopSession(markEnded = true) {
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    if (markEnded) {
      setSessionState("ended");
      setStatusText("세션 종료");
    }
  }

  function toggleMute() {
    const nextMuted = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
    setStatusText(nextMuted ? "마이크 음소거" : "마이크 활성화");
  }

  function sendOpeningGreeting() {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return;

    channel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: selectedWorld
                ? `이전 세계를 이어갑니다. 제목: ${selectedWorld.title}\n기억 요약: ${selectedWorld.continuityBrief}\n한국어로 짧게 반갑게 맞이하고, 지난 세계의 다음 장면으로 들어가는 질문 하나를 던져줘.`
                : buildSeedPrompt(worldSeed, mood, genre, companionMode),
            },
          ],
        },
      }),
    );
    channel.send(JSON.stringify({ type: "response.create" }));
  }

  function sendTextPrompt(prompt: string) {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return;
    channel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      }),
    );
    channel.send(JSON.stringify({ type: "response.create" }));
  }

  async function saveWorldSession() {
    if (!canSaveWorld || isSaving) return;

    setIsSaving(true);
    setError("");
    setSaveStatus("세계 저장 중");

    try {
      const firstUserLine = transcript.find((line) => line.speaker === "사용자" && line.text.trim());
      const setupSparks = [
        worldSeed.trim() ? `설정: ${worldSeed.trim()}` : "",
        `분위기: ${mood}`,
        `장르: ${genre}`,
        `동반자 방식: ${companionMode}`,
      ].filter(Boolean);
      const response = await fetch(sessionSaveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: worldTitle.trim() || firstUserLine?.text || selectedWorld?.title || "World Room 세션",
          worldId: selectedWorld?.id,
          transcript,
          sparks: [...setupSparks, ...sparks],
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "세션 저장에 실패했습니다.");
      }
      setSaveStatus(`저장 완료: ${result.path}`);
      await loadRecentWorlds();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "세션 저장에 실패했습니다.";
      setError(message);
      setSaveStatus("");
    } finally {
      setIsSaving(false);
    }
  }

  function continueWorld(world: RecentWorld) {
    setSelectedWorld(world);
    setStatusText(`${world.title} 이어 말하기 준비`);
  }

  async function deleteWorld(world: RecentWorld) {
    setError("");
    setSaveStatus(`${world.title} 삭제 중`);

    try {
      const response = await fetch(`${worldsUrl}/${encodeURIComponent(world.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "세계 삭제에 실패했습니다.");
      }
      setRecentWorlds((current) => current.filter((item) => item.id !== world.id));
      if (selectedWorld?.id === world.id) {
        setSelectedWorld(null);
      }
      setSaveStatus(`삭제 완료: ${world.title}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "세계 삭제에 실패했습니다.";
      setError(message);
      setSaveStatus("");
    }
  }

  function buildSeedPrompt(seed: string, selectedMood: string, selectedGenre: string, mode: string) {
    return `새 세계를 엽니다.
세계 이름: ${worldTitle.trim() || "아직 정해지지 않음"}
세계 씨앗: ${seed.trim() || "아직 정해지지 않음"}
분위기: ${selectedMood}
장르: ${selectedGenre}
동반자 방식: ${mode}
한국어로 아주 짧게 시작하세요. 사용자가 먼저 상상할 수 있게 긴 설명은 피하고, 이 설정을 바탕으로 첫 장면을 여는 질문 하나만 던져주세요.`;
  }

  function handleRealtimeMessage(raw: string) {
    const event = JSON.parse(raw);
    const signals = reduceRealtimeEvent(event);
    signals.forEach(applySignal);
  }

  function applySignal(signal: RealtimeSignal) {
    if (signal.kind === "status") {
      setSessionState(signal.status);
      setStatusText(signal.message);
      return;
    }

    if (signal.kind === "error") {
      setError(signal.message);
      setSessionState("error");
      setStatusText("오류 발생");
      return;
    }

    if (signal.kind === "spark") {
      setSparks((current) => [signal.text, ...current.filter((item) => item !== signal.text)].slice(0, 8));
      return;
    }

    setTranscript((current) => appendTranscriptLine(current, signal));
  }

  return (
    <main className="world-room">
      <section className="hero-panel">
        <div className="brand-block">
          <p className="eyebrow">Realtime voice worldbuilding</p>
          <h1>World Room</h1>
          <p>
            말로 세계를 열고, 동반자가 바로 받아서 설정, 인물, 갈등, 장면 훅을 함께 빚어주는 한국어
            실시간 오디오 작업실입니다.
          </p>
        </div>

        <div className={`orbital-state ${sessionState}`} aria-label={`현재 상태: ${stateLabel}`}>
          <span />
          <strong>{stateLabel}</strong>
          <small>{statusText}</small>
        </div>
      </section>

      <section className="control-strip" aria-label="세션 조작">
        <button className="primary-button" onClick={startSession} disabled={sessionState === "requesting" || sessionState === "connecting"}>
          {sessionState === "idle" || sessionState === "ended" || sessionState === "error" ? "세션 시작" : "세션 재시작"}
        </button>
        <button className="icon-button" onClick={toggleMute} disabled={!streamRef.current}>
          {muted ? "마이크 켜기" : "마이크 끄기"}
        </button>
        <button className="ghost-button" onClick={() => stopSession()} disabled={!peerRef.current}>
          세션 종료
        </button>
        <button className="icon-button" onClick={saveWorldSession} disabled={!canSaveWorld || isSaving}>
          {isSaving ? "저장 중" : "세계 저장"}
        </button>
        {(error || saveStatus) && (
          <div className="connection-note" role="status">
            <strong>{error || saveStatus}</strong>
          </div>
        )}
      </section>

      <section className="recent-worlds" aria-label="최근 저장한 세계">
        <div className="panel-heading">
          <p className="eyebrow">Saved worlds</p>
          <h2>최근 세계</h2>
        </div>
        <div className="world-card-grid">
          {recentWorlds.length ? (
            recentWorlds.map((world) => (
              <article className={selectedWorld?.id === world.id ? "world-card selected" : "world-card"} key={world.id}>
                <span>{world.updatedAt ? new Date(world.updatedAt).toLocaleString("ko-KR") : "최근 저장"}</span>
                <h3>{world.title}</h3>
                <p>{world.summary}</p>
                <div className="world-card-actions">
                  <button onClick={() => continueWorld(world)}>{world.title} 이어 말하기</button>
                  <button className="danger-button" onClick={() => void deleteWorld(world)}>
                    {world.title} 삭제
                  </button>
                </div>
              </article>
            ))
          ) : (
            <article className="world-card empty">
              <span>아직 저장된 세계가 없습니다</span>
              <h3>첫 세계를 말로 열어보세요</h3>
              <p>대화가 생긴 뒤 세계 저장을 누르면 최근 세계 카드가 여기에 나타납니다.</p>
            </article>
          )}
        </div>
      </section>

      <section className="seed-panel" aria-label="새 세계 설정">
        <div className="panel-heading">
          <p className="eyebrow">World seed</p>
          <h2>새 세계 열기</h2>
        </div>
        <label className="seed-input">
          세계 이름
          <input
            value={worldTitle}
            onChange={(event) => setWorldTitle(event.target.value)}
            placeholder="예: 거꾸로 비가 내리는 항구"
          />
        </label>
        <label className="seed-input">
          세계 씨앗
          <textarea
            value={worldSeed}
            onChange={(event) => setWorldSeed(event.target.value)}
            placeholder="예: 비가 위로 내리는 항구 도시, 이름이 금지된 왕국"
            rows={3}
          />
        </label>
        <ChoiceButtons label="분위기" options={moodOptions} value={mood} onChange={setMood} />
        <ChoiceButtons label="장르" options={genreOptions} value={genre} onChange={setGenre} />
        <ChoiceButtons label="동반자 방식" options={companionModes} value={companionMode} onChange={setCompanionMode} />
        <button className="seed-save-button" onClick={saveWorldSession} disabled={!canSaveWorld || isSaving}>
          {isSaving ? "저장 중" : "현재 세계 저장"}
        </button>
      </section>

      <section className="studio-grid">
        <section className="transcript-panel" aria-label="대화 transcript">
          <div className="panel-heading">
            <p className="eyebrow">Live transcript</p>
            <h2>대화 기록</h2>
          </div>
          <div className="transcript-list">
            {transcript.map((line) => (
              <article className={`line ${line.speaker === "사용자" ? "user" : "assistant"}`} key={line.id}>
                <span>{line.speaker}</span>
                <p>{line.text}</p>
              </article>
            ))}
          </div>
        </section>

        <aside className="side-stack">
          <section className="spark-panel">
            <div className="panel-heading">
              <p className="eyebrow">World sparks</p>
              <h2>세계 단서</h2>
            </div>
            <div className="spark-list">
              {sparks.map((spark) => (
                <button
                  key={spark}
                  onClick={() => sendTextPrompt(`${spark}를 바탕으로 다음 질문을 하나 던져줘.`)}
                  disabled={!isRealtimeReady}
                >
                  {spark}
                </button>
              ))}
            </div>
            {!isRealtimeReady && <p className="panel-hint">세션이 연결되면 세계 단서를 대화에 다시 던질 수 있습니다.</p>}
          </section>

          <section className="prompt-panel">
            <div className="panel-heading">
              <p className="eyebrow">Quick prompts</p>
              <h2>장면 열기</h2>
            </div>
            <div className="prompt-grid">
              {openingPrompts.map((prompt) => (
                <button key={prompt} onClick={() => sendTextPrompt(prompt)} disabled={!isRealtimeReady}>
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <section className="notes-grid">
        <article>
          <h2>구현 구조</h2>
          <p>
            브라우저는 WebRTC 연결, 마이크 입력, 원격 오디오 출력, 데이터 채널 이벤트, transcript 표시를 맡습니다.
            로컬 서버는 `OPENAI_API_KEY`를 사용해 `/v1/realtime/client_secrets`에서 짧게 쓰는 client secret만 발급합니다.
          </p>
        </article>
        <article>
          <h2>검증 체크리스트</h2>
          <ul>
            {validationItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}

function ChoiceButtons({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="choice-row">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
