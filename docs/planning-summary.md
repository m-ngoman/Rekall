# PipCards Rebuild — Planning Summary

Context for Claude Code: this document summarizes architecture and product decisions made during planning conversations with Claude (chat), before any code was written. Nothing described here has been implemented yet — treat all of it as design intent to build toward, not existing code to assume is present.

## Project overview

PipCards is a flashcard/study app being rebuilt from the ground up. Not being commercialized broadly for now — pivoting to a self-hosted app for Adam + friends, since early prototype testers loved it.

**Pricing model**
- Friends: card generation + review free (cost absorbed by Adam). Voice/tutor mode billed at Adam's base cost rate (cost-passthrough, no profit) — can start as manual tracking/Venmo, no Stripe needed yet.
- Public/strangers (if it organically spreads): pay a profitable rate for both card gen and voice/tutor mode.
- Data model implication: simple `tier` field on user accounts to support this later.

**Build approach**: full rebuild, not incremental patch — but reuse stable pieces: FSRS scheduling logic, Google OAuth/Drive sync, core card CRUD. New builds needed: review UI (typed/voice answer entry), grading pipeline, tutor mode, tiered access/billing, voice mode UI, notes storage.

**Core product philosophy**: give users genuine control over app behavior rather than locking things down. This is a first-principles value, not just a feature preference — bias toward exposing controls (tucked away via progressive disclosure) rather than hiding them, whenever there's a choice between configurability and a fixed default.

---

## Core feature additions

1. **Typed/voice answer entry** — replaces self-assessment difficulty rating. Students type or speak actual answers instead of just rating recall difficulty (active recall > self-assessment).

2. **Answer grading pipeline** — local model grades typed/spoken answers against a reference answer, outputs an FSRS-compatible rating (again/hard/good/easy) plus a short explanation. Explanation scales with correctness (brief when correct, more detail when wrong/partial). Explanation and FSRS rating are kept as separate fields in structured JSON output — explanation must never leak into scheduling logic.

3. **Voice mode** — alternative input method, not a replacement for typing. Whisper-class STT (whisper.cpp / faster-whisper, base/small size) + local TTS to read questions/explanations aloud. Push-to-talk, not hands-free/wake-word (simpler build, matches "alternative not replacement" framing).

4. **Tutor/conversational mode** — separate mode from card review. Voice-capable Socratic-style study agent with RAG-style read access to the user's card database (weak cards by FSRS stability/recent "again" ratings, deck difficulty, terminology) to ground conversation and reduce hallucination. Could suggest new cards from conversation back into the FSRS deck. Building a new pipeline rather than resurrecting the old StudyBot/PipAI codebase, though that prior work (QLoRA pipeline, frustration detection, topic-switch logic) is a reference point. Candidate models for this tier: DeepSeek V4 Flash or Claude Haiku 4.5 (tradeoff: DeepSeek cheaper, Haiku better pedagogical/tone judgment — latency needs real benchmarking given voice mode's conversational feel).

5. **Digital notes storage** — photo-to-cards uploads will also persist a digital copy of source notes (image/PDF minimum; OCR'd searchable text as a stretch goal), linked to deck/class. Useful for tutor-mode RAG grounding. Deferred as an implementation, but must be accounted for in the initial data model (notes/documents entity from day one, storage layer that isn't text-only, OCR step kept modular so raw text output could be persisted later even if not wired up yet).

6. **Feedback mechanism** — lightweight, non-intrusive UI (corner icon/button, not a blocking modal) for friends to report bugs/malformed responses mid-session. Should auto-capture context (card ID, raw model output, timestamp) rather than relying on friend-written descriptions. Distinguish "wrong grade" (model judgment issue) from "malformed/crashed response" (pipeline robustness issue) as separate bug classes. Likely a simple `feedback` table in the same DB as other app data.

---

## Infrastructure / hardware split

- **Laptop (Ryzen AI 7 350, NPU, via FLM)** — repurposed as an always-on inference server for lightweight local jobs: answer grading model, possibly STT. Mostly idle already, so not a real tradeoff. Needs: disable sleep/lid-close suspend on AC power, remote reachability (Tailscale preferred over port-forwarding — matches self-hosted/auditable preference), auto-restart via systemd service rather than manual terminal sessions. Writeup deferred until build starts.

- **Desktop (RX 7600 XT 16GB, ROCm)** — handles GPU-dependent generative jobs: Chatterbox TTS (needs real GPU inference, not NPU/FLM-compatible) and any local LLM tier still needing GPU horsepower.

---

## TTS: Chatterbox

