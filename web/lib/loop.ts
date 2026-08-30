"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type NoteEvent = {
  beat: number;
  note: number;
  velocity?: number;
  durationBeats?: number;
};

export type Track = {
  label: string;
  program: number;
  channel: number;
  notes: NoteEvent[];
  startTime: number;
};

export type LoopState = {
  running: boolean;
  bpm: number;
  bars: number;
  beatsPerBar: number;
  tracks: Track[];
};

type Send = (bytes: number[], at?: number) => void;

const DEFAULT_STATE: LoopState = {
  running: false,
  bpm: 100,
  bars: 4,
  beatsPerBar: 4,
  tracks: [],
};

const LOOKAHEAD_MS = 120;
const TICK_MS = 25;

export function useLooper(send: Send) {
  const [state, setState] = useState<LoopState>(DEFAULT_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const loopStartRef = useRef(0);
  const scheduledUntilRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scheduleWindow = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    const now = performance.now();
    const scheduleTo = now + LOOKAHEAD_MS;
    const from = Math.max(scheduledUntilRef.current, now);
    if (from >= scheduleTo) return;

    const beatDur = 60000 / s.bpm;
    const loopDur = beatDur * s.beatsPerBar * s.bars;

    for (const t of s.tracks) {
      for (const n of t.notes) {
        const noteOffset = n.beat * beatDur;
        const firstAbs = t.startTime + noteOffset;
        let i = Math.max(0, Math.ceil((from - firstAbs) / loopDur));
        let absTime = firstAbs + i * loopDur;
        const vel = Math.max(1, Math.min(127, n.velocity ?? 100));
        const durMs = (n.durationBeats ?? 0.9) * beatDur;
        while (absTime < scheduleTo) {
          if (absTime >= from) {
            send([0x90 | (t.channel & 0x0f), n.note & 0x7f, vel], absTime);
            send([0x80 | (t.channel & 0x0f), n.note & 0x7f, 0], absTime + durMs);
          }
          i++;
          absTime = firstAbs + i * loopDur;
        }
      }
    }
    scheduledUntilRef.current = scheduleTo;
  }, [send]);

  useEffect(() => {
    if (!state.running) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(scheduleWindow, TICK_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state.running, scheduleWindow]);

  const panicAll = useCallback(() => {
    for (let ch = 0; ch < 16; ch++) {
      send([0xb0 | ch, 123, 0]);
      send([0xb0 | ch, 120, 0]);
    }
  }, [send]);

  const startLoop = useCallback(
    (bpm?: number, bars?: number) => {
      const now = performance.now();
      loopStartRef.current = now;
      scheduledUntilRef.current = now;
      setState((s) => ({
        ...s,
        running: true,
        bpm: bpm ?? s.bpm,
        bars: bars ?? s.bars,
        tracks: s.tracks.map((t) => ({ ...t, startTime: now })),
      }));
    },
    []
  );

  const stopLoop = useCallback(() => {
    setState((s) => ({ ...s, running: false }));
    setTimeout(panicAll, 30);
  }, [panicAll]);

  const clearTracks = useCallback(() => {
    setTimeout(panicAll, 0);
    setState((s) => ({ ...s, tracks: [] }));
  }, [panicAll]);

  const findFreeChannel = useCallback((used: number[]) => {
    for (let ch = 0; ch < 16; ch++) {
      if (ch === 9) continue; // reserve GM drums channel
      if (!used.includes(ch)) return ch;
    }
    return 0;
  }, []);

  const addTrack = useCallback(
    (label: string, program: number, notes: NoteEvent[]) => {
      setState((s) => {
        const existing = s.tracks.find((t) => t.label === label);
        const channel =
          existing?.channel ??
          findFreeChannel(s.tracks.map((t) => t.channel));
        send([0xc0 | (channel & 0x0f), program & 0x7f]);
        const startTime = s.running
          ? performance.now()
          : loopStartRef.current || performance.now();
        const track: Track = { label, program, channel, notes, startTime };
        const next = existing
          ? s.tracks.map((t) => (t.label === label ? track : t))
          : [...s.tracks, track];
        return { ...s, tracks: next };
      });
    },
    [send, findFreeChannel]
  );

  const removeTrack = useCallback(
    (label: string) => {
      let removedCh: number | null = null;
      setState((s) => {
        const t = s.tracks.find((x) => x.label === label);
        if (!t) return s;
        removedCh = t.channel;
        return { ...s, tracks: s.tracks.filter((x) => x.label !== label) };
      });
      setTimeout(() => {
        if (removedCh === null) return;
        send([0xb0 | (removedCh & 0x0f), 123, 0]);
      }, 0);
    },
    [send]
  );

  const setBpm = useCallback((bpm: number) => {
    setState((s) => ({ ...s, bpm }));
  }, []);

  return {
    state,
    startLoop,
    stopLoop,
    clearTracks,
    addTrack,
    removeTrack,
    setBpm,
  };
}
