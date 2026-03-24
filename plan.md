# Voight-Kampff AI Bouncer Plan

## Goal

Build a fast, theatrical inbound call screener that uses Vapi for call orchestration and Cartesia for voice output, then classifies the caller as likely human or likely AI with minimal latency. The experience should feel sharp enough for a live stage demo and stable enough to become a real business call filter.

## Working Assumptions

- Primary product mode is inbound business-call screening.
- Secondary mode is a controlled live demo where a known AI caller attacks the bouncer.
- Humans should get routed out of the "bit" quickly once confidence is high.
- AI callers should get rejected, sandboxed, or trapped in a spam-sink path instead of touching sales.
- This repo stays on Next.js 16 App Router conventions.

## Non-Negotiable Experience Targets

- First spoken greeting starts immediately when the call connects.
- Average response time after caller stops speaking stays under about 1.2s.
- Interruptions feel intentional, not laggy.
- The caller should hit the first weirdness test within 5-8 seconds.
- Confident human transfer should happen within 20-30 seconds max.
- Live dashboard updates should land within 500ms of webhook receipt.
- Demo reset between runs should take under 1 minute.

## Product Modes

### 1. Production Inbound Mode

- Caller dials a Vapi-connected business number.
- The bouncer screens the caller.
- Human callers transfer to sales or front desk.
- AI callers get rejected, dumped into a sink flow, or terminated.
- Full transcript, verdict, timing, and recording metadata get logged.

### 2. Stage Demo Mode

- A known "AI sales bot" calls the bouncer on demand.
- The audience sees both sides of the exchange, live transcript, current trap, and suspicion score.
- Operator has manual controls for start, end, inject-next-trap, and emergency transfer.

### Important Demo Decision

Support both of these:

- `PSTN mode` for real inbound number tests.
- `Web-call mode` for the stage demo.

Reason: phone calls are good for authenticity, but web calls are much easier if you need reliable mirrored audio, low jitter, and real waveform rendering on screen. The production product can stay PSTN-first while the demo harness stays web-first.

## Recommended Core Architecture

### Frontend and App Shell

Use the current Next 16 App Router app as the control plane:

- Server Components by default for shell pages, initial session loads, and admin views.
- Client Components only for highly interactive pieces like live transcript streaming, waveform animation, operator controls, and score meters.
- Route Handlers inside `app/api/**/route.ts` for all webhook and control endpoints.

Do not place a `page.tsx` and `route.ts` in the same segment. Keep API handlers under dedicated `app/api/...` paths.

### Realtime and Persistence

Use two storage layers:

- Postgres for durable records:
  - call sessions
  - transcript chunks
  - trap attempts
  - verdicts
  - demo runs
- Redis or Upstash Redis for hot state:
  - live suspicion score
  - current phase
  - last interrupt timestamp
  - pub/sub fanout to the dashboard

### Vapi as the Agent Platform

Use Vapi for:

- phone number routing
- assistant/workflow orchestration
- call creation for test and demo runs
- transcripts and call event webhooks
- tool calls
- transfer / end call behavior

### Cartesia as the Voice Layer

Use Cartesia voices through Vapi for all bouncer speech output.

Predefine at least 3 voice modes:

- `calm_operator`
- `paranoid_whisper`
- `aggressive_breaker`

Do not rely on runtime experimentation during live calls. Pre-bake the exact voice IDs and speaking styles you intend to use.

## Best Orchestration Pattern

### Primary Choice: Vapi Workflow

Use a Vapi Workflow as the top-level state machine because this concept needs deterministic branching and fast exit paths:

- greeting node
- baseline probe node
- trap node 1
- condition node
- trap node 2 or human transfer
- reject / spam-sink / end call node

Why workflow first:

- the flow is not a normal freeform assistant chat
- you need hard branching
- you need predictable demo timing
- you may want different Cartesia voices by node

### Secondary Pattern: Small Specialized Assistants

If workflow authoring gets too rigid, use a small set of focused assistants instead of one giant prompt:

- Greeter
- Interrogator
- Human Handoff
- Rejection / Sink

