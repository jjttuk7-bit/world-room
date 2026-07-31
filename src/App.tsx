import { useEffect, useMemo, useRef, useState } from "react";
import { appendTranscriptLine, reduceRealtimeEvent } from "./realtime/events";
import type { RealtimeSignal, TranscriptLine } from "./realtime/events";
import type { StoryCanon, StoryDraft, StoryScene } from "./story/models";
import { approvedBriefOpeningContext, createCreativeBrief, type CreativeBrief } from "./brief/models";

type SessionState = "idle" | "requesting" | "connecting" | "ready" | "listening" | "speaking" | "recovering" | "ended" | "error";

type StudioMode = "conversation" | "manuscript" | "bible";

const tokenUrl = import.meta.env.VITE_REALTIME_TOKEN_URL ?? "/api/token";
const sessionSaveUrl = import.meta.env.VITE_SESSION_SAVE_URL ?? "/api/sessions";
const recentWorldsUrl = import.meta.env.VITE_RECENT_WORLDS_URL ?? "/api/worlds/recent";
const worldsUrl = import.meta.env.VITE_WORLDS_URL ?? "/api/worlds";
const storyDraftsUrl = import.meta.env.VITE_STORY_DRAFTS_URL ?? "/api/story/drafts";
const creativeBriefUrl = import.meta.env.VITE_CREATIVE_BRIEF_URL ?? "/api/creative-brief";

type RecentWorld = {
  id: string;
  title: string;
  summary: string;
  continuityBrief: string;
  updatedAt?: string;
  latestSessionId?: string;
};

const moodOptions = ["몽환적", "어두운", "따뜻한", "기묘한", "모험적"];
const genreOptions = ["판타지", "SF", "미스터리", "호러", "동화", "동양풍"];
const companionModes = ["질문 위주", "선택지 제안", "장면 묘사", "인물 중심"];
const bibleGroups: ReadonlyArray<{ label: string; types: readonly StoryCanon["type"][] }> = [
  { label: "인물", types: ["character"] },
  { label: "장소와 규칙", types: ["setting"] },
  { label: "미해결 갈등", types: ["conflict", "scene_hook"] },
];