Selected after testing — voice cloning near-flawless from a short clip. Runs on desktop GPU. MIT licensed (Resemble AI). Reportedly beat ElevenLabs in blind listening tests (63.75% preference).

- Known limitation: ships with only one default voice per language (not a preset library like Kokoro's 54).
- Plan: source a curated bank of ~4-6 voices by cloning clean, public-domain/CC0 reference clips (e.g. LibriVox audiobook narrators) — not Adam's own voice — to avoid licensing issues while giving friends real voice choice.
- Wire these into a named-voice wrapper server (e.g. "Chatterbox TTS API" or similar community project supporting persistent named voice storage) so PipCards can reference voices by name.
- Kokoro-82M (Apache 2.0, 54 voices, lighter/faster) was considered and rejected on naturalness grounds.
- Voice cloning itself is not a required end-user feature — just the mechanism for building the preset voice bank.

---

## Local grading model

Originally considered a 12B dense model, then downsized to 7-8B (Qwen3 class) to save VRAM since the desktop also runs Chatterbox. Research indicates fine-tuned small/purpose-built models often beat general chat models zero-shot on short-answer grading.

Candidates surfaced:
- BERT-class classifiers (e.g. `khaled5321/ASAG`) — correct/incorrect/incomplete only, would need explanation bolted on separately.
- Short-Answer-Feedback (BART-SAF, HF org "Short-Answer-Feedback") — trained for score + written feedback together.
- **Prometheus 2** (`prometheus-eval` org) — preferred pick. Trained specifically to score a response against a reference answer + rubric, producing a likert-scale (1-5) score plus detailed feedback in one generation. 7B needs ~28GB VRAM in bf16 (GGUF quantized version exists: `prometheus-eval/prometheus-7b-v2.0-GGUF`). Prompt format requires 4 components: instruction, response to evaluate, reference answer, score rubric. Output format: `Feedback: ... [RESULT] (1-5)`.
- **`zli12321/prometheus2-2B`** — community distillation of prometheus-7b-v2.0 onto Gemma-2-2B-Instruct, same prompt/output format as the 7B, much lower VRAM. No published benchmarks vs. the 7B original — rubric adherence and partial-credit nuance (the hardest part of grading) are the capabilities most likely to degrade at smaller scale, unverified either way.

**Decision**: don't decide on priors — test the 2B against Adam's own tricky flashcard content (math notation equivalence, close-but-wrong phrasing) before committing. Fallback is the quantized official 7B GGUF if the 2B underperforms. **This testing has not been done yet.**

---

## Legal / hosting considerations

- **Google OAuth verification**: not a flat fee. Basic brand verification (name/logo) is free, ~2-3 business days, not mandatory unless wanting the logo displayed. Sensitive/restricted Drive scopes trigger real review; the costly tier is specifically CASA Tier 2 security audit (traditionally thousands of dollars; newer 2026 self-serve path ~$540-1,000), triggered by broad/restricted Drive scopes. **Action item**: check whether PipCards can use the narrower `drive.file` scope (app-created files only) to avoid CASA entirely. Apps under 100 test users on the external consent screen don't trigger verification yet, so not an immediate blocker at current friends-only scale.

- **Data storage / ToS**: not legally required to have a ToS for a local hobby project, but charging money (even at cost) starts resembling a service with consumer-protection expectations. Google's own policies require a published privacy policy for any app using Google user data — a hard requirement tied to OAuth, independent of Adam's own legal exposure. A basic ToS/privacy policy (free template, reviewed for accuracy rather than custom legal drafting) is a cheap way to cover both. (Not legal advice — caveated throughout.)

- Local-PC hosting raises practical uptime concerns (friends studying while Adam's PC is off/asleep) — mitigated by the laptop-as-server plan above.

---

## Frontend / UX direction

**Core strategy: progressive disclosure.** Keep the default surface small (today's reviews, streak/stats, deck list); push secondary features (voice mode, tutor mode, notes, feedback submission) one tap away rather than cluttering the main view. Feature-rich is compatible with feeling simple if most features are reachable-but-hidden rather than all visible at once.

- **Review screen (core loop) gets the least UI friction of anything in the app** — it's the most-used flow. One primary action per screen throughout the app generally.
- **Consistent visual language** (color/type/spacing) ties together review/voice/tutor modes despite their different interaction models.
- Full information architecture (screens, nav structure) not yet sketched — deferred until frontend build phase.

### Voice mode orb

Locked-in requirement: voice mode has a reactive AI "orb" UI that responds to speech (Siri/ChatGPT-voice-mode-style), with distinct states:
- **Idle** — gentle breathing, minimal glow
- **Listening** — reacts to real mic input amplitude
- **Thinking** — idle pulse during the STT → grading → TTS pipeline, no directional energy
- **Speaking** — reacts to TTS output amplitude

Technical approach: Web Audio API `AnalyserNode` for real-time frequency/amplitude data, driving a canvas-based visualization. Prioritize low-latency responsiveness over visual complexity, since it needs to run smoothly across friends' varied devices.

**Design chosen**: not the generic soft-gradient blob — a frequency-ring style visualization (concentric rings of particles reacting to frequency bands around a glowing core), closer to an oscilloscope/audio-engineering aesthetic. Currently tuned to 7 tightly-spaced rings for a denser, more textured look. A working HTML/JS reference prototype exists (see below) — built for frontend planning purposes only, not production scaffolding; don't over-engineer prototypes like this into real app code.

### Theming

- Dark + light mode across the **entire app, including voice mode** (not dark-only for voice mode).
- Accent color picker (general app).
- Separate color pickers specifically for the voice orb's listening / thinking / speaking states.

### Settings menu

Deliberately comprehensive, not a junk drawer — grouped so depth doesn't feel overwhelming:

- **Appearance** — theme, accent color, voice orb state colors, card review layout density
- **Study behavior** — FSRS parameters exposed behind an "advanced" toggle for power users, default review mode (typed/voice), new cards per day / session size, grading strictness
- **Voice & audio** — TTS voice selection, STT sensitivity / push-to-talk behavior, playback speed
- **Tutor mode** — personality presets + custom system prompt (see below)
- **Notifications** — reminder time, streak nagging, per-deck reminders
- **Data & account** — Drive sync status/manual sync, deck export (CSV/JSON), notes storage management
- **Account tier / billing** — current tier, usage this month (once metered billing exists)

### Tutor mode personality

- **Presets**: Strict Socratic (never gives the answer, only guides), Direct (explains freely), Encouraging (patient, good for frustration), Terse (minimal chat, just get through cards).
- **Custom option**: reveals an editable system prompt textarea.
- Presets and Custom share the same underlying mechanism — a preset is just a pre-filled version of the same editable prompt, not a separate code path. Simpler to build, and self-documenting for someone who wants to tweak a preset slightly instead of writing from scratch.
- A non-overridable base prompt layer sits underneath user customization (grounds the model in the user's actual card content, prevents the custom-prompt field from being used to jailbreak the tutor into behavior outside the app's intent). Guardrail specifics (character limit, exact base prompt contents, preview/test flow) deferred to build time.

---

## Reference prototype: voice orb (HTML/JS)

A working single-file HTML prototype was built during planning to align on the orb's look and feel before real implementation. Key characteristics:

- Canvas 2D (not WebGL/shaders) for simplicity and broad device performance.
- `AnalyserNode`-driven amplitude data — real mic input available via a toggle button (`getUserMedia`), with simulated band data as a fallback / for thinking & speaking states in the demo.
- 7 concentric particle rings, tightly spaced (8px apart), radius modulated per-band by amplitude.
- Manual state buttons (idle/listening/thinking/speaking) for previewing all four states without needing mic permission.
- Settings gear opens a small panel with a dark/light theme switch and three color pickers (listening/thinking/speaking), all live-updating the canvas.
- Explicitly a **reference/planning artifact**, not scaffolding to build the real app on top of — the real implementation should wire actual TTS output amplitude into the "speaking" state rather than the simulated pattern used here.

(The HTML file itself was shared separately as a downloadable artifact in the planning conversation — regenerate or request it directly if the actual file content is needed alongside this summary.)

---

## Open items / not yet done

- Test `zli12321/prometheus2-2B` (and fallback `prometheus-eval/prometheus-7b-v2.0-GGUF`) against tricky flashcard content (math notation equivalence, close-but-wrong phrasing) to finalize the grading model.
- Source and clone 4-6 public-domain reference voices (e.g. LibriVox) into a named-voice Chatterbox wrapper server.
- Write up the laptop-as-server doc (FLM service config, Tailscale/network setup, systemd auto-restart).
- Finalize DB/storage schema: notes/documents entity, `tier` field, `feedback` table.
- Confirm which Google Drive OAuth scope PipCards actually needs (`drive.file` vs. broader) to determine CASA audit exposure.
- Draft basic ToS/privacy policy once storage architecture (local vs. cloud DB) is finalized.
- Sketch full frontend information architecture (screens, nav structure).
- Flesh out tutor-mode base/non-overridable system prompt and custom-prompt guardrails (char limits, preview/test flow).