This is still better than a single mega-assistant prompt because it reduces latency, confusion, and prompt drift.

### Cartesia-Native Fallback

Keep a contingency spike for a direct Cartesia Line SDK agent if Vapi cannot deliver the exact interruption or voice-switch behavior needed for the live show. That fallback should only exist as an R&D branch unless the Vapi prototype proves too constrained.

## Voice and Persona Design

The trick is not "be crazy forever." The trick is controlled volatility.

Design the bouncer persona in phases:

1. `Hook`
   - short, crisp, weird welcome
   - enough to unsettle an AI caller immediately
2. `Baseline`
   - ask one normal question to gather initial signal
3. `Shock`
   - abrupt emotional or semantic left turn
4. `Compression`
   - force the caller to answer in 1-3 words, a sound, or a contradiction
5. `Resolution`
   - human transfer or AI disposal

Rules for all bouncer lines:

- Keep most utterances under 12 words.
- Prefer single-beat prompts over explanations.
- Never let the bouncer monologue.
- Let interruptions happen aggressively.
- When confidence is high that the caller is human, drop the bit quickly and route them.

## Interrogation System Design

### Trap Library

Build a reusable trap library as structured data, not hard-coded prompt strings scattered through the app.

Each trap should define:

- `id`
- `phase`
- `voiceMode`
- `prompt`
- `expectedHumanSignals`
- `expectedAISignals`
- `followUpPrompt`
- `timeoutFallback`
- `scoreWeights`
- `cooldownMs`

### Trap Categories

Use a mix of these:

- absurd sound imitation
- emotional tone reversal
- contradiction check
- forced brevity
- sensory grounding
- interruption recovery
- malformed but understandable instructions
- non-linear follow-up that depends on the last 1-2 seconds

### Good Trap Qualities

- answerable instantly by a human
- annoying for an over-helpful model
- hard to solve with generic business-sales prompting
- short enough that latency does not kill the joke

### Bad Trap Qualities

- long riddles
- puzzles with no clear human answer
- anything that sounds like a captcha script
- anything that drags a real customer through 2 minutes of nonsense

## Classification Strategy

Use a hybrid scorer, not a single binary prompt.

### Real-Time Heuristic Signals

Score these as the call progresses:

- response length compared to question length
- whether the caller follows "make a sound" or "answer in one word"
- whether the caller keeps reframing into polished sales language
- repeated disclaimers or "helpful assistant" framing
- inability to recover after interruption
- over-explaining absurd prompts
- repetition of previous context instead of reacting to the newest prompt
- timing patterns after hard topic shifts

### Background Judge

Optionally run a stronger judge model in the background on the last few turns, but never let it block the next spoken reply. Fast live behavior beats perfect classification.

### Verdict States

Use 4 states instead of 2:

- `likely_human`
- `likely_ai`
- `unclear`
- `operator_override`

### Exit Logic

- `likely_human` -> immediate friendly pivot + transfer
- `likely_ai` -> reject, sink, or hang up
- `unclear` -> one final short discriminator, then safe fallback
- `operator_override` -> whatever the control-room operator chooses

## Human Path

Once the caller looks human:

- stop escalating the weirdness
- briefly acknowledge the screening bit
- transfer to sales or front desk
- preserve call context for the receiving human if possible

Recommended human pivot:

- "You sound gloriously human. One sec, transferring you."

Keep the human path fast. The funniest version of this product still loses if it punishes real customers.

## AI Path

When confidence crosses the AI threshold:

- do not route to sales
- optionally send to a spam-sink assistant
- cap the sink flow so you do not burn cost forever
- end politely but decisively if the demo bit is over

Possible AI outcomes:

- dead-end interrogation loop
- canned rejection
- log-and-hangup
- spam voicemail box

## Vapi Configuration Plan

### Workflow / Assistant Defaults

- `firstMessageMode`: assistant speaks first
- `backgroundSound`: off
- `backchanneling`: minimal or off for the bouncer
- `transcriber`: fast provider with strong realtime performance
- `voice.provider`: cartesia
- `serverUrl`: configured for webhook/event handling

