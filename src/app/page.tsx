"use client";

import { useRef, useState } from "react";
import styles from "./page.module.css";
import * as Tone from "tone";
import { Chord, Note } from "@tonaljs/tonal";

type SequenceEvent = {
  durationBeats: number;
  notes: string[] | null;
};

function toPlayableChord(chordSymbol: string): string[] {
  const trimmed = chordSymbol.trim();
  const match = /^(.*?)(?:@(-?\d+))?$/.exec(trimmed);
  if (!match) return [];

  const symbol = match[1].trim();
  const baseOctave = match[2] ? Number.parseInt(match[2], 10) : 4;
  if (!symbol || !Number.isFinite(baseOctave)) return [];

  const chord = Chord.get(symbol);
  if (!chord || chord.empty || chord.notes.length === 0) return [];

  let previousMidi = -Infinity;
  return chord.notes.map((pitchClass) => {
    const simplifiedPitch = Note.simplify(pitchClass) || pitchClass;
    let octave = baseOctave;
    let note = `${simplifiedPitch}${octave}`;
    let midi = Tone.Frequency(note).toMidi();
    while (midi <= previousMidi) {
      octave += 1;
      note = `${simplifiedPitch}${octave}`;
      midi = Tone.Frequency(note).toMidi();
    }
    previousMidi = midi;
    return note;
  });
}

function parseEventToken(token: string, defaultBeats: number): SequenceEvent | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const match = /^(.*?)(?:\*(\d*\.?\d+))?$/.exec(trimmed);
  if (!match) return null;

  const eventSymbol = match[1].trim();
  const durationBeats = match[2] ? Number.parseFloat(match[2]) : defaultBeats;

  if (!Number.isFinite(durationBeats) || durationBeats <= 0 || !eventSymbol) return null;

  if (/^(r|rest)$/i.test(eventSymbol)) {
    return { durationBeats, notes: null };
  }

  const notes = toPlayableChord(eventSymbol);
  if (notes.length === 0) return null;

  return { durationBeats, notes };
}

export default function Home() {
  const [progression, setProgression] = useState("Cmaj7@3*2, R*1, Dm7@3, G7*0.5, Cmaj7");
  const [bpmInput, setBpmInput] = useState("120");
  const [beatsInput, setBeatsInput] = useState("2");
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");
  const synthRef = useRef<Tone.PolySynth | null>(null);

  const getSynth = () => {
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: {
          attack: 0.005,
          decay: 0.15,
          sustain: 0.25,
          release: 1.2,
        },
      }).toDestination();
      synthRef.current.volume.value = -8;
    }
    return synthRef.current;
  };

  const handlePlay = async () => {
    if (isPlaying) return;

    const bpm = Number.parseFloat(bpmInput);
    const defaultBeats = Number.parseFloat(beatsInput);
    if (!Number.isFinite(bpm) || bpm <= 0) {
      setError("BPM must be a positive number.");
      return;
    }
    if (!Number.isFinite(defaultBeats) || defaultBeats <= 0) {
      setError("Default chord length must be a positive number of beats.");
      return;
    }

    const events = progression
      .split(",")
      .map((item) => parseEventToken(item, defaultBeats))
      .filter((item): item is SequenceEvent => Boolean(item));

    if (events.length === 0) {
      setError("Use tokens like Cmaj7@3*2, R*1, Dm7, G7*0.5.");
      return;
    }

    setError("");
    setIsPlaying(true);

    await Tone.start();
    const synth = getSynth();
    const secondsPerBeat = 60 / bpm;
    const startTime = Tone.now() + 0.05;
    let cursorTime = startTime;
    let totalDurationSeconds = 0;

    events.forEach((event) => {
      const eventDurationSeconds = event.durationBeats * secondsPerBeat;
      if (event.notes) {
        synth.triggerAttackRelease(event.notes, eventDurationSeconds * 0.9, cursorTime);
      }
      cursorTime += eventDurationSeconds;
      totalDurationSeconds += eventDurationSeconds;
    });

    window.setTimeout(() => {
      setIsPlaying(false);
    }, totalDurationSeconds * 1000 + 120);
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <h1>Achording</h1>
          <p>
            Type{" "}
            <a
              href="https://tonaljs.github.io/tonal/docs/groups/chords"
              target="_blank"
              rel="noopener noreferrer"
            >
              Tonal chord symbols
            </a>{" "}
            with optional @octave and *beats (ex: Cmaj7@3*2). Use R or rest for
            silence.
          </p>
        </div>

        <div className={styles.form}>
          <label className={styles.label} htmlFor="chords">
            Chords
          </label>
          <input
            id="chords"
            className={styles.input}
            value={progression}
            onChange={(e) => setProgression(e.target.value)}
            placeholder="Cmaj7@3*2, R*1, Dm7@3, G7*0.5, Cmaj7"
          />
          <p className={styles.hint}>
            Format: comma-separated tokens. Examples: Cmaj7, Cmaj7@3, Cmaj7*2,
            Cmaj7@3*2, R*1.
          </p>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="bpm">
                BPM
              </label>
              <input
                id="bpm"
                type="number"
                min="1"
                className={styles.input}
                value={bpmInput}
                onChange={(e) => setBpmInput(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="beats">
                Default Length (beats)
              </label>
              <input
                id="beats"
                type="number"
                min="0.25"
                step="0.25"
                className={styles.input}
                value={beatsInput}
                onChange={(e) => setBeatsInput(e.target.value)}
              />
            </div>
          </div>

          <button
            type="button"
            className={styles.playButton}
            onClick={handlePlay}
            disabled={isPlaying}
          >
            {isPlaying ? "Playing..." : "Play"}
          </button>

          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
      </main>
    </div>
  );
}
