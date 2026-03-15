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
const scaleRootNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
type ScaleRootNote = (typeof scaleRootNotes)[number];
const scaleModes = ["Major", "Minor", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Locrian"] as const;
type ScaleMode = (typeof scaleModes)[number];
const chromaticScale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const modeSemitoneSteps: Record<ScaleMode, number[]> = {
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
};

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

type KnobProps = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  dragSensitivity?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quantize(value: number, min: number, step: number): number {
  if (step <= 0) return value;

  const rounded = Math.round((value - min) / step) * step + min;
  const precision = Math.max(0, (step.toString().split(".")[1] || "").length);
  return Number(rounded.toFixed(precision));
}

function Knob({
  id,
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
  formatValue,
  dragSensitivity = 1,
}: KnobProps) {
  const dragStateRef = useRef<{ startY: number; startValue: number } | null>(null);
  const ratio = (value - min) / (max - min);
  const angle = -135 + ratio * 270;
  const displayValue = formatValue ? formatValue(value) : value.toString();

  const applyDelta = (delta: number) => {
    const nextValue = clamp(quantize(value + delta, min, step), min, max);
    onChange(nextValue);
  };

  return (
    <div className={styles.knobField}>
      <label id={`${id}-label`} className={styles.knobLabel} htmlFor={id}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        className={styles.knob}
        role="slider"
        aria-labelledby={`${id}-label`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={displayValue}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault();
            applyDelta(e.shiftKey ? step * 0.2 : step);
            return;
          }

          if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            applyDelta(e.shiftKey ? -step * 0.2 : -step);
            return;
          }

          if (e.key === "Home") {
            e.preventDefault();
            onChange(min);
            return;
          }

          if (e.key === "End") {
            e.preventDefault();
            onChange(max);
          }
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragStateRef.current = {
            startY: e.clientY,
            startValue: value,
          };
        }}
        onPointerMove={(e) => {
          const dragState = dragStateRef.current;
          if (!dragState) return;

          const dragDistance = dragState.startY - e.clientY;
          const dragScale = (e.shiftKey ? 640 : 140) * dragSensitivity;
          const normalizedDelta = dragDistance / dragScale;
          const valueDelta = normalizedDelta * (max - min);
          const nextValue = clamp(quantize(dragState.startValue + valueDelta, min, step), min, max);
          onChange(nextValue);
        }}
        onPointerUp={() => {
          dragStateRef.current = null;
        }}
        onPointerCancel={() => {
          dragStateRef.current = null;
        }}
      >
        <svg viewBox="0 0 100 100" className={styles.knobDial} aria-hidden="true">
          <circle cx="50" cy="50" r="40" className={styles.knobTrack} />
          <circle
            cx="50"
            cy="50"
            r="40"
            className={styles.knobArc}
            style={{ strokeDashoffset: `${251.33 - ratio * 188.5}` }}
          />
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="20"
            className={styles.knobIndicator}
            style={{ transform: `rotate(${angle}deg)`, transformOrigin: "50px 50px" }}
          />
        </svg>
        <span className={styles.knobValue}>{displayValue}</span>
      </button>
    </div>
  );
}

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

function generateDiatonicChordProgression(root: ScaleRootNote, mode: ScaleMode): string {
  const rootIndex = chromaticScale.indexOf(root);
  const scaleNotes = modeSemitoneSteps[mode].map((step) => chromaticScale[(rootIndex + step) % 12]);
  const availableDegrees = [0, 1, 2, 3, 4, 5, 6];
  const chosenDegrees: number[] = [];

  while (chosenDegrees.length < 4 && availableDegrees.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableDegrees.length);
    const [degree] = availableDegrees.splice(randomIndex, 1);
    chosenDegrees.push(degree);
  }

  const chordSymbols = chosenDegrees.map((degree) => {
    const chordRoot = scaleNotes[degree];
    const chordThird = scaleNotes[(degree + 2) % scaleNotes.length];
    const chordFifth = scaleNotes[(degree + 4) % scaleNotes.length];

    const chordRootIndex = chromaticScale.indexOf(chordRoot);
    const thirdIndex = chromaticScale.indexOf(chordThird);
    const fifthIndex = chromaticScale.indexOf(chordFifth);

    const thirdDistance = (thirdIndex - chordRootIndex + 12) % 12;
    const fifthDistance = (fifthIndex - chordRootIndex + 12) % 12;

    if (thirdDistance === 4 && fifthDistance === 7) return chordRoot;
    if (thirdDistance === 3 && fifthDistance === 7) return `${chordRoot}m`;
    if (thirdDistance === 3 && fifthDistance === 6) return `${chordRoot}dim`;
    return chordRoot;
  });

  return chordSymbols.join(", ");
}

