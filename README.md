# midi voice
i'm rewriting this thing personally for best understanding.

this is a way to interface by voice with midis. i was sick and tired of having to watch youtube videos on how to do loops on my juno-d8 when i should just be able to talk to it and it does my bidding. so this thing allows you to use a mic button to speak and drive the synth over midi. also sonnet 4.6 is used as an interpreter so that it can take your voice commands and layer them into complementary parts.

the stack:

- next.js 16 (app router, turbopack) for the web app.
- web midi api in the browser. no local bridge or daemons.
- web speech api for transcription. no stt server.
- sonnet 4.6 for interpretation via tool use.
- runs entirely on `localhost`. only external call is the anthropic api.

1. first off, hacking into the thing and running a python script to play a note

<img width="1277" height="208" alt="Screenshot 2026-08-30 at 9 33 47 am" src="https://github.com/user-attachments/assets/814c660d-552e-4d9f-9589-122cd55ca129" />

here's the video of it playing one note. 

https://github.com/user-attachments/assets/1ff2b43a-0334-435d-8a5d-74c8877e0716

``` import mido, time                                             
  port = mido.open_output('JUNO-D MIDI IN1')
  for n in (60, 64, 67): port.send(mido.Message('note_on', note=n,
  velocity=100))                                                
  time.sleep(1.2)                                               
  for n in (60, 64, 67): port.send(mido.Message('note_off', note=n))
```

2. next

* push-to-talk mic in the browser. speech goes through web speech api, transcript goes to claude, claude returns midi tool calls.
* tool calls run over the web midi api, out usb to the juno-d.
* a live looper with a shared clock. say "start a loop", then "add a bass line", then "add a wind instrument". claude picks a general midi program and composes a pattern that fits what is already playing.
* manual controls too: chord pads, filter cutoff, reverb, patch select, panic.

## requirements

* macos or linux with a usb midi class compliant synth (tested on roland juno-d).
* chromium browser (chrome, edge, arc, brave). safari and firefox on macos do not have web midi.
* node 20+.
* anthropic api key.

## setup

```bash
git clone https://github.com/jia-seed/juno.git
cd juno/web
npm install
echo 'anthropic_api_key=sk-ant-...' > .env.local
npm run dev
```

open the printed url (usually `http://localhost:3001`) in a chromium browser. approve the midi and microphone prompts. the header should read "connected".

plug the juno-d in over usb before loading the page. if the synth was in a mode that ignores external midi (for example the juno-d "waiting for mainstage" screen), press exit or a tone button until a normal patch shows.

<img width="613" height="442" alt="screenshot 2026-08-30 at 10 30 31 am" src="https://github.com/user-attachments/assets/2bdab6a5-df8d-475b-b4dc-0b90aac7d9b5" />

the whole thing is really just four files.

**`web/lib/midi.ts`** wraps web midi. it picks the first output containing "juno" in its name, exposes primitives (`noteon`, `cc`, `program`, `panic`), and an `execute(action)` dispatcher for one-shot notes, chords, and sequences. scheduled sends use `midioutput.send(bytes, timestamp)` so timing is precise even when the js thread hiccups.

**`web/lib/speech.ts`** wraps the browser's web speech api as a push-to-talk hook. `start()` on mousedown, `stop()` on mouseup, final transcript triggers a callback.

**`web/lib/loop.ts`** is the looper. it holds shared state (bpm, bars, tracks) and runs a lookahead scheduler on a 25 ms interval. each tick, it schedules any note events falling in the next 120 ms window using precise timestamps. tracks are assigned to fresh midi channels (skipping channel 10, the gm drums slot). adding a track sends a program change on its channel before the first note.

**`web/app/api/interpret/route.ts`** is the claude call. it defines the tool set (`start_loop`, `stop_loop`, `add_track`, `remove_track`, `clear_tracks`, plus one-shot `play_note`, `play_chord`, `play_sequence`, `set_cc`, `program_change`, `panic`) and passes the current loop state into the system prompt so claude can compose parts that complement what is already playing. tool calls come back as json and the frontend dispatches them.

**`web/app/page.tsx`** wires it together. push-to-talk mic, log panel, live track list, chord pads, cutoff and reverb sliders, patch selector, panic.

full video:

<a href="https://youtu.be/mGpyjZH0fP0">
  <img
    src="https://img.youtube.com/vi/mGpyjZH0fP0/maxresdefault.jpg"
    alt="watch the juno voice-controlled midi demo"
    width="700"
  />
</a>

## example voice commands

* "start a loop at 100 bpm for 4 bars"
* "add a bass line in c minor"
* "add a wind instrument"
* "add pads that fit"
* "remove the bass"
* "arpeggiate a c major chord for 4 measures"
* "make it darker" (drops cc74 filter cutoff)
* "more reverb"
* "switch to a pad patch"
* "panic" (all notes off)

it sees the current tracks each turn, so "add a wind instrument" produces a flute or clarinet line in a register above the bass, in the same key.

## multi timbral note

layered tracks are sent on separate midi channels with a program change per channel. whether they sound with different timbres depends on the synth. the juno-d plays external midi on its currently selected patch by default. to get true multi timbral layers, enable gm mode on the synth so each channel takes its own patch.

## limits

* monophonic per track. `play_sequence` and `add_track` patterns play one note at a time per track. chords need multiple tracks or the `play_chord` one-shot.
* no swing, no rests as first class values. rhythm is expressed as beat offsets and durations, so anything can be written but the model has to spell it out.
* chrome throttles the scheduler when the tab is backgrounded. scheduled events already queued fire fine, but new events may pile up.
* web speech transcription quality is decent for musical phrases but can mishear proper nouns or fast speech. swap in whisper for better accuracy.

## layout

```text
juno/
  .venv/           optional python venv for direct mido tests
  web/             the next.js app
    app/
    lib/
    .env.local     anthropic_api_key, gitignored
```