function createWelcomeTranscript(): TranscriptLine[] {
  return [{
    id: "welcome",
    speaker: "시스템",
    text: "세션을 시작하면 World Room 동반자가 한국어 음성으로 세계, 인물, 갈등, 장면 훅을 함께 만들어줍니다.",
    final: true,
  }];
}

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
  const [sparks, setSparks] = useState<string[]>([]);
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
  const [activeMode, setActiveMode] = useState<StudioMode>("conversation");
  const [seedOpen, setSeedOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingWorldTitle, setPendingWorldTitle] = useState("");
  const [pendingWorldSeed, setPendingWorldSeed] = useState("");
  const [pendingMood, setPendingMood] = useState(moodOptions[0]);
  const [pendingGenre, setPendingGenre] = useState(genreOptions[0]);
  const [pendingCompanionMode, setPendingCompanionMode] = useState(companionModes[0]);
  const [drafts, setDrafts] = useState<StoryDraft[]>([]);
  const [scenes, setScenes] = useState<StoryScene[]>([]);
  const [canon, setCanon] = useState<StoryCanon[]>([]);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftError, setDraftError] = useState("");
  const [draftAction, setDraftAction] = useState<"generate" | "accept" | "hold" | "revise" | "load" | "">("");
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [revisionTitle, setRevisionTitle] = useState("");
  const [revisionBody, setRevisionBody] = useState("");
  const [briefInput, setBriefInput] = useState("");
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief | null>(null);
  const [briefAction, setBriefAction] = useState(false);
  const [briefError, setBriefError] = useState("");

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seedDialogRef = useRef<HTMLDialogElement | null>(null);

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
  const canStartSession = Boolean(creativeBrief?.approved);

  useEffect(() => {
    void loadRecentWorlds();
  }, []);

  useEffect(() => {
    if (!seedOpen) return;
    const dialog = seedDialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    }
  }, [seedOpen]);

  async function loadRecentWorlds(): Promise<RecentWorld[]> {
    try {
      const response = await fetch(recentWorldsUrl);
      if (!response.ok) return [];
      const result = await response.json();
      const worlds = (result.worlds ?? []).slice(0, 3) as RecentWorld[];
      setRecentWorlds(worlds);
      return worlds;
    } catch {
      setRecentWorlds([]);
      return [];
    }
  }

  async function loadStoryWorkspace(worldId: string) {
    setDraftAction("load");
    setDraftError("");
    try {
      const [draftResponse, storyResponse] = await Promise.all([
        fetch(`${storyDraftsUrl}?worldId=${encodeURIComponent(worldId)}`),
        fetch(`${worldsUrl}/${encodeURIComponent(worldId)}/story`),
      ]);
      const [draftResult, storyResult] = await Promise.all([draftResponse.json(), storyResponse.json()]);
      if (!draftResponse.ok) throw new Error(draftResult.error?.message ?? "저장된 초안을 불러오지 못했습니다.");
      if (!storyResponse.ok) throw new Error(storyResult.error?.message ?? "저장된 원고를 불러오지 못했습니다.");
      setDrafts(draftResult.drafts ?? []);
      setScenes(storyResult.scenes ?? []);
      setCanon(storyResult.canon ?? []);
    } catch (caught) {
      setDraftError(caught instanceof Error ? caught.message : "창작 기록을 불러오지 못했습니다.");
    } finally { setDraftAction(""); }
  }

  async function startSession() {
    if (!canStartSession) { setBriefError("대화를 시작하기 전에 오늘 만들 이야기를 먼저 정리해 주세요."); return; }
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

  async function proposeCreativeBrief() {
    setBriefError("");
    let request: CreativeBrief;
    try { request = createCreativeBrief({ intent: briefInput }); } catch (caught) { setBriefError(caught instanceof Error ? caught.message : "창작 의도를 입력해 주세요."); return; }
    setBriefAction(true);
    try {
      const response = await fetch(creativeBriefUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? result.error ?? "창작 브리프를 제안하지 못했습니다.");
      setCreativeBrief(result);
    } catch (caught) { setBriefError(caught instanceof Error ? caught.message : "창작 브리프를 제안하지 못했습니다."); } finally { setBriefAction(false); }
  }

  function approveCreativeBrief() {
    if (!creativeBrief) return;
    setCreativeBrief({ ...creativeBrief, approved: true });
    setBriefError("");
    setStatusText("오늘의 창작 브리프가 준비되었습니다.");
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
      const title = worldTitle.trim() || firstUserLine?.text || selectedWorld?.title || "World Room 세션";
      const response = await fetch(sessionSaveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
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
      const savedWorldId = String(result.worldId ?? selectedWorld?.id ?? "");
      const recent = await loadRecentWorlds();
      if (savedWorldId) {
        const savedWorld = recent.find((world) => world.id === savedWorldId) ?? {
          id: savedWorldId,
          title: String(result.world?.title ?? title),
          summary: String(result.world?.summary ?? selectedWorld?.summary ?? ""),
          continuityBrief: String(result.world?.continuityBrief ?? selectedWorld?.continuityBrief ?? ""),
          updatedAt: new Date().toISOString(),
          latestSessionId: String(result.sessionId ?? result.world?.latestSessionId ?? selectedWorld?.latestSessionId ?? ""),
        };
        setSelectedWorld(savedWorld);
        await loadStoryWorkspace(savedWorld.id);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "세션 저장에 실패했습니다.";
      setError(message);
      setSaveStatus("");
    } finally {
      setIsSaving(false);
    }
  }

  function openNewWorld() {
    setPendingWorldTitle("");
    setPendingWorldSeed("");
    setPendingMood(moodOptions[0]);
    setPendingGenre(genreOptions[0]);
    setPendingCompanionMode(companionModes[0]);
    setError("");
    setSaveStatus("");
    setSeedOpen(true);
  }

  function commitNewWorld() {
    stopSession(false);
    setWorldTitle(pendingWorldTitle);
    setWorldSeed(pendingWorldSeed);
    setMood(pendingMood);
    setGenre(pendingGenre);
    setCompanionMode(pendingCompanionMode);
    setSelectedWorld(null);
    setTranscript(createWelcomeTranscript());
    setSparks([]);
    setDrafts([]);
    setScenes([]);
    setCanon([]);
    setSessionState("idle");
    setMuted(false);
    setError("");
    setSaveStatus("");
    setLibraryOpen(false);
    setActiveMode("conversation");
    setSeedOpen(false);
    setStatusText("새 세계의 첫 문장을 기다리고 있습니다.");
  }
  function continueWorld(world: RecentWorld) {
    setSelectedWorld(world);
    setDrafts([]);
    setScenes([]);
    setCanon([]);
    setStatusText(`${world.title} 이어 말하기 준비`);
    void loadStoryWorkspace(world.id);
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

  const storyTranscript = transcript.filter((line) => (line.speaker === "사용자" || line.speaker === "동반자") && line.text.trim());
  const activeDraft = drafts.find((draft) => draft.status === "proposed");
  const hasMeaningfulStoryContext = storyTranscript.length >= 2 && storyTranscript.reduce((total, line) => total + line.text.trim().length, 0) >= 48;
  const canGenerateDraft = Boolean(selectedWorld?.id) && hasMeaningfulStoryContext && !activeDraft && !draftAction;

  async function generateStoryDraft() {
    if (!selectedWorld || !canGenerateDraft) return;
    setDraftAction("generate"); setDraftError(""); setDraftStatus("장면 초안을 쓰는 중입니다.");
    try {
      const response = await fetch(`${worldsUrl}/${encodeURIComponent(selectedWorld.id)}/story`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ world: { title: selectedWorld.title, continuityBrief: selectedWorld.continuityBrief, summary: selectedWorld.summary }, sessionId: selectedWorld.latestSessionId, transcript: storyTranscript, canon }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "장면 초안 생성에 실패했습니다.");
      setDrafts((current) => [result, ...current.filter((draft) => draft.id !== result.id)]);
      setDraftStatus("대화 근거를 바탕으로 장면 초안을 제안했습니다.");
    } catch (caught) { setDraftError(caught instanceof Error ? caught.message : "장면 초안 생성에 실패했습니다."); setDraftStatus(""); } finally { setDraftAction(""); }
  }

  async function updateStoryDraft(draft: StoryDraft, action: "accept" | "hold" | "revise") {
    if (!selectedWorld) return;
    setDraftAction(action); setDraftError("");
    try {
      const response = action === "accept"
        ? await fetch(`${storyDraftsUrl}/${encodeURIComponent(draft.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: selectedWorld.id, action: "accept" }) })
        : await fetch(`${storyDraftsUrl}/${encodeURIComponent(draft.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "hold" ? { worldId: selectedWorld.id, action: "hold" } : { worldId: selectedWorld.id, title: revisionTitle.trim(), body: revisionBody.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "초안을 저장하지 못했습니다.");
      if (action === "accept") { setScenes((current) => [...current.filter((scene) => scene.id !== result.id), result].sort((a, b) => a.order - b.order)); setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: "accepted" } : item)); setDraftStatus("장면을 원고에 채택했습니다."); }
      else if (action === "hold") { setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: "held" } : item)); setDraftStatus("초안을 보관했습니다."); }
      else { setDrafts((current) => [result, ...current.map((item) => item.id === draft.id ? { ...item, status: "revising" } : item)]); setEditingDraftId(null); setDraftStatus("수정한 장면을 새 초안으로 제안했습니다."); }
    } catch (caught) { setDraftError(caught instanceof Error ? caught.message : "초안을 저장하지 못했습니다."); } finally { setDraftAction(""); }
  }

  function beginRevision(draft: StoryDraft) { setEditingDraftId(draft.id); setRevisionTitle(draft.title); setRevisionBody(draft.body); setDraftError(""); }

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

  const modeLabels: Array<{ id: StudioMode; label: string }> = [
    { id: "conversation", label: "대화" },
    { id: "manuscript", label: "원고" },
    { id: "bible", label: "세계 성경" },
  ];

  return (
    <main className="studio-shell" id="main-content">
      <a className="skip-link" href="#studio-content">본문으로 건너뛰기</a>
      <header className="studio-header">
        <div className="studio-ident"><p className="eyebrow">Private writing studio</p><h1>World Room</h1><p className="world-name">{selectedWorld?.title || worldTitle || "아직 이름 없는 세계"}</p></div>
        <nav className="mode-nav" aria-label="작업 모드">{modeLabels.map((mode) => <button key={mode.id} type="button" aria-pressed={activeMode === mode.id} onClick={() => setActiveMode(mode.id)}>{mode.label}</button>)}</nav>
        <div className="header-actions"><button className="text-button" type="button" onClick={() => setLibraryOpen((current) => !current)} aria-expanded={libraryOpen}>보관함</button><button className="new-world-button" type="button" onClick={openNewWorld}>새 세계</button></div>
      </header>
      {(error || saveStatus) && <p className="studio-notice" role="status">{error || saveStatus}</p>}
      <section className="studio-content" id="studio-content">
        {activeMode === "conversation" && <section className="conversation-stage" aria-labelledby="conversation-title">
          <div className="conversation-intro"><p className="eyebrow">오늘의 장면</p><h2 id="conversation-title">{creativeBrief?.approved ? "말로 다음 장면을 찾아보세요" : "어떤 이야기를 만들고 싶으세요?"}</h2><p>{creativeBrief?.approved ? "동반자와 이야기하면, 결정된 설정과 장면의 실마리가 이 세계의 기록으로 남습니다." : "먼저 한 줄로 방향을 적어 주세요. World Room이 오늘의 창작 브리프로 정리한 뒤, 당신이 확인한 방향에서만 대화를 엽니다."}</p></div>
          <section className="creative-brief" aria-labelledby="brief-title">
            <div><p className="eyebrow">Before voice</p><h3 id="brief-title">오늘의 창작 브리프</h3></div>
            {!creativeBrief ? <><label>만들고 싶은 이야기<textarea aria-label="만들고 싶은 이야기" value={briefInput} onChange={(event) => setBriefInput(event.target.value)} placeholder="예: 기억을 잃은 잠수사의 첫 귀환 장면을 만들고 싶어요." rows={3} /></label><button type="button" className="primary-button" onClick={() => void proposeCreativeBrief()} disabled={briefAction}>{briefAction ? "방향을 정리하는 중" : "방향 정리하기"}</button></> : <><dl><div><dt>창작 의도</dt><dd>{creativeBrief.intent}</dd></div>{creativeBrief.conflict && <div><dt>핵심 갈등</dt><dd>{creativeBrief.conflict}</dd></div>}{creativeBrief.tone && <div><dt>분위기와 문체</dt><dd>{creativeBrief.tone}</dd></div>}{creativeBrief.requiredElements.length > 0 && <div><dt>반드시 포함할 요소</dt><dd>{creativeBrief.requiredElements.join(" · ")}</dd></div>}{creativeBrief.sessionGoal && <div><dt>이번 대화의 목표</dt><dd>{creativeBrief.sessionGoal}</dd></div>}</dl>{creativeBrief.approved ? <p className="brief-approved">이 방향으로 대화를 시작합니다. 동반자는 먼저 어느 장면부터 열지 질문합니다.</p> : <div className="brief-actions"><button type="button" className="text-button" onClick={() => setCreativeBrief(null)}>다시 정리</button><button type="button" className="primary-button" onClick={approveCreativeBrief}>이 브리프로 대화 시작</button></div>}</>}
            {briefError && <p className="draft-feedback error" role="status">{briefError}</p>}
          </section>
          <div className="conversation-layout"><section className="transcript-sheet" aria-label="대화 기록"><div className="sheet-heading"><span>대화 기록</span><span>{stateLabel}</span></div><div className="transcript-list">{transcript.map((line) => <article className={`line ${line.speaker === "사용자" ? "user" : "assistant"}`} key={line.id}><span>{line.speaker}</span><p>{line.text}</p></article>)}</div></section><aside className="conversation-margin" aria-label="대화 단서와 장면 초안">
            <p className="margin-label">대화에서 포착한 단서</p>
            {sparks.length ? <div className="spark-list">{sparks.map((spark) => <button key={spark} onClick={() => sendTextPrompt(`${spark}를 바탕으로 다음 질문을 하나 던져줘.`)} disabled={!isRealtimeReady}>{spark}</button>)}</div> : <p className="empty-panel-copy">아직 단서가 없습니다. 첫 문장을 말하면 세계의 결이 기록됩니다.</p>}
            <section className="draft-review" aria-labelledby="draft-review-title">
              <div className="draft-review-heading"><div><p className="margin-label">함께 만드는 이야기</p><h3 id="draft-review-title">장면 초안</h3></div>{draftAction === "load" && <span>불러오는 중</span>}</div>
              {activeDraft ? <article className="draft-card"><p className="draft-kicker">제안됨 · {activeDraft.sourceTranscriptIds.length}개의 대화 근거</p><h4>{activeDraft.title}</h4>{editingDraftId === activeDraft.id ? <><label>장면 제목<input aria-label="장면 제목" value={revisionTitle} onChange={(event) => setRevisionTitle(event.target.value)} /></label><label>장면 본문<textarea aria-label="장면 본문" value={revisionBody} onChange={(event) => setRevisionBody(event.target.value)} rows={6} /></label><div className="draft-actions"><button type="button" className="text-button" onClick={() => setEditingDraftId(null)}>취소</button><button type="button" className="primary-button" disabled={draftAction === "revise" || !revisionTitle.trim() || !revisionBody.trim()} onClick={() => void updateStoryDraft(activeDraft, "revise")}>{draftAction === "revise" ? "수정 중" : "수정 제안"}</button></div></> : <><p>{activeDraft.body}</p><p className="draft-sources">근거: {activeDraft.sourceTranscriptIds.map((id) => storyTranscript.find((line) => line.id === id)?.text || id).join(" · ")}</p><div className="draft-actions"><button type="button" className="primary-button" disabled={Boolean(draftAction)} onClick={() => void updateStoryDraft(activeDraft, "accept")}>{draftAction === "accept" ? "채택 중" : "원고에 채택"}</button><button type="button" className="text-button" disabled={Boolean(draftAction)} onClick={() => beginRevision(activeDraft)}>수정</button><button type="button" className="text-button" disabled={Boolean(draftAction)} onClick={() => void updateStoryDraft(activeDraft, "hold")}>{draftAction === "hold" ? "보관 중" : "보류"}</button></div></>}</article> : <div className="draft-empty"><p>{selectedWorld ? hasMeaningfulStoryContext ? "대화의 결이 잡혔습니다. 장면으로 옮겨 보세요." : "장면 초안은 대화가 충분히 쌓인 뒤 만들 수 있습니다." : "저장한 세계를 이어가면 장면 초안을 기록할 수 있습니다."}</p><button type="button" className="primary-button" onClick={() => void generateStoryDraft()} disabled={!canGenerateDraft}>{draftAction === "generate" ? "초안 쓰는 중" : draftError ? "다시 시도" : "장면 초안 만들기"}</button></div>}
              {(draftStatus || draftError) && <p className={draftError ? "draft-feedback error" : "draft-feedback"} role="status">{draftError || draftStatus}</p>}
            </section>
          </aside></div>
          <footer className="voice-dock" aria-label="대화 조작"><div className={`voice-pulse ${sessionState}`} aria-hidden="true"><span /></div><div><strong>{statusText}</strong><span>마이크로 말하면 대화가 기록됩니다.</span></div><div className="voice-actions"><button className="primary-button" onClick={startSession} disabled={!canStartSession || sessionState === "requesting" || sessionState === "connecting"}>{!canStartSession ? "브리프를 먼저 정리하세요" : sessionState === "idle" || sessionState === "ended" || sessionState === "error" ? "대화 시작" : "대화 다시 시작"}</button><button className="icon-button" onClick={toggleMute} disabled={!streamRef.current}>{muted ? "마이크 켜기" : "마이크 끄기"}</button><button className="text-button" onClick={() => stopSession()} disabled={!peerRef.current}>종료</button><button className="text-button" onClick={saveWorldSession} disabled={!canSaveWorld || isSaving}>{isSaving ? "저장 중" : "세계 저장"}</button></div></footer>
        </section>}
        {activeMode === "manuscript" && <section className="writing-view" aria-labelledby="manuscript-title"><p className="eyebrow">Manuscript</p><h2 id="manuscript-title">원고</h2><p className="view-lead">채택한 장면이 이곳에서 한 편의 이야기로 이어집니다.</p>{scenes.length ? <div className="manuscript-scenes">{scenes.map((scene) => <article key={scene.id} className="manuscript-scene"><span>{String(scene.order).padStart(2, "0")}</span><h3>{scene.title || "이름 없는 장면"}</h3><p>{scene.content}</p><small>대화 근거 {scene.sourceTranscriptIds?.length ?? 0}개 · 세계 성경 {scene.relatedCanonIds?.length ?? 0}개</small>{scene.relatedCanonIds?.length ? <p className="scene-source-links">{scene.relatedCanonIds.map((id) => canon.find((card) => card.id === id)?.title ?? id).join(" · ")}</p> : null}</article>)}</div> : <article className="empty-manuscript"><span>01</span><h3>아직 채택된 장면이 없습니다</h3><p>대화에서 떠오른 장면을 검토하고 채택하면, 이곳에 작가의 원고로 쌓입니다.</p><button type="button" onClick={() => setActiveMode("conversation")}>대화로 돌아가기</button></article>}</section>}
        {activeMode === "bible" && <section className="writing-view" aria-labelledby="bible-title"><p className="eyebrow">World bible</p><h2 id="bible-title">세계 성경</h2><p className="view-lead">인물, 장소, 규칙과 사건을 대화의 근거와 함께 보관합니다.</p><div className="bible-columns">{bibleGroups.map((group) => { const cards = canon.filter((card) => group.types.includes(card.type)); return <article key={group.label}><h3>{group.label}</h3>{cards.length ? <div className="canon-card-list">{cards.map((card) => <section className="canon-card" key={card.id}><h4>{card.title}</h4><p>{card.content}</p><small>{card.sourceSessionId ? `세션 근거 · ${card.sourceSessionId}` : "세션 근거 없음"}</small></section>)}</div> : <p className="empty-canon">아직 기록된 {group.label === "장소와 규칙" ? "설정" : group.label}이 없습니다.</p>}</article>; })}</div></section>}
      </section>
      {libraryOpen && <aside className="library-panel" aria-label="작업 보관함"><div className="panel-heading"><div><p className="eyebrow">Saved worlds</p><h2>최근 세계</h2></div><button className="text-button" type="button" onClick={() => setLibraryOpen(false)}>닫기</button></div><div className="world-card-grid">{recentWorlds.length ? recentWorlds.map((world) => <article className={selectedWorld?.id === world.id ? "world-card selected" : "world-card"} key={world.id}><span>{world.updatedAt ? new Date(world.updatedAt).toLocaleDateString("ko-KR") : "최근 저장"}</span><h3>{world.title}</h3><p>{world.summary}</p><div className="world-card-actions"><button onClick={() => { continueWorld(world); setLibraryOpen(false); }}>{world.title} 이어 말하기</button><button className="danger-button" onClick={() => void deleteWorld(world)}>{world.title} 삭제</button></div></article>) : <p className="empty-panel-copy">저장한 세계가 아직 없습니다.</p>}</div></aside>}
      {seedOpen && <dialog ref={seedDialogRef} className="seed-dialog" aria-label="새 세계 열기" onCancel={(event) => { event.preventDefault(); setSeedOpen(false); }} onClose={() => setSeedOpen(false)}><form method="dialog" onSubmit={(event) => { event.preventDefault(); commitNewWorld(); }}><div className="dialog-heading"><div><p className="eyebrow">New world</p><h2>새 세계 열기</h2></div><button className="text-button" type="button" onClick={() => setSeedOpen(false)}>닫기</button></div><p>완벽한 설정은 필요 없습니다. 한 줄의 씨앗이면 충분합니다.</p><label className="seed-input">세계 이름<input value={pendingWorldTitle} onChange={(event) => setPendingWorldTitle(event.target.value)} placeholder="예: 거꾸로 비가 내리는 항구" /></label><label className="seed-input">세계 씨앗<textarea value={pendingWorldSeed} onChange={(event) => setPendingWorldSeed(event.target.value)} placeholder="예: 비가 위로 내리는 항구 도시" rows={3} /></label><ChoiceButtons label="분위기" options={moodOptions} value={pendingMood} onChange={setPendingMood} /><ChoiceButtons label="장르" options={genreOptions} value={pendingGenre} onChange={setPendingGenre} /><ChoiceButtons label="동반자 방식" options={companionModes} value={pendingCompanionMode} onChange={setPendingCompanionMode} /><button className="seed-save-button" type="submit">이 세계 열기</button></form></dialog>}
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
