"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

function toPlayableChord(chordSymbol: string, baseOctave: number): string[] {
  const symbol = chordSymbol.trim();
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

function resolveOctaveSpec(currentOctave: number, octaveSpec: string): number | null {
  const trimmed = octaveSpec.trim();
  if (!trimmed) return null;

  if (/^[+-]\d+$/.test(trimmed)) {
    return currentOctave + Number.parseInt(trimmed, 10);
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return null;
}

function parseSequenceEvents(progression: string, defaultBeats: number): SequenceEvent[] {
  let currentOctave = 4;
  const events: SequenceEvent[] = [];
  const tokens = progression.split(",");

  for (const token of tokens) {
    const trimmedToken = token.trim();
    if (!trimmedToken) continue;

    const eventMatch = /^(.*?)(?:\*(\d*\.?\d+))?$/.exec(trimmedToken);
    if (!eventMatch) return [];

    const eventSymbol = eventMatch[1].trim();
    const durationBeats = eventMatch[2] ? Number.parseFloat(eventMatch[2]) : defaultBeats;
    if (!eventSymbol || !Number.isFinite(durationBeats) || durationBeats <= 0) return [];

    const directiveMatch = /^@([+-]?\d+)$/.exec(eventSymbol);
    if (directiveMatch) {
      const resolvedDirectiveOctave = resolveOctaveSpec(currentOctave, directiveMatch[1]);
      if (!Number.isFinite(resolvedDirectiveOctave)) return [];
      currentOctave = resolvedDirectiveOctave as number;
      continue;
    }

    if (/^(r|rest)$/i.test(eventSymbol)) {
      events.push({ durationBeats, notes: null });
      continue;
    }

    const chordOctaveMatch = /^(.*?)(?:@([+-]?\d+))?$/.exec(eventSymbol);
    if (!chordOctaveMatch) return [];

    const chordSymbol = chordOctaveMatch[1].trim();
    if (!chordSymbol) return [];

    let chordOctave = currentOctave;
    if (chordOctaveMatch[2]) {
      const resolvedChordOctave = resolveOctaveSpec(currentOctave, chordOctaveMatch[2]);
      if (!Number.isFinite(resolvedChordOctave)) return [];
      chordOctave = resolvedChordOctave as number;
    }

    const notes = toPlayableChord(chordSymbol, chordOctave);
    if (notes.length === 0) return [];

    events.push({ durationBeats, notes });
  }

  return events;
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
  const activeEventsRef = useRef<SequenceEvent[]>([]);
  const pendingEventsRef = useRef<SequenceEvent[] | null>(null);
  const eventIndexRef = useRef(0);
  const secondsPerBeatRef = useRef(0.5);
  const playbackTimerRef = useRef<number | null>(null);
  const playbackActiveRef = useRef(false);

  useEffect(() => {
    return () => {
      playbackActiveRef.current = false;
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      synthsRef.current.forEach((synth) => synth.dispose());
      synthsRef.current = [];
      filterRef.current?.dispose();
      filterRef.current = null;
    };
  }, []);

  const getFilter = useCallback(() => {
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
  }, [filter]);

  const getSynths = useCallback(() => {
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
  }, [envelope, getFilter, oscillators]);

  useEffect(() => {
    if (!isPlaying) return;

    // Ensure current oscillator config is reflected in active synth nodes.
    const synths = getSynths();
    synths.forEach((synth, index) => {
      const oscillator = oscillators[index];
      if (!oscillator) return;

      synth.set({
        oscillator: { type: oscillator.type },
        envelope,
        detune: oscillator.detuneCents,
      });
      synth.volume.rampTo(oscillator.volumeDb, 0.05);
    });
  }, [getSynths, isPlaying, oscillators, envelope]);

  useEffect(() => {
    if (!isPlaying || !filterRef.current) return;

    // Smooth live filter updates while audio is running.
    if (filterRef.current.type !== filter.type) {
      filterRef.current.type = filter.type;
    }
    filterRef.current.frequency.rampTo(filter.frequency, 0.05);
    filterRef.current.Q.rampTo(filter.q, 0.05);
  }, [isPlaying, filter]);

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

  const stopPlayback = () => {
    playbackActiveRef.current = false;
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    synthsRef.current.forEach((synth) => synth.releaseAll());
    activeEventsRef.current = [];
    pendingEventsRef.current = null;
    eventIndexRef.current = 0;
    setIsPlaying(false);
  };

  const handleTogglePlay = async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

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

    const events = parseSequenceEvents(progression, defaultBeats);

    if (events.length === 0) {
      setError("Use tokens like Cmaj7@3*2, R*1, Dm7, G7*0.5.");
      return;
    }

    setError("");
    await Tone.start();
    getSynths();
    secondsPerBeatRef.current = 60 / bpm;
    activeEventsRef.current = events;
    pendingEventsRef.current = null;
    eventIndexRef.current = 0;
    playbackActiveRef.current = true;

    const scheduleNextStep = (delayMs: number) => {
      playbackTimerRef.current = window.setTimeout(() => {
        if (!playbackActiveRef.current) return;

        const currentEvents = activeEventsRef.current;
        if (currentEvents.length === 0) return;

        const currentIndex = eventIndexRef.current;
        const event = currentEvents[currentIndex];
        const eventDurationSeconds = event.durationBeats * secondsPerBeatRef.current;

        if (event.notes) {
          const notes = event.notes;
          const startTime = Tone.now() + 0.01;
          synthsRef.current.forEach((synth) => {
            synth.triggerAttackRelease(notes, eventDurationSeconds * 0.9, startTime);
          });
        }

        const isLastEvent = currentIndex >= currentEvents.length - 1;
        if (isLastEvent) {
          if (pendingEventsRef.current && pendingEventsRef.current.length > 0) {
            activeEventsRef.current = pendingEventsRef.current;
            pendingEventsRef.current = null;
            setError("");
          }
          eventIndexRef.current = 0;
        } else {
          eventIndexRef.current = currentIndex + 1;
        }

        scheduleNextStep(eventDurationSeconds * 1000);
      }, delayMs);
    };

    const playStep = () => {
      const currentEvents = activeEventsRef.current;
      if (currentEvents.length === 0) return;

      const currentIndex = eventIndexRef.current;
      const event = currentEvents[currentIndex];
      const eventDurationSeconds = event.durationBeats * secondsPerBeatRef.current;

      if (event.notes) {
        const notes = event.notes;
        const startTime = Tone.now() + 0.01;
        synthsRef.current.forEach((synth) => {
          synth.triggerAttackRelease(notes, eventDurationSeconds * 0.9, startTime);
        });
      }

      const isLastEvent = currentIndex >= currentEvents.length - 1;
      if (isLastEvent) {
        if (pendingEventsRef.current && pendingEventsRef.current.length > 0) {
          activeEventsRef.current = pendingEventsRef.current;
          pendingEventsRef.current = null;
          setError("");
        }
        eventIndexRef.current = 0;
      } else {
        eventIndexRef.current = currentIndex + 1;
      }

      scheduleNextStep(eventDurationSeconds * 1000);
    };

    playStep();
    setIsPlaying(true);
  };

  useEffect(() => {
    if (!isPlaying) return;

    const defaultBeats = Number.parseFloat(beatsInput);
    if (!Number.isFinite(defaultBeats) || defaultBeats <= 0) {
      pendingEventsRef.current = null;
      return;
    }

    const events = parseSequenceEvents(progression, defaultBeats);
    if (events.length === 0) {
      pendingEventsRef.current = null;
      return;
    }

    pendingEventsRef.current = events;
  }, [isPlaying, progression, beatsInput]);

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
            with optional `@octave`, `@+octaves`, `@-octaves` and `*beats`. Use
            standalone `@...` to change default octave for next chords. Use R
            or rest for silence.
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
            Format: comma-separated tokens. Examples: Cmaj7, @-1, Cmaj7@+1,
            Cmaj7*2, Cmaj7@3*2, R*1.
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
            onClick={handleTogglePlay}
          >
            {isPlaying ? "Stop" : "Play"}
          </button>

          <details className={styles.collapsible}>
            <summary className={styles.collapsibleSummary}>Oscillators + ADSR</summary>
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
          </details>

          <details className={styles.collapsible}>
            <summary className={styles.collapsibleSummary}>Filter</summary>
            <div className={styles.filterPanel}>
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
          </details>

          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
      </main>
    </div>
  );
}
