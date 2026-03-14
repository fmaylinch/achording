"use client";

import { useRef, useState } from "react";
import styles from "./page.module.css";
import * as Tone from "tone";
import { Chord, Note } from "@tonaljs/tonal";

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

export default function Home() {
  const [progression, setProgression] = useState("C, Cmaj7, CM7, Am@3");
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

    const chords = progression
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map(toPlayableChord);

    if (chords.length === 0 || chords.some((notes) => notes.length === 0)) {
      setError("Use Tonal chord symbols like Cmaj7@3, Dm7@3, G7@3.");
      return;
    }

    const bpm = Number.parseFloat(bpmInput);
    const beats = Number.parseFloat(beatsInput);
    if (!Number.isFinite(bpm) || bpm <= 0) {
      setError("BPM must be a positive number.");
      return;
    }
    if (!Number.isFinite(beats) || beats <= 0) {
      setError("Chord length must be a positive number of beats.");
      return;
    }

    setError("");
    setIsPlaying(true);

    await Tone.start();
    const synth = getSynth();
    const secondsPerBeat = 60 / bpm;
    const chordDurationSeconds = beats * secondsPerBeat;
    const startTime = Tone.now() + 0.05;

    chords.forEach((notes, index) => {
      const noteStart = startTime + index * chordDurationSeconds;
      synth.triggerAttackRelease(notes, chordDurationSeconds * 0.9, noteStart);
    });

    window.setTimeout(() => {
      setIsPlaying(false);
    }, chords.length * chordDurationSeconds * 1000 + 120);
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <h1>Chord Prototype</h1>
          <p>Type Tonal chord symbols and optional @octave (ex: Cmaj7@3).</p>
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
            placeholder="Cmaj7@3, Dm7@3, G7@3, Cmaj7@3"
          />

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
                Chord Length (beats)
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
