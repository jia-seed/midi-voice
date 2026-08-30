# midi voice
i rewrote this thing personally for best understanding so you can enjoy me rattling off. 

this is a way to interface by voice with midis. i was sick and tired of having to watch youtube videos on how to do loops on my juno-d8 when i should just be able to talk to it and it does my bidding. 

#first off, hacking into the thing and running a python script to play a note
<img width="1273" height="473" alt="Screenshot 2026-08-30 at 9 32 47 am" src="https://github.com/user-attachments/assets/c2cade97-b543-4b01-877a-25cd9b132969" />



Voice-controlled Roland JUNO-D from a browser. Hold a mic button, speak, and Claude drives the synth over MIDI. Includes a live looper for layering complementary parts.

## What it does

- Push-to-talk mic in the browser. Speech goes through Web Speech API, transcript goes to Claude, Claude returns MIDI tool calls.
- Tool calls run over the Web MIDI API, out USB to the JUNO-D.
- A live looper with a shared clock. Say "start a loop", then "add a bass line", then "add a wind instrument". Claude picks a General MIDI program and composes a pattern that fits what is already playing.
- Manual controls too: chord pads, filter cutoff, reverb, patch select, panic.

## Stack

- Next.js 16 (App Router, Turbopack) for the web app.
- Web MIDI API in the browser. No local bridge, no daemons.
- Web Speech API for transcription. No STT server.
- Anthropic Claude (Sonnet 4.6) for interpretation, via tool use.
- Runs entirely on `localhost`. Only external call is the Anthropic API.

## Requirements

- macOS or Linux with a USB MIDI class compliant synth (tested on Roland JUNO-D).
- Chromium browser (Chrome, Edge, Arc, Brave). Safari and Firefox on macOS do not have Web MIDI.
- Node 20+.
- Anthropic API key.

## Setup

```bash
git clone https://github.com/jia-seed/juno.git
cd juno/web
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local
npm run dev
```

Open the printed URL (usually `http://localhost:3001`) in a Chromium browser. Approve the MIDI and microphone prompts. The header should read "connected".

Plug the JUNO-D in over USB before loading the page. If the synth was in a mode that ignores external MIDI (for example the JUNO-D "waiting for MainStage" screen), press EXIT or a tone button until a normal patch shows.

## How it was built

The whole thing is four files.

**`web/lib/midi.ts`** wraps Web MIDI. It picks the first output containing "JUNO" in its name, exposes primitives (`noteOn`, `cc`, `program`, `panic`), and an `execute(action)` dispatcher for one-shot notes, chords, and sequences. Scheduled sends use `MIDIOutput.send(bytes, timestamp)` so timing is precise even when the JS thread hiccups.

**`web/lib/speech.ts`** wraps the browser's Web Speech API as a push-to-talk hook. `start()` on mousedown, `stop()` on mouseup, final transcript triggers a callback.

**`web/lib/loop.ts`** is the looper. It holds shared state (bpm, bars, tracks) and runs a lookahead scheduler on a 25 ms interval. Each tick, it schedules any note events falling in the next 120 ms window using precise timestamps. Tracks are assigned to fresh MIDI channels (skipping channel 10, the GM drums slot). Adding a track sends a program change on its channel before the first note.

**`web/app/api/interpret/route.ts`** is the Claude call. It defines the tool set (`start_loop`, `stop_loop`, `add_track`, `remove_track`, `clear_tracks`, plus one-shot `play_note`, `play_chord`, `play_sequence`, `set_cc`, `program_change`, `panic`) and passes the current loop state into the system prompt so Claude can compose parts that complement what is already playing. Tool calls come back as JSON and the frontend dispatches them.

**`web/app/page.tsx`** wires it together. Push-to-talk mic, log panel, live track list, chord pads, cutoff and reverb sliders, patch selector, panic.

## Example voice commands

- "start a loop at 100 bpm for 4 bars"
- "add a bass line in c minor"
- "add a wind instrument"
- "add pads that fit"
- "remove the bass"
- "arpeggiate a c major chord for 4 measures"
- "make it darker" (drops CC74 filter cutoff)
- "more reverb"
- "switch to a pad patch"
- "panic" (all notes off)

Claude sees the current tracks each turn, so "add a wind instrument" produces a flute or clarinet line in a register above the bass, in the same key.

## Multi timbral note

Layered tracks are sent on separate MIDI channels with a program change per channel. Whether they sound with different timbres depends on the synth. The JUNO-D plays external MIDI on its currently selected patch by default. To get true multi timbral layers, enable GM mode on the synth so each channel takes its own patch.

## Limits

- Monophonic per track. `play_sequence` and `add_track` patterns play one note at a time per track. Chords need multiple tracks or the `play_chord` one-shot.
- No swing, no rests as first class values. Rhythm is expressed as beat offsets and durations, so anything can be written but the model has to spell it out.
- Chrome throttles the scheduler when the tab is backgrounded. Scheduled events already queued fire fine, but new events may pile up.
- Web Speech transcription quality is decent for musical phrases but can mishear proper nouns or fast speech. Swap in Whisper for better accuracy.

## Layout

```
juno/
  .venv/           optional Python venv for direct mido tests
  web/             the Next.js app
    app/
    lib/
    .env.local     ANTHROPIC_API_KEY, gitignored
```