### Webhook Events to Handle

Build around these Vapi event types:

- `assistant-request`
- `tool-calls`
- `status-update`
- `transcript`
- `speech-update`
- `end-of-call-report`

### Webhook Rules

- verify signatures with `serverUrlSecret`
- respond quickly
- make persistence idempotent
- never block the voice path on slow database writes

### Phone Number Setup

- use a dedicated inbound screening number
- attach the workflow or assistant to that number
- for production, prefer importing your own telephony number over relying on free test limits

### Call Creation for Testing

Use Vapi outbound calls for repeatable tests:

- scripted AI caller
- batch regression tests
- scheduled smoke tests before demos

## Cartesia Voice Plan

Pre-provision distinct voice presets for each mode:

- `calm_operator`: normal greeting and human handoff
- `paranoid_whisper`: unsettling, intimate test prompts
- `aggressive_breaker`: loud, clipped interruption prompts

Implementation rule:

- if Vapi cannot truly mutate Cartesia voice behavior mid-conversation, switch voices by moving between workflow nodes or assistant boundaries, not by hoping a single assistant prompt can fake it.

## Demo and Control Room UX

Create a live operator dashboard with these sections:

- current call status
- caller number / test label
- live transcript split by speaker
- current trap card
- suspicion score meter
- elapsed time and response latency
- verdict state
- action buttons

### Operator Buttons

- Start demo call
- End call
- Force human verdict
- Force AI verdict
- Trigger next trap
- Transfer now
- Replay last session

### Session Replay Page

Every completed call should have a replay view with:

- transcript timeline
- phase changes
- score changes
- final verdict
- recording link
- summary notes

## Waveform Strategy

Do not leave this vague because it matters for the stage demo.

### Best Option

In demo mode, use a web-call or mirrored-audio setup so you can render real waveform data in the browser.

### Acceptable Fallback

If the audio path only exposes speech activity and transcript events, synthesize a "broadcast waveform" from speech timing and energy envelopes. It will look convincing on stage even if it is not raw PCM.

### Recommendation

Treat true projected waveforms as a demo feature, not a hard dependency for production inbound PSTN calls.

## Suggested Next.js File Plan

Recommended shape for this repo:

```text
app/
  layout.tsx
  page.tsx
  demo/page.tsx
  calls/[id]/page.tsx
  api/vapi/route.ts
  api/demo/start/route.ts
  api/demo/end/route.ts
  api/live/[sessionId]/route.ts
  api/calls/[id]/route.ts
  _components/
    live-transcript.tsx
    suspicion-meter.tsx
    waveform-panel.tsx
    operator-controls.tsx
    trap-card.tsx
  _lib/
    vapi.ts
    scorer.ts
    traps.ts
    state-machine.ts
    persistence.ts
    realtime.ts
    webhook-verify.ts
```

Notes:

- Keep live-control widgets as Client Components.
- Keep data loading and session pages as Server Components where possible.
- Route Handlers should own webhook ingress, demo actions, and SSE or streaming endpoints.

## Suggested Data Model

### `call_sessions`

- id
- external_call_id
- mode (`production` or `demo`)
- source_number
- started_at
- ended_at
- final_verdict
- transferred
- recording_url
- summary

### `call_events`

- id
- call_session_id
- event_type
- speaker
- payload
- created_at

### `trap_attempts`

- id
- call_session_id
- trap_id
- phase
- voice_mode
- outcome
- score_delta
- created_at

### `verdict_snapshots`

- id
- call_session_id
- likely_human_score
- likely_ai_score
- state
- rationale
- created_at

## Environment and Secrets

Plan for these environment variables from day one:

