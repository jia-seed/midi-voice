import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
  {
    name: "start_loop",
    description:
      "Start (or restart) the master loop clock. All tracks play in a repeating cycle of `bars` bars in 4/4.",
    input_schema: {
      type: "object",
      properties: {
        bpm: { type: "number", description: "tempo in beats per minute, default 100" },
        bars: { type: "number", description: "loop length in bars (4/4), default 4" },
      },
    },
  },
  {
    name: "stop_loop",
    description: "Stop the loop and silence all track playback.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_track",
    description:
      "Add or replace a layered instrument track in the loop. Provide a General MIDI program number and a pattern of notes keyed by beat offset from loop start (beat 0 = downbeat). If a track with the same label exists, it is replaced. If the loop is not running, the track is queued but silent until start_loop is called.",
    input_schema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description:
            "short identifier for this layer, e.g. 'bass', 'wind lead', 'pad', 'arp'",
        },
        program: {
          type: "number",
          description:
            "General MIDI program 0-127. Winds: 71 clarinet, 73 flute, 74 recorder, 75 pan flute, 68 oboe, 65 alto sax, 66 tenor sax, 60 french horn, 56 trumpet. Strings: 40 violin, 42 cello, 48 strings ensemble. Bass: 32 acoustic bass, 33 fingered bass, 34 pick bass, 38 synth bass. Keys: 0 grand piano, 4 electric piano, 16 organ. Pads: 88-95 various pads. Drums use channel 10 automatically in GM.",
        },
        notes: {
          type: "array",
          description: "list of note events for one loop cycle",
          items: {
            type: "object",
            properties: {
              beat: { type: "number", description: "fractional beat offset from loop start" },
              note: { type: "number", description: "MIDI note number, middle C = 60" },
              velocity: { type: "number", description: "1-127, default 100" },
              durationBeats: {
                type: "number",
                description: "note length in beats, default 0.9",
              },
            },
            required: ["beat", "note"],
          },
        },
      },
      required: ["label", "program", "notes"],
    },
  },
  {
    name: "remove_track",
    description: "Remove a track by label.",
    input_schema: {
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
    },
  },
  {
    name: "clear_tracks",
    description: "Remove all tracks from the loop.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "play_note",
    description: "Play a single one-shot MIDI note over the loop. Middle C = 60.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "number" },
        velocity: { type: "number" },
        durationMs: { type: "number", description: "default 400" },
      },
      required: ["note"],
    },
  },
  {
    name: "play_chord",
    description: "Play a one-shot chord over the loop.",
    input_schema: {
      type: "object",
      properties: {
        notes: { type: "array", items: { type: "number" } },
        velocity: { type: "number" },
        durationMs: { type: "number", description: "default 1200" },
      },
      required: ["notes"],
    },
  },
  {
    name: "play_sequence",
    description: "Play a one-shot monophonic sequence over the loop.",
    input_schema: {
      type: "object",
      properties: {
        notes: { type: "array", items: { type: "number" } },
        bpm: { type: "number" },
        velocity: { type: "number" },
      },
      required: ["notes"],
    },
  },
  {
    name: "set_cc",
    description:
      "Send a MIDI Control Change on channel 1. Common CCs: 1=mod, 7=volume, 10=pan, 71=resonance, 74=cutoff, 91=reverb, 93=chorus.",
    input_schema: {
      type: "object",
      properties: {
        controller: { type: "number" },
        value: { type: "number" },
      },
      required: ["controller", "value"],
    },
  },
  {
    name: "program_change",
    description: "Change the patch on the main channel (channel 1). Does not affect tracks.",
    input_schema: {
      type: "object",
      properties: { program: { type: "number" }, bank: { type: "number" } },
      required: ["program"],
    },
  },
  {
    name: "panic",
    description: "All notes off across all channels.",
    input_schema: { type: "object", properties: {} },
  },
];

const SYSTEM = `You control a Roland JUNO-D synthesizer and a live looper via MIDI tools.

Concepts
- The looper has a master clock (bpm + bars, always 4/4). When running, every track's note pattern repeats each loop cycle.
- Each track is a labeled instrument with a General MIDI program number and a list of note events keyed by beat offset (beat 0 = downbeat of loop).
- Adding a track with an existing label REPLACES that track.
- One-shot play_note/play_chord/play_sequence tools layer freely over the loop.

How to interpret user requests
- "start a loop" / "start the loop" → call start_loop (choose bpm+bars if not specified; 100 bpm x 4 bars is a good default).
- "stop the loop" / "stop everything" → call stop_loop.
- "add a wind instrument" / "add strings" / "add bass" → call add_track. Pick a fitting GM program. If tracks already exist, compose a COMPLEMENTARY pattern in the same key/scale that does not clash rhythmically or harmonically with what's playing. Prefer a different register and complementary rhythm (e.g. if the existing track is a driving bassline, add a slower melodic wind line above it).
- If the user specifies notes/rhythm, follow them exactly. Otherwise, make a musical choice without asking.
- Tone/patch changes → set_cc / program_change (affects the main patch, not tracks).
- If the user says "add" without specifying the loop is running, still add the track. The user can start the loop separately.

Ranges & voicing rules
- Bass: MIDI 28–48 (E1–C3). Sparse rhythm, root/fifth motion.
- Chord/pad tracks: MIDI 48–72 (C3–C5). Sustained, half or whole notes.
- Lead / wind: MIDI 60–84 (C4–C6). Melodic, more rhythmic variety.
- Do not exceed velocity 110 for pads/bass; leads can peak higher.

You will be given the current loop state. Use it to make musically informed choices. Respond with tool calls only; no chatter.`;

export async function POST(req: NextRequest) {
  try {
    const { transcript, state } = await req.json();
    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json({ error: "missing transcript" }, { status: 400 });
    }
    const stateSummary = state
      ? `Current loop state:
- running: ${state.running}
- bpm: ${state.bpm}
- bars: ${state.bars}
- tracks (${state.tracks?.length ?? 0}):
${
  (state.tracks ?? [])
    .map(
      (t: any) =>
        `  • "${t.label}" program=${t.program} channel=${t.channel + 1} notes=${JSON.stringify(t.notes)}`
    )
    .join("\n") || "  (none)"
}`
      : "No loop state provided.";

    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM,
      tools,
      messages: [
        {
          role: "user",
          content: `${stateSummary}\n\nUser said: "${transcript}"`,
        },
      ],
    });
    const actions: any[] = [];
    for (const block of msg.content) {
      if (block.type === "tool_use") {
        actions.push({ name: block.name, input: block.input });
      }
    }
    return NextResponse.json({ transcript, actions, stop_reason: msg.stop_reason });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