export default function Home() {
  const [progression, setProgression] = useState("Cmaj7@3*2, R*1, Dm7@3, G7*0.5, Cmaj7");
  const [bpmInput, setBpmInput] = useState("120");
  const [beatsInput, setBeatsInput] = useState("2");
  const [scaleRoot, setScaleRoot] = useState<ScaleRootNote>("C");
  const [scaleMode, setScaleMode] = useState<ScaleMode>("Major");
  const [isProgressionFlashing, setIsProgressionFlashing] = useState(false);
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
  const progressionFlashTimerRef = useRef<number | null>(null);
  const playbackActiveRef = useRef(false);

  useEffect(() => {
    return () => {
      playbackActiveRef.current = false;
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      if (progressionFlashTimerRef.current !== null) {
        window.clearTimeout(progressionFlashTimerRef.current);
        progressionFlashTimerRef.current = null;
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

  useEffect(() => {
    if (!isPlaying) return;

    const bpm = Number.parseFloat(bpmInput);
    if (!Number.isFinite(bpm) || bpm <= 0) return;

    secondsPerBeatRef.current = 60 / bpm;
  }, [isPlaying, bpmInput]);

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

  const handleGenerateProgression = () => {
    setProgression(generateDiatonicChordProgression(scaleRoot, scaleMode));
    setIsProgressionFlashing(false);
    window.requestAnimationFrame(() => {
      setIsProgressionFlashing(true);
      if (progressionFlashTimerRef.current !== null) {
        window.clearTimeout(progressionFlashTimerRef.current);
      }
      progressionFlashTimerRef.current = window.setTimeout(() => {
        setIsProgressionFlashing(false);
        progressionFlashTimerRef.current = null;
      }, 650);
    });
    setError("");
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

        const currentIndex = Math.min(eventIndexRef.current, currentEvents.length - 1);
        eventIndexRef.current = currentIndex;
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

      const currentIndex = Math.min(eventIndexRef.current, currentEvents.length - 1);
      eventIndexRef.current = currentIndex;
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

    activeEventsRef.current = events;
    pendingEventsRef.current = null;
    eventIndexRef.current = Math.min(eventIndexRef.current, events.length - 1);
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
            className={`${styles.input} ${isProgressionFlashing ? styles.inputFlash : ""}`}
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
                Default Chord Length (beats)
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

          <details className={styles.collapsible}>
            <summary className={styles.collapsibleSummary}>Chord Generator</summary>
            <div className={styles.filterPanel}>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="scale-root">
                    Root Note
                  </label>
                  <select
                    id="scale-root"
                    className={styles.input}
                    value={scaleRoot}
                    onChange={(e) => setScaleRoot(e.target.value as ScaleRootNote)}
                  >
                    {scaleRootNotes.map((rootNote) => (
                      <option key={rootNote} value={rootNote}>
                        {rootNote}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="scale-mode">
                    Mode
                  </label>
                  <select
                    id="scale-mode"
                    className={styles.input}
                    value={scaleMode}
                    onChange={(e) => setScaleMode(e.target.value as ScaleMode)}
                  >
                    {scaleModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                className={styles.generateButton}
                onClick={handleGenerateProgression}
              >
                Generate Chords
              </button>
            </div>
          </details>

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
                  <div className={styles.knobRow}>
                    <Knob
                      id={`osc-volume-${oscillator.id}`}
                      label="Level"
                      min={-30}
                      max={0}
                      step={1}
                      value={oscillator.volumeDb}
                      defaultValue={-12}
                      onChange={(next) => updateOscillator(oscillator.id, "volumeDb", next)}
                      formatValue={(next) => `${next} dB`}
                    />
                    <Knob
                      id={`osc-detune-${oscillator.id}`}
                      label="Detune"
                      min={-1200}
                      max={1200}
                      step={1}
                      value={oscillator.detuneCents}
                      defaultValue={0}
                      dragSensitivity={4}
                      onChange={(next) => updateOscillator(oscillator.id, "detuneCents", next)}
                      formatValue={(next) => `${next} ct`}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.envelopePanel}>
              <p className={styles.sectionTitle}>ADSR Envelope</p>
              <div className={styles.knobRowAdsr}>
                <Knob
                  id="attack"
                  label="Attack"
                  min={0}
                  max={2}
                  step={0.005}
                  value={envelope.attack}
                  defaultValue={0.005}
                  onChange={(next) => updateEnvelope("attack", next)}
                  formatValue={(next) => `${next.toFixed(3)} s`}
                />
                <Knob
                  id="decay"
                  label="Decay"
                  min={0}
                  max={2}
                  step={0.005}
                  value={envelope.decay}
                  defaultValue={0.15}
                  onChange={(next) => updateEnvelope("decay", next)}
                  formatValue={(next) => `${next.toFixed(3)} s`}
                />
                <Knob
                  id="sustain"
                  label="Sustain"
                  min={0}
                  max={1}
                  step={0.01}
                  value={envelope.sustain}
                  defaultValue={0.25}
                  onChange={(next) => updateEnvelope("sustain", next)}
                  formatValue={(next) => next.toFixed(2)}
                />
                <Knob
                  id="release"
                  label="Release"
                  min={0.05}
                  max={4}
                  step={0.01}
                  value={envelope.release}
                  defaultValue={1.2}
                  onChange={(next) => updateEnvelope("release", next)}
                  formatValue={(next) => `${next.toFixed(2)} s`}
                />
              </div>
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

              <div className={styles.knobRow}>
                <Knob
                  id="filter-frequency"
                  label="Cutoff"
                  min={60}
                  max={18000}
                  step={1}
                  value={filter.frequency}
                  defaultValue={12000}
                  onChange={(next) => updateFilter("frequency", next)}
                  formatValue={(next) => `${Math.round(next)} Hz`}
                />
                <Knob
                  id="filter-q"
                  label="Resonance"
                  min={0.1}
                  max={20}
                  step={0.1}
                  value={filter.q}
                  defaultValue={1}
                  onChange={(next) => updateFilter("q", next)}
                  formatValue={(next) => next.toFixed(1)}
                />
              </div>
            </div>
          </details>

          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
      </main>
    </div>
  );
}
