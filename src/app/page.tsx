"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import * as Tone from "tone";
import { Chord, Note } from "@tonaljs/tonal";

type SequenceEvent = {
  durationBeats: number;
  notes: string[] | null;
};

const oscillatorTypes = ["sine", "triangle", "sawtooth", "square"] as const;
type OscillatorType = (typeof oscillatorTypes)[number];
const filterTypes = ["lowpass", "highpass", "bandpass", "notch"] as const;
type FilterType = (typeof filterTypes)[number];

type EnvelopeSettings = {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
};

type OscillatorSettings = {
  id: string;
  type: OscillatorType;
  volumeDb: number;
  detuneCents: number;
};

type FilterSettings = {
  type: FilterType;
  frequency: number;
  q: number;
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
  const [oscillators, setOscillators] = useState<OscillatorSettings[]>([
    { id: "osc-1", type: "triangle", volumeDb: -12, detuneCents: 0 },
    { id: "osc-2", type: "sine", volumeDb: -12, detuneCents: 8 },
  ]);
  const [filter, setFilter] = useState<FilterSettings>({
    type: "lowpass",
    frequency: 12000,
    q: 1,
  });
  const [envelope, setEnvelope] = useState<EnvelopeSettings>({
    attack: 0.005,
    decay: 0.15,
    sustain: 0.25,
    release: 1.2,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");
  const synthsRef = useRef<Tone.PolySynth[]>([]);
  const filterRef = useRef<Tone.Filter | null>(null);

  useEffect(() => {
    return () => {
      synthsRef.current.forEach((synth) => synth.dispose());
      synthsRef.current = [];
      filterRef.current?.dispose();
      filterRef.current = null;
    };
  }, []);

  const getFilter = () => {
    if (!filterRef.current) {
      filterRef.current = new Tone.Filter({
        type: filter.type,
        frequency: filter.frequency,
        Q: filter.q,
      }).toDestination();
    }

    filterRef.current.set({
      type: filter.type,
      frequency: filter.frequency,
      Q: filter.q,
    });

    return filterRef.current;
  };

  const getSynths = () => {
    const filterNode = getFilter();

    if (synthsRef.current.length > oscillators.length) {
      synthsRef.current.splice(oscillators.length).forEach((synth) => synth.dispose());
    }

    oscillators.forEach((oscillator, index) => {
      if (!synthsRef.current[index]) {
        const synth = new Tone.PolySynth(Tone.Synth);
        synth.connect(filterNode);
        synthsRef.current[index] = synth;
      }

      synthsRef.current[index].set({
        oscillator: { type: oscillator.type },
        envelope,
        detune: oscillator.detuneCents,
      });
      synthsRef.current[index].volume.value = oscillator.volumeDb;
    });

    return synthsRef.current;
  };

  const updateEnvelope = (key: keyof EnvelopeSettings, value: number) => {
    setEnvelope((prev) => ({ ...prev, [key]: value }));
  };

  const updateOscillator = (
    id: string,
    key: keyof Pick<OscillatorSettings, "type" | "volumeDb" | "detuneCents">,
    value: OscillatorType | number,
  ) => {
    setOscillators((prev) =>
      prev.map((oscillator) => (oscillator.id === id ? { ...oscillator, [key]: value } : oscillator)),
    );
  };

  const updateFilter = (key: keyof FilterSettings, value: FilterType | number) => {
    setFilter((prev) => ({ ...prev, [key]: value }));
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
    const synths = getSynths();
    const secondsPerBeat = 60 / bpm;
    const startTime = Tone.now() + 0.05;
    let cursorTime = startTime;
    let totalDurationSeconds = 0;

    events.forEach((event) => {
      const eventDurationSeconds = event.durationBeats * secondsPerBeat;
      if (event.notes) {
        synths.forEach((synth) => {
          synth.triggerAttackRelease(event.notes, eventDurationSeconds * 0.9, cursorTime);
        });
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

          <div className={styles.oscillatorGrid}>
            {oscillators.map((oscillator, index) => (
              <div key={oscillator.id} className={styles.oscillatorCard}>
                <p className={styles.sectionTitle}>Oscillator {index + 1}</p>
                <label className={styles.label} htmlFor={`osc-type-${oscillator.id}`}>
                  Type
                </label>
                <select
                  id={`osc-type-${oscillator.id}`}
                  className={styles.input}
                  value={oscillator.type}
                  onChange={(e) =>
                    updateOscillator(oscillator.id, "type", e.target.value as OscillatorType)
                  }
                >
                  {oscillatorTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <label className={styles.sliderLabel} htmlFor={`osc-volume-${oscillator.id}`}>
                  Level: {oscillator.volumeDb} dB
                </label>
                <input
                  id={`osc-volume-${oscillator.id}`}
                  type="range"
                  min="-30"
                  max="0"
                  step="1"
                  className={styles.slider}
                  value={oscillator.volumeDb}
                  onChange={(e) =>
                    updateOscillator(oscillator.id, "volumeDb", Number.parseFloat(e.target.value))
                  }
                />
                <label className={styles.sliderLabel} htmlFor={`osc-detune-${oscillator.id}`}>
                  Detune: {oscillator.detuneCents} cents
                </label>
                <input
                  id={`osc-detune-${oscillator.id}`}
                  type="range"
                  min="-1200"
                  max="1200"
                  step="1"
                  className={styles.slider}
                  value={oscillator.detuneCents}
                  onChange={(e) =>
                    updateOscillator(oscillator.id, "detuneCents", Number.parseFloat(e.target.value))
                  }
                />
              </div>
            ))}
          </div>

          <div className={styles.envelopePanel}>
            <p className={styles.sectionTitle}>ADSR Envelope</p>

            <label className={styles.sliderLabel} htmlFor="attack">
              Attack: {envelope.attack.toFixed(3)}s
            </label>
            <input
              id="attack"
              type="range"
              min="0"
              max="2"
              step="0.005"
              className={styles.slider}
              value={envelope.attack}
              onChange={(e) => updateEnvelope("attack", Number.parseFloat(e.target.value))}
            />

            <label className={styles.sliderLabel} htmlFor="decay">
              Decay: {envelope.decay.toFixed(3)}s
            </label>
            <input
              id="decay"
              type="range"
              min="0"
              max="2"
              step="0.005"
              className={styles.slider}
              value={envelope.decay}
              onChange={(e) => updateEnvelope("decay", Number.parseFloat(e.target.value))}
            />

            <label className={styles.sliderLabel} htmlFor="sustain">
              Sustain: {envelope.sustain.toFixed(3)}
            </label>
            <input
              id="sustain"
              type="range"
              min="0"
              max="1"
              step="0.01"
              className={styles.slider}
              value={envelope.sustain}
              onChange={(e) => updateEnvelope("sustain", Number.parseFloat(e.target.value))}
            />

            <label className={styles.sliderLabel} htmlFor="release">
              Release: {envelope.release.toFixed(3)}s
            </label>
            <input
              id="release"
              type="range"
              min="0.05"
              max="4"
              step="0.01"
              className={styles.slider}
              value={envelope.release}
              onChange={(e) => updateEnvelope("release", Number.parseFloat(e.target.value))}
            />
          </div>

          <div className={styles.filterPanel}>
            <p className={styles.sectionTitle}>Filter</p>
            <label className={styles.label} htmlFor="filter-type">
              Type
            </label>
            <select
              id="filter-type"
              className={styles.input}
              value={filter.type}
              onChange={(e) => updateFilter("type", e.target.value as FilterType)}
            >
              {filterTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>

            <label className={styles.sliderLabel} htmlFor="filter-frequency">
              Cutoff: {Math.round(filter.frequency)} Hz
            </label>
            <input
              id="filter-frequency"
              type="range"
              min="60"
              max="18000"
              step="1"
              className={styles.slider}
              value={filter.frequency}
              onChange={(e) => updateFilter("frequency", Number.parseFloat(e.target.value))}
            />

            <label className={styles.sliderLabel} htmlFor="filter-q">
              Resonance (Q): {filter.q.toFixed(1)}
            </label>
            <input
              id="filter-q"
              type="range"
              min="0.1"
              max="20"
              step="0.1"
              className={styles.slider}
              value={filter.q}
              onChange={(e) => updateFilter("q", Number.parseFloat(e.target.value))}
            />
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