- `VAPI_API_KEY`
- `VAPI_WEBHOOK_SECRET`
- `NEXT_PUBLIC_VAPI_PUBLIC_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- `SALES_TRANSFER_NUMBER`
- `OPENAI_API_KEY` or another live-model provider key
- `CARTESIA_API_KEY` only if you build the direct Line fallback path

Recommended defaults:

- Vapi handles orchestration and telephony
- Cartesia handles voice output inside Vapi
- Deepgram `nova-3` is a good first transcriber choice for realtime responsiveness

## Model Strategy

Use a fast model for the live bouncer brain and reserve heavier reasoning for offline or background classification.

Good rule:

- live conversation model: fast, tool-friendly
- background judge model: stronger, slower
- never put the stronger model directly in the synchronous voice loop unless it proves fast enough in practice

## Performance Rules

- keep tool call outputs tiny
- cache trap definitions in memory
- trim transcript context aggressively
- persist asynchronously when possible
- debounce score recomputation
- avoid any network call in the critical path that is not absolutely necessary
- warm up the demo path before going on stage

## Regression Test Matrix

Before calling this "ready," repeatedly test at least these scenarios:

- normal human caller who answers quickly
- normal human caller who is confused by the bit
- human caller who immediately says "representative" or "human"
- AI caller with a generic sales prompt
- AI caller with a very short-answer prompt
- AI caller that has interruption handling enabled
- voicemail pickup
- silence / dead air
- transfer target unavailable
- webhook event replay or out-of-order delivery
- operator override mid-call
- stage demo run with projected dashboard

Success means the system still feels intentional, not that every single AI caller gets caught.

## Demo-Day Checklist

Run this before any live presentation:

- warm the deployment with at least one real test call
- verify the Vapi webhook endpoint is reachable
- verify signature validation is passing
- verify the inbound number is attached to the correct workflow
- verify the transfer number is live
- verify the operator dashboard reconnects cleanly
- verify the scripted AI caller still uses the expected prompt
- keep one operator-triggered emergency hangup button visible at all times
- keep one operator-triggered direct transfer button visible at all times
- keep a backup prerecorded session ready in case telephony fails on stage

## Reliability Rules

- every webhook handler must be idempotent
- keep a manual operator override at all times
- keep an emergency transfer path at all times
- keep an emergency hangup path at all times
- store enough state that the dashboard can reconnect mid-call without losing context

## Safety, Legal, and Product Guardrails

- provide an explicit human escape hatch such as "say human" or press `0`
- cap how long a real caller can stay trapped in screening
- do not classify based on accent, disability, or language proficiency
- classify behavior under this interaction pattern only
- honor recording disclosure requirements for the relevant jurisdiction
- redact obvious PII from durable analytics where possible
- allowlist trusted numbers to bypass the bouncer

## Analytics That Matter

Track:

- time to first weird prompt
- time to verdict
- transfer rate
- false-positive human-to-AI rate
- false-negative AI-to-human rate
- average response latency
- call abandonment rate
- most effective traps
- traps that annoy humans too often

## Build Order

### Phase 0: Foundations

- replace starter content with product shell
- add env plumbing
- add DB schema
- add Redis / realtime layer

### Phase 1: Vapi Plumbing

- create inbound number
- create initial workflow or assistant
- implement webhook route
- ingest transcripts and status events

### Phase 2: Interrogation Engine

- implement trap library
- implement scorer
- implement state machine
- implement human and AI exit paths

### Phase 3: Control Room

- build live transcript
- build score meter
- build trap card
- build operator controls
- build session replay

### Phase 4: Demo Harness

- build scripted AI caller
- add one-click start-demo flow
- add waveform rendering
- add stage-safe operator overrides

### Phase 5: Hardening

- signature verification
- idempotency
- replay protection
- latency tuning
- error handling

### Phase 6: Evaluation

- run repeated AI-vs-AI test calls
- tune thresholds
- cut traps that annoy humans
- keep only the highest-yield patterns

### Phase 7: Cartesia Fallback Spike

- prototype the same flow in Cartesia Line
- compare interruption feel
- compare voice switching
- keep only if the delta is meaningful

## Immediate Next Deliverables

The first practical milestone should produce all of this:

- a Vapi-connected inbound bouncer number
- a basic 3-phase workflow
- a webhook route in Next
- live transcript in the dashboard
- one human transfer path
- one AI rejection path
- one reproducible demo call button

If that milestone feels good, the rest becomes tuning instead of reinvention.
