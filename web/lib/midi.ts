"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MidiAction =
  | { type: "note"; note: number; velocity?: number; durationMs?: number }
  | { type: "chord"; notes: number[]; velocity?: number; durationMs?: number }
  | { type: "sequence"; notes: number[]; bpm: number; velocity?: number; noteLen?: number }
  | { type: "cc"; controller: number; value: number }
  | { type: "program"; program: number; bank?: number }
  | { type: "panic" };

const DEVICE_HINT = "JUNO";

export function useJunoMidi() {
  const [ready, setReady] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<MIDIOutput | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      setError("Web MIDI not supported. Use Chrome, Edge, or Arc.");
      return;
    }
    let access: MIDIAccess | null = null;
    const pick = () => {
      if (!access) return;
      let chosen: MIDIOutput | null = null;
      for (const out of access.outputs.values()) {
        if (out.name?.toUpperCase().includes(DEVICE_HINT)) {
          chosen = out;
          break;
        }
      }
      if (!chosen) {
        for (const out of access.outputs.values()) {
          chosen = out;
          break;
        }
      }
      outputRef.current = chosen;
      setDeviceName(chosen?.name ?? null);
      setReady(!!chosen);
    };
    navigator.requestMIDIAccess({ sysex: false }).then(
      (a) => {
        access = a;
        pick();
        a.onstatechange = pick;
      },
      (e) => setError(String(e))
    );
  }, []);

  const send = useCallback((bytes: number[], atMs?: number) => {
    const o = outputRef.current;
    if (!o) return;
    o.send(bytes, atMs);
  }, []);

  function noteOn(note: number, velocity = 100, at?: number) {
    send([0x90, note & 0x7f, velocity & 0x7f], at);
  }
  function noteOff(note: number, at?: number) {
    send([0x80, note & 0x7f, 0], at);
  }
  function cc(controller: number, value: number) {
    send([0xb0, controller & 0x7f, value & 0x7f]);
  }
  function program(program: number, bank?: number) {
    if (bank !== undefined) {
      send([0xb0, 0, (bank >> 7) & 0x7f]);
      send([0xb0, 32, bank & 0x7f]);
    }
    send([0xc0, program & 0x7f]);
  }
  function panic() {
    for (let ch = 0; ch < 16; ch++) {
      send([0xb0 | ch, 123, 0]);
      send([0xb0 | ch, 120, 0]);
    }
  }

  function execute(action: MidiAction) {
    const now = performance.now();
    switch (action.type) {
      case "note": {
        const vel = action.velocity ?? 100;
        const dur = action.durationMs ?? 400;
        noteOn(action.note, vel);
        send([0x80, action.note & 0x7f, 0], now + dur);
        break;
      }
      case "chord": {
        const vel = action.velocity ?? 90;
        const dur = action.durationMs ?? 1200;
        for (const n of action.notes) noteOn(n, vel);
        for (const n of action.notes) send([0x80, n & 0x7f, 0], now + dur);
        break;
      }
      case "sequence": {
        const vel = action.velocity ?? 100;
        const stepMs = (60 / action.bpm) * 1000;
        const noteLen = action.noteLen ?? stepMs * 0.9;
        action.notes.forEach((n, i) => {
          const t = now + i * stepMs;
          send([0x90, n & 0x7f, vel], t);
          send([0x80, n & 0x7f, 0], t + noteLen);
        });
        break;
      }
      case "cc":
        cc(action.controller, action.value);
        break;
      case "program":
        program(action.program, action.bank);
        break;
      case "panic":
        panic();
        break;
    }
  }

  return { ready, deviceName, error, execute, send, noteOn, noteOff, cc, program, panic };
}
