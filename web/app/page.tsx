"use client";

import { useCallback, useRef, useState } from "react";
import { useJunoMidi, type MidiAction } from "@/lib/midi";
import { useLooper } from "@/lib/loop";
import { useSpeech } from "@/lib/speech";

const CHORDS: { label: string; notes: number[] }[] = [
  { label: "C", notes: [60, 64, 67] },
  { label: "Dm", notes: [62, 65, 69] },
  { label: "Em", notes: [64, 67, 71] },
  { label: "F", notes: [65, 69, 72] },
  { label: "G", notes: [67, 71, 74] },
  { label: "Am", notes: [69, 72, 76] },
  { label: "Cmaj7", notes: [60, 64, 67, 71] },
  { label: "Dm7", notes: [62, 65, 69, 72] },
];

type LogEntry = { at: number; text: string };

export default function Page() {
  const midi = useJunoMidi();
  const loop = useLooper(midi.send);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  const [log, setLog] = useState<LogEntry[]>([]);
  const [cutoff, setCutoff] = useState(90);
  const [reverb, setReverb] = useState(40);
  const [patch, setPatch] = useState(0);
  const [thinking, setThinking] = useState(false);

  const pushLog = (text: string) =>
    setLog((l) => [{ at: Date.now(), text }, ...l].slice(0, 40));

  const runActions = (actions: { name: string; input: any }[]) => {
    for (const a of actions) {
      pushLog(`▶ ${a.name} ${JSON.stringify(a.input)}`);
      switch (a.name) {
        case "start_loop":
          loopRef.current.startLoop(a.input.bpm, a.input.bars);
          break;
        case "stop_loop":
          loopRef.current.stopLoop();
          break;
        case "add_track":
          loopRef.current.addTrack(
            a.input.label,
            a.input.program,
            a.input.notes ?? []
          );
          break;
        case "remove_track":
          loopRef.current.removeTrack(a.input.label);
          break;
        case "clear_tracks":
          loopRef.current.clearTracks();
          break;
        default: {
          const act = toMidiAction(a);
          if (act) midi.execute(act);
        }
      }
    }
  };

  const handleFinalTranscript = useCallback(
    async (transcript: string) => {
      pushLog(`"${transcript}"`);
      setThinking(true);
      try {
        const res = await fetch("/api/interpret", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript, state: loopRef.current.state }),
        });
        const data = await res.json();
        if (data.error) {
          pushLog(`✗ ${data.error}`);
        } else {
          runActions(data.actions ?? []);
        }
      } catch (e: any) {
        pushLog(`✗ ${e?.message ?? String(e)}`);
      } finally {
        setThinking(false);
      }
    },
    [midi]
  );

  const speech = useSpeech(handleFinalTranscript);

  const playChord = (notes: number[], label: string) => {
    midi.execute({ type: "chord", notes, durationMs: 1200 });
    pushLog(`▶ chord ${label}`);
  };

  const setCutoffCC = (v: number) => {
    setCutoff(v);
    midi.execute({ type: "cc", controller: 74, value: v });
  };
  const setReverbCC = (v: number) => {
    setReverb(v);
    midi.execute({ type: "cc", controller: 91, value: v });
  };
  const changePatch = (delta: number) => {
    const next = Math.max(0, Math.min(127, patch + delta));
    setPatch(next);
    midi.execute({ type: "program", program: next });
    pushLog(`▶ patch ${next}`);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-light tracking-tight">juno voice</h1>
          <div className="text-sm font-light">
            {midi.error ? (
              <span className="text-red-400">{midi.error}</span>
            ) : midi.ready ? (
              <span className="text-neutral-300">connected</span>
            ) : (
              <span className="text-neutral-500">connecting MIDI…</span>
            )}
          </div>
        </header>

        <section className="p-6 flex flex-col items-center gap-3">
          <button
            onMouseDown={speech.start}
            onMouseUp={speech.stop}
            onTouchStart={speech.start}
            onTouchEnd={speech.stop}
            disabled={!speech.supported}
            className={`w-32 h-32 rounded-full text-lg font-light transition-all select-none
              ${speech.listening ? "bg-red-500 scale-105 shadow-lg shadow-red-500/50" : "bg-neutral-700 hover:bg-neutral-600"}
              ${!speech.supported ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
          >
            {speech.listening ? "listening…" : thinking ? "thinking…" : "hold to talk"}
          </button>
          <div className="h-6 text-sm text-neutral-400 font-light">
            {speech.interim || (speech.supported ? "" : "Web Speech not supported in this browser")}
          </div>
        </section>

        <section className="p-4">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500 mb-2 font-light">log</h2>
          <div className="text-lg space-y-2 max-h-96 overflow-auto font-light">
            {log.length === 0 && <div className="text-neutral-600">nothing yet</div>}
            {log.map((e, i) => (
              <div key={i} className="text-neutral-300">
                {e.text}
              </div>
            ))}
          </div>
        </section>

        <section className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-widest text-neutral-500 font-light">
              loop {loop.state.running ? "running" : "stopped"}  {loop.state.bpm} bpm  {loop.state.bars} bars
            </h2>
            <div className="flex gap-2">
              {loop.state.running ? (
                <button
                  onClick={() => loop.stopLoop()}
                  className="rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3 py-1 text-sm font-light"
                >
                  stop
                </button>
              ) : (
                <button
                  onClick={() => loop.startLoop()}
                  className="rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3 py-1 text-sm font-light"
                >
                  start
                </button>
              )}
              <button
                onClick={() => loop.clearTracks()}
                disabled={loop.state.tracks.length === 0}
                className="rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3 py-1 text-sm font-light disabled:opacity-40"
              >
                clear
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {loop.state.tracks.length === 0 && (
              <div className="text-neutral-600 text-sm font-light">no tracks. say &ldquo;add a wind instrument&rdquo;</div>
            )}
            {loop.state.tracks.map((t) => (
              <div
                key={t.label}
                className="flex items-center justify-between py-2 border-b border-neutral-900"
              >
                <div className="font-light">
                  <span className="text-neutral-200">{t.label}</span>
                  <span className="text-neutral-500 text-sm ml-2">
                    prog {t.program} · ch {t.channel + 1} · {t.notes.length} notes
                  </span>
                </div>
                <button
                  onClick={() => loop.removeTrack(t.label)}
                  className="text-sm text-neutral-500 hover:text-neutral-300 font-light"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="p-6 space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500 font-light">chords</h2>
          <div className="grid grid-cols-4 gap-2">
            {CHORDS.map((c) => (
              <button
                key={c.label}
                onClick={() => playChord(c.notes, c.label)}
                disabled={!midi.ready}
                className="rounded-xl bg-neutral-800 hover:bg-neutral-700 py-4 text-lg font-light disabled:opacity-40"
              >
                {c.label}
              </button>
            ))}
          </div>
        </section>

        <section className="p-6 grid grid-cols-2 gap-6">
          <div>
            <label className="text-sm text-neutral-400 font-light">filter cutoff (CC74) {cutoff}</label>
            <input
              type="range"
              min={0}
              max={127}
              value={cutoff}
              onChange={(e) => setCutoffCC(Number(e.target.value))}
              className="w-full mt-2 accent-neutral-400"
            />
          </div>
          <div>
            <label className="text-sm text-neutral-400 font-light">reverb (CC91) {reverb}</label>
            <input
              type="range"
              min={0}
              max={127}
              value={reverb}
              onChange={(e) => setReverbCC(Number(e.target.value))}
              className="w-full mt-2 accent-neutral-400"
            />
          </div>
        </section>

        <section className="p-6 flex items-center gap-3">
          <button
            onClick={() => changePatch(-1)}
            disabled={!midi.ready}
            className="rounded-xl bg-neutral-800 hover:bg-neutral-700 px-4 py-2 font-light disabled:opacity-40"
          >
            ◀ patch
          </button>
          <div className="text-lg tabular-nums w-16 text-center font-light">{patch}</div>
          <button
            onClick={() => changePatch(1)}
            disabled={!midi.ready}
            className="rounded-xl bg-neutral-800 hover:bg-neutral-700 px-4 py-2 font-light disabled:opacity-40"
          >
            patch ▶
          </button>
          <div className="flex-1" />
          <button
            onClick={() => {
              loop.stopLoop();
              midi.execute({ type: "panic" });
              pushLog("▶ panic");
            }}
            className="rounded-xl bg-neutral-800 hover:bg-neutral-700 px-4 py-2 font-light"
          >
            panic
          </button>
        </section>
      </div>
    </main>
  );
}

function toMidiAction(a: { name: string; input: any }): MidiAction | null {
  switch (a.name) {
    case "play_note":
      return {
        type: "note",
        note: a.input.note,
        velocity: a.input.velocity,
        durationMs: a.input.durationMs,
      };
    case "play_chord":
      return {
        type: "chord",
        notes: a.input.notes,
        velocity: a.input.velocity,
        durationMs: a.input.durationMs,
      };
    case "play_sequence":
      return {
        type: "sequence",
        notes: a.input.notes,
        bpm: a.input.bpm ?? 120,
        velocity: a.input.velocity,
      };
    case "set_cc":
      return { type: "cc", controller: a.input.controller, value: a.input.value };
    case "program_change":
      return { type: "program", program: a.input.program, bank: a.input.bank };
    case "panic":
      return { type: "panic" };
    default:
      return null;
  }
}
