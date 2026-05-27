# World Room

한국어 실시간 오디오 세계 만들기 앱입니다. 사용자는 마이크로 말하고, OpenAI Realtime API 기반 동반자는 낮은 지연으로 응답하면서 설정, 인물, 갈등, 장면 훅을 함께 발명합니다.

## 사용한 Realtime 패턴

- 브라우저는 `RTCPeerConnection`으로 마이크 입력과 모델 음성 출력을 처리합니다.
- 브라우저는 `RTCDataChannel`의 `oai-events`로 transcript, 상태, 오류 이벤트를 받습니다.
- 로컬 서버는 표준 `OPENAI_API_KEY`를 보관하고 `/v1/realtime/client_secrets`에서 ephemeral client secret을 발급합니다.
- 브라우저는 발급받은 client secret으로 `https://api.openai.com/v1/realtime/calls`에 SDP offer를 보내 WebRTC 세션을 엽니다.
- 기본 모델은 OpenAI 모델 문서의 Realtime 음성 모델인 `gpt-realtime-2`입니다.

참고 문서:

- Realtime WebRTC: https://developers.openai.com/api/docs/guides/realtime-webrtc
- Realtime 개요: https://developers.openai.com/api/docs/guides/realtime
- 모델 목록: https://developers.openai.com/api/docs/models

## 로컬 설정

1. 의존성을 설치합니다.

```bash
npm install
```

2. 환경 변수를 준비합니다.

```bash
copy .env.example .env
```

`.env`에 OpenAI API 키를 넣습니다.

```bash
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=marin
OPENAI_SUMMARY_MODEL=gpt-5.4-mini
PORT=8787
ALLOWED_ORIGIN=http://localhost:5173
VITE_REALTIME_TOKEN_URL=/api/token
VITE_SESSION_SAVE_URL=/api/sessions
VITE_RECENT_WORLDS_URL=/api/worlds/recent
SUPABASE_URL=https://your-project.supabase.co
# `SUPABASE_URL` 대신 Vercel/Supabase 템플릿의 `NEXT_PUBLIC_SUPABASE_URL`을 써도 됩니다.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Supabase SQL Editor에서 `supabase/schema.sql`을 실행해 `worlds`, `sessions`, `canon_cards` 테이블을 만듭니다.

3. 로컬 개발에서는 터미널 1에서 토큰 서버를 실행합니다.

```bash
npm run server
```

4. 터미널 2에서 Vite 앱을 실행합니다.

```bash
npm run dev
```

5. 브라우저에서 `http://localhost:5173`을 열고 **세션 시작**을 누릅니다.

Vercel 배포에서는 `api/` 폴더의 serverless functions가 `/api/token`, `/api/sessions`, `/api/worlds/recent`를 제공합니다. Vercel 환경변수를 바꾼 뒤에는 반드시 Redeploy가 필요합니다.

## 역할 분리

브라우저 책임:

- 마이크 권한 요청
- 로컬 오디오 트랙을 WebRTC peer connection에 추가
- 모델의 원격 오디오 트랙 자동 재생
- 데이터 채널 이벤트 수신
- transcript, 세션 상태, 오류, 세계 단서 표시
- 마이크 음소거와 세션 종료
- 현재 세계를 `POST /sessions`로 저장 요청
- 최근 세계 3개를 `/worlds/recent`에서 불러오고, 이어 말하기 컨텍스트를 선택

서버 책임:

- `OPENAI_API_KEY` 보관
- Realtime client secret 발급
- 세션 저장 요청을 받아 Responses API로 요약한 뒤 Supabase `worlds`, `sessions`, `canon_cards`에 저장
- 최근 세계 3개를 Supabase에서 조회
- 모델, 음성, 지시문, VAD, 전사 모델 설정
- `OpenAI-Safety-Identifier`를 서버에서 설정
- 브라우저에 표준 API 키를 절대 전달하지 않음

## 개발자 노트

지연 시간:

- 브라우저 오디오에는 WebRTC를 사용합니다.
- `reasoning.effort`는 `low`로 시작해 턴 응답성을 우선합니다.
- `server_vad`의 `silence_duration_ms`는 짧을수록 빠르게 끊어 듣지만, 너무 낮으면 말 중간에 끊길 수 있습니다.

세션 생명주기:

- `세션 시작`은 마이크 권한 요청, client secret 발급, SDP offer/answer 교환 순서로 진행됩니다.
- data channel이 열리면 짧은 시작 프롬프트를 보내 동반자가 먼저 음성으로 말을 겁니다.
- `세션 종료`는 data channel, peer connection, 마이크 트랙, 원격 audio element를 정리합니다.

권한:

- 마이크 권한은 브라우저가 직접 요청합니다.
- 권한이 거부되면 앱은 오류 상태를 표시하고 세션을 만들지 않습니다.
- HTTPS가 아닌 환경에서는 `localhost`에서만 마이크 권한이 안정적으로 동작합니다.

오류 복구:

- 토큰 서버가 꺼져 있거나 `OPENAI_API_KEY`가 없으면 화면에 오류가 표시됩니다.
- WebRTC 연결이 `failed` 또는 `disconnected`가 되면 복구 상태로 바뀌며 세션 재시작을 안내합니다.
- ephemeral client secret은 짧게 쓰는 값이므로 연결 실패 후에는 새 세션을 시작해 새 토큰을 받는 편이 안전합니다.

## 검증 체크리스트

- 브라우저가 마이크 권한을 요청한다.
- 권한 거부 시 오류 상태와 안내 문구가 보인다.
- 토큰 서버가 꺼져 있을 때 연결 실패가 명확히 표시된다.
- `세션 시작` 후 상태가 `권한 요청` → `연결 중` → `대화 준비`로 이동한다.
- 사용자가 말하면 사용자 transcript가 표시된다.
- 동반자 음성이 재생되고 동반자 transcript가 표시된다.
- 설정, 인물, 갈등, 장면, 훅 라벨이 붙은 문장이 세계 단서 패널에 쌓인다.
- 네트워크를 끊거나 새로고침한 뒤 세션을 다시 시작할 수 있다.
- `마이크 끄기`가 로컬 오디오 트랙을 비활성화한다.
- `세션 종료` 후 마이크 사용 표시가 사라진다.
- 대화가 생긴 뒤 `세계 저장`을 누르면 Supabase에 세계/세션/카드가 저장된다.
- 앱 시작 시 최근 세계 3개가 카드로 표시된다.
- 최근 세계 카드의 `이어 말하기`를 누르면 다음 세션 시작 프롬프트에 `continuity_brief`가 포함된다.

## 확인 명령

```bash
npm test
npm run build
```
