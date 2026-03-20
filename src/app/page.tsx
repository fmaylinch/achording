"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import * as Tone from "tone";
import { Chord, Note } from "@tonaljs/tonal";

type SequenceEvent = {
  durationBeats: number;
  notes: string[] | null;
};

type InputNotation = "chords" | "notes";
type DrumStep = "K" | "S" | "H" | "-";

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
const romanDegreeToIndex: Record<string, number> = {
  I: 0,
  II: 1,
  III: 2,
  IV: 3,
  V: 4,
  VI: 5,
  VII: 6,
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

type GeneratorProbabilities = {
  lengthVariation: number;
  chordVariation: number;
  rootModeChange: number;
  hasThird: number;
  seventh: number;
  suspended: number;
  parallel: number;
  diminished: number;
  inversion: number;
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

const defaultScaleRoot: ScaleRootNote = "C";
const defaultScaleMode: ScaleMode = "Major";
const defaultGeneratorProbabilities: GeneratorProbabilities = {
  lengthVariation: 50,
  chordVariation: 80,
  rootModeChange: 100,
  hasThird: 80,
  seventh: 0,
  suspended: 0,
  parallel: 0,
  diminished: 0,
  inversion: 0,
};
const defaultGeneratorLength = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quantize(value: number, min: number, step: number): number {
  if (step <= 0) return value;

  const rounded = Math.round((value - min) / step) * step + min;
  const precision = Math.max(0, (step.toString().split("-")[1] || "").length);
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
  const chordPitchClasses = getChordPitchClasses(symbol);
  if (!chordPitchClasses || chordPitchClasses.length === 0) return [];

  let previousMidi = -Infinity;
  return chordPitchClasses.map((pitchClass) => {
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

function getChordPitchClasses(symbol: string): string[] | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;

  const parts = trimmed.split("/");
  if (parts.length > 2) return null;

  const baseSymbol = parts[0]?.trim() ?? "";
  if (!baseSymbol) return null;

  const chord = Chord.get(baseSymbol);
  if (!chord || chord.empty || chord.notes.length === 0) return null;

  const basePitchClasses = chord.notes.map((pitchClass) => Note.simplify(pitchClass) || pitchClass);
  if (parts.length === 1) return basePitchClasses;

  const rawBass = parts[1]?.trim() ?? "";
  const bassPitchClass = Note.pitchClass(rawBass);
  if (!bassPitchClass) return null;
  const simplifiedBass = Note.simplify(bassPitchClass) || bassPitchClass;

  const bassChroma = Note.chroma(simplifiedBass);
  if (bassChroma === null) return null;

  const inversionIndex = basePitchClasses.findIndex((pitchClass) => Note.chroma(pitchClass) === bassChroma);
  if (inversionIndex < 0) return null;

  return [...basePitchClasses.slice(inversionIndex), ...basePitchClasses.slice(0, inversionIndex)];
}

function toPlayableNotes(noteSymbol: string, baseOctave: number): string[] {
  if (!Number.isFinite(baseOctave)) return [];
  const noteParts = extractCompactNoteParts(noteSymbol);
  if (!noteParts) return [];

  let previousMidi = -Infinity;
  return noteParts.map((notePart) => {
    const pitchClass = Note.pitchClass(notePart);
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

function parseInputNotation(progression: string): { notation: InputNotation; content: string } {
  const trimmed = progression.trim();
  const notationMatch = /^(chords|notes)\s*:\s*(.*)$/i.exec(trimmed);
  if (!notationMatch) {
    return { notation: "notes", content: progression };
  }

  return {
    notation: notationMatch[1].toLowerCase() as InputNotation,
    content: notationMatch[2],
  };
}

function extractCompactNoteParts(symbol: string): string[] | null {
  const compactSymbol = symbol.replace(/\s+/g, "");
  if (!compactSymbol) return null;

  const noteParts = compactSymbol.match(/[A-Ga-g](?:#|b)?/g);
  if (!noteParts || noteParts.join("") !== compactSymbol) return null;
  return noteParts;
}

function convertProgressionNotation(progression: string): string | null {
  const { notation, content } = parseInputNotation(progression);
  const targetNotation: InputNotation = notation === "notes" ? "chords" : "notes";
  const targetPrefix = targetNotation === "chords" ? "Chords" : "Notes";
  const tokens = content.split(",");
  const convertedTokens: string[] = [];

  for (const token of tokens) {
    const trimmedToken = token.trim();
    if (!trimmedToken) continue;

    const eventMatch = /^(.*?)(?:\*(\d*\.?\d+))?$/.exec(trimmedToken);
    if (!eventMatch) return null;

    const eventSymbol = eventMatch[1].trim();
    const beatsSuffix = eventMatch[2] ? `*${eventMatch[2]}` : "";
    if (!eventSymbol) return null;

    const directiveMatch = /^@([+-]?\d+)$/.exec(eventSymbol);
    if (directiveMatch) {
      convertedTokens.push(eventSymbol + beatsSuffix);
      continue;
    }

    if (/^(r|rest)$/i.test(eventSymbol)) {
      convertedTokens.push(`R${beatsSuffix}`);
      continue;
    }

    const symbolMatch = /^(.*?)(?:@([+-]?\d+))?$/.exec(eventSymbol);
    if (!symbolMatch) return null;

    const symbol = symbolMatch[1].trim();
    const octaveSuffix = symbolMatch[2] ? `@${symbolMatch[2]}` : "";
    if (!symbol) return null;

    if (notation === "chords") {
      const chordPitchClasses = getChordPitchClasses(symbol);
      if (!chordPitchClasses || chordPitchClasses.length === 0) return null;
      const convertedSymbol = chordPitchClasses.join("");
      convertedTokens.push(`${convertedSymbol}${octaveSuffix}${beatsSuffix}`);
      continue;
    }

    const noteParts = extractCompactNoteParts(symbol);
    if (!noteParts) return null;

    const notePitchClasses = noteParts.map((notePart) => {
      const pitchClass = Note.pitchClass(notePart);
      return Note.simplify(pitchClass) || pitchClass;
    });
    const detectedChords = Chord.detect(notePitchClasses);
    if (detectedChords.length === 0) return null;
    convertedTokens.push(`${detectedChords[0]}${octaveSuffix}${beatsSuffix}`);
  }

  return `${targetPrefix}: ${convertedTokens.join(", ")}`;
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
  const { notation, content } = parseInputNotation(progression);
  const tokens = content.split(",");

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

    const notes =
      notation === "chords"
        ? toPlayableChord(chordSymbol, chordOctave)
        : toPlayableNotes(chordSymbol, chordOctave);
    if (notes.length === 0) return [];

    events.push({ durationBeats, notes });
  }

  return events;
}

function roll(probabilityPercent: number): boolean {
  return Math.random() < clamp(probabilityPercent / 100, 0, 1);
}

function generateDiatonicChordProgression(
  root: ScaleRootNote,
  mode: ScaleMode,
  probabilities: GeneratorProbabilities,
  progressionLengthBeats: number,
): string {
  const rootIndex = chromaticScale.indexOf(root);
  const scaleNotes = modeSemitoneSteps[mode].map((step) => chromaticScale[(rootIndex + step) % 12]);
  const allDegrees = [0, 1, 2, 3, 4, 5, 6];
  const usedDegrees: number[] = [];
  const normalizedLengthBeats = clamp(Math.round(progressionLengthBeats), 1, 16);
  const normalizedLengthVariation = clamp(probabilities.lengthVariation, 0, 100);
  const normalizedChordVariation = clamp(probabilities.chordVariation, 0, 100);

  const isDiminishedDegree = (degree: number): boolean => {
    const chordRoot = scaleNotes[degree];
    const chordThird = scaleNotes[(degree + 2) % scaleNotes.length];
    const chordFifth = scaleNotes[(degree + 4) % scaleNotes.length];
    const chordRootIndex = chromaticScale.indexOf(chordRoot);
    const thirdIndex = chromaticScale.indexOf(chordThird);
    const fifthIndex = chromaticScale.indexOf(chordFifth);
    const thirdDistance = (thirdIndex - chordRootIndex + 12) % 12;
    const fifthDistance = (fifthIndex - chordRootIndex + 12) % 12;
    return thirdDistance === 3 && fifthDistance === 6;
  };

  const buildChordSymbolForDegree = (degree: number): string => {
    const chordRoot = scaleNotes[degree];
    const chordThird = scaleNotes[(degree + 2) % scaleNotes.length];
    const chordFifth = scaleNotes[(degree + 4) % scaleNotes.length];

    const chordRootIndex = chromaticScale.indexOf(chordRoot);
    const thirdIndex = chromaticScale.indexOf(chordThird);
    const fifthIndex = chromaticScale.indexOf(chordFifth);

    const thirdDistance = (thirdIndex - chordRootIndex + 12) % 12;
    const fifthDistance = (fifthIndex - chordRootIndex + 12) % 12;

    const hasThird = roll(probabilities.hasThird);
    const isPowerChord = !hasThird;
    const isSuspended = !isPowerChord && roll(probabilities.suspended);
    const isSeventh = !isPowerChord && roll(probabilities.seventh);

    let chordSymbol: string = chordRoot;

    if (isPowerChord) {
      chordSymbol = `${chordRoot}5`;
    } else if (isSuspended) {
      chordSymbol = isSeventh ? `${chordRoot}7sus4` : `${chordRoot}sus4`;
    } else if (thirdDistance === 4 && fifthDistance === 7) {
      const borrowed = roll(probabilities.parallel);
      if (isSeventh) {
        chordSymbol = borrowed ? `${chordRoot}m7` : `${chordRoot}maj7`;
      } else {
        chordSymbol = borrowed ? `${chordRoot}m` : chordRoot;
      }
    } else if (thirdDistance === 3 && fifthDistance === 7) {
      const borrowed = roll(probabilities.parallel);
      if (isSeventh) {
        chordSymbol = borrowed ? `${chordRoot}maj7` : `${chordRoot}m7`;
      } else {
        chordSymbol = borrowed ? chordRoot : `${chordRoot}m`;
      }
    } else if (thirdDistance === 3 && fifthDistance === 6) {
      chordSymbol = isSeventh ? `${chordRoot}m7b5` : `${chordRoot}dim`;
    }

    return chordSymbol;
  };

  const maybeApplyRandomInversion = (chordSymbol: string): string => {
    if (!roll(probabilities.inversion)) return chordSymbol;

    const chord = Chord.get(chordSymbol);
    if (!chord || chord.empty || chord.notes.length < 2) return chordSymbol;

    const inversionCandidates = chord.notes
      .slice(1)
      .map((pitchClass) => Note.simplify(pitchClass) || pitchClass);
    if (inversionCandidates.length === 0) return chordSymbol;

    const randomInversionIndex = Math.floor(Math.random() * inversionCandidates.length);
    const bassNote = inversionCandidates[randomInversionIndex];
    return `${chordSymbol}/${bassNote}`;
  };

  const degreeToChordSymbol = new Map<number, string>();
  const formatDuration = (duration: number): string => {
    return Number(duration.toFixed(2)).toString();
  };

  const pickNextDegree = (isFirstChord: boolean): number => {
    const includeDiminished = roll(probabilities.diminished);
    const nonDiminishedPool = allDegrees.filter((degree) => !isDiminishedDegree(degree));
    const allowedDegrees = includeDiminished ? allDegrees : nonDiminishedPool;
    const unusedAllowedDegrees = allowedDegrees.filter((degree) => !usedDegrees.includes(degree));
    const shouldPickRandomChordNormally = isFirstChord || roll(normalizedChordVariation);
    const sourcePool = shouldPickRandomChordNormally ? unusedAllowedDegrees : usedDegrees;
    const fallbackPool = shouldPickRandomChordNormally ? usedDegrees : unusedAllowedDegrees;
    const effectivePool =
      sourcePool.length > 0
        ? sourcePool
        : fallbackPool.length > 0
          ? fallbackPool
          : nonDiminishedPool;

    const randomIndex = Math.floor(Math.random() * effectivePool.length);
    const degree = effectivePool[randomIndex];
    if (!usedDegrees.includes(degree)) {
      usedDegrees.push(degree);
    }
    return degree;
  };

  let accumulatedBeats = 0;
  let isFirstChord = true;
  const chordSymbols: string[] = [];

  while (accumulatedBeats < normalizedLengthBeats) {
    const remainingBeats = normalizedLengthBeats - accumulatedBeats;
    const degree = pickNextDegree(isFirstChord);
    isFirstChord = false;

    if (!degreeToChordSymbol.has(degree)) {
      degreeToChordSymbol.set(degree, buildChordSymbolForDegree(degree));
    }
    const baseChordSymbol = degreeToChordSymbol.get(degree) ?? buildChordSymbolForDegree(degree);
    const chordSymbol = maybeApplyRandomInversion(baseChordSymbol);

    let durationBeats = 1;
    if (roll(normalizedLengthVariation)) {
      // Random duration in quarter-beat increments from 0.25 to 2.0 beats.
      durationBeats = (Math.floor(Math.random() * 8) + 1) / 4;
    }

    if (durationBeats > remainingBeats) {
      durationBeats = remainingBeats;
    }
    accumulatedBeats += durationBeats;
    chordSymbols.push(`${chordSymbol}*${formatDuration(durationBeats)}`);
  }

  return chordSymbols.join(", ");
}

function convertRomanNumeralsToChordSymbols(
  romanProgression: string,
  root: ScaleRootNote,
  mode: ScaleMode,
): string | null {
  const tokens = romanProgression
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const rootIndex = chromaticScale.indexOf(root);
  const scaleSteps = modeSemitoneSteps[mode];
  const chordSymbols: string[] = [];

  for (const token of tokens) {
    const match = /^([b#]*)([ivIV]+)\s*(dim|°|o)?$/.exec(token);
    if (!match) return null;

    const accidentalPart = match[1];
    const numeralPart = match[2];
    const diminishedPart = match[3];
    const degreeIndex = romanDegreeToIndex[numeralPart.toUpperCase()];
    if (degreeIndex === undefined) return null;

    const accidentalOffset = accidentalPart.split("").reduce((sum, accidental) => {
      if (accidental === "#") return sum + 1;
      if (accidental === "b") return sum - 1;
      return sum;
    }, 0);

    const noteIndex = (rootIndex + scaleSteps[degreeIndex] + accidentalOffset + 120) % 12;
    const chordRoot = chromaticScale[noteIndex];
    const isLowerCase = numeralPart === numeralPart.toLowerCase();
    const suffix = diminishedPart ? "dim" : isLowerCase ? "m" : "";
    chordSymbols.push(`${chordRoot}${suffix}`);
  }

  return chordSymbols.join(", ");
}

function parseDrumPattern(pattern: string): DrumStep[] | null {
  const compact = pattern.replace(/\s+/g, "").toUpperCase();
  if (!compact) return [];
  if (!/^[KSH-]+$/.test(compact)) return null;
  return compact.split("") as DrumStep[];
}

export default function Home() {
  const [progression, setProgression] = useState(
    () =>
      `Chords: ${generateDiatonicChordProgression(
        defaultScaleRoot,
        defaultScaleMode,
        defaultGeneratorProbabilities,
        defaultGeneratorLength,
      )}`,
  );
  const [bpmInput, setBpmInput] = useState("120");
  const [beatsInput, setBeatsInput] = useState("1");
  const [drumBeatInput, setDrumBeatInput] = useState("K---S---K---S-H-");
  const [romanInput, setRomanInput] = useState("I, IV, V, vi");
  const [scaleRoot, setScaleRoot] = useState<ScaleRootNote>(defaultScaleRoot);
  const [scaleMode, setScaleMode] = useState<ScaleMode>(defaultScaleMode);
  const [generatorProbabilities, setGeneratorProbabilities] = useState<GeneratorProbabilities>(
    defaultGeneratorProbabilities,
  );
  const [generatorLength, setGeneratorLength] = useState(defaultGeneratorLength);
  const [isProgressionFlashing, setIsProgressionFlashing] = useState(false);
  const [oscillators, setOscillators] = useState<OscillatorSettings[]>([
    { id: "osc-1", type: "sawtooth", volumeDb: -12, detuneCents: 0 },
    { id: "osc-2", type: "sine", volumeDb: -12, detuneCents: 8 },
  ]);
  const [filter, setFilter] = useState<FilterSettings>({
    type: "lowpass",
    frequency: 8000,
    q: 1,
  });
  const [envelope, setEnvelope] = useState<EnvelopeSettings>({
    attack: 0.06,
    decay: 0.15,
    sustain: 0.25,
    release: 1.2,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");
  const synthsRef = useRef<Tone.PolySynth[]>([]);
  const filterRef = useRef<Tone.Filter | null>(null);
  const kickRef = useRef<Tone.MembraneSynth | null>(null);
  const kickClickRef = useRef<Tone.NoiseSynth | null>(null);
  const snareRef = useRef<Tone.NoiseSynth | null>(null);
  const snareBodyRef = useRef<Tone.MembraneSynth | null>(null);
  const clapRef = useRef<Tone.NoiseSynth | null>(null);
  const hihatRef = useRef<Tone.MetalSynth | null>(null);
  const chordPartRef = useRef<Tone.Part<[string, SequenceEvent]> | null>(null);
  const drumSequenceRef = useRef<Tone.Sequence<DrumStep> | null>(null);
  const progressionFlashTimerRef = useRef<number | null>(null);
  const toTransportTicks = useCallback((beats: number) => {
    return `${Math.round(beats * Tone.Transport.PPQ)}i`;
  }, []);

  const disposeTransportParts = useCallback(() => {
    chordPartRef.current?.stop(0);
    chordPartRef.current?.dispose();
    chordPartRef.current = null;

    drumSequenceRef.current?.stop(0);
    drumSequenceRef.current?.dispose();
    drumSequenceRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      Tone.Transport.stop();
      Tone.Transport.cancel(0);
      disposeTransportParts();
      if (progressionFlashTimerRef.current !== null) {
        window.clearTimeout(progressionFlashTimerRef.current);
        progressionFlashTimerRef.current = null;
      }
      synthsRef.current.forEach((synth) => synth.dispose());
      synthsRef.current = [];
      kickRef.current?.dispose();
      kickClickRef.current?.dispose();
      snareRef.current?.dispose();
      snareBodyRef.current?.dispose();
      clapRef.current?.dispose();
      hihatRef.current?.dispose();
      kickRef.current = null;
      kickClickRef.current = null;
      snareRef.current = null;
      snareBodyRef.current = null;
      clapRef.current = null;
      hihatRef.current = null;
      filterRef.current?.dispose();
      filterRef.current = null;
    };
  }, [disposeTransportParts]);

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

  const getDrumKit = useCallback(() => {
    if (!kickRef.current) {
      kickRef.current = new Tone.MembraneSynth({
        pitchDecay: 0.014,
        octaves: 3.5,
        envelope: {
          attack: 0.0008,
          decay: 0.32,
          sustain: 0,
          release: 0.14,
        },
      }).toDestination();
      kickRef.current.volume.value = -3;
    }

    if (!kickClickRef.current) {
      kickClickRef.current = new Tone.NoiseSynth({
        noise: { type: "pink", playbackRate: 1 },
        envelope: {
          attack: 0.0005,
          decay: 0.012,
          sustain: 0,
          release: 0.006,
        },
      }).toDestination();
      kickClickRef.current.volume.value = -28;
    }

    if (!snareRef.current) {
      snareRef.current = new Tone.NoiseSynth({
        noise: { type: "white", playbackRate: 2.8 },
        envelope: {
          attack: 0.0005,
          decay: 0.055,
          sustain: 0,
          release: 0.008,
        },
      }).toDestination();
      snareRef.current.volume.value = -4;
    }

    if (!snareBodyRef.current) {
      snareBodyRef.current = new Tone.MembraneSynth({
        pitchDecay: 0.008,
        octaves: 1.6,
        envelope: {
          attack: 0.0008,
          decay: 0.11,
          sustain: 0,
          release: 0.04,
        },
      }).toDestination();
      snareBodyRef.current.volume.value = -8;
    }

    if (!clapRef.current) {
      clapRef.current = new Tone.NoiseSynth({
        noise: { type: "pink", playbackRate: 1.4 },
        envelope: {
          attack: 0.0005,
          decay: 0.045,
          sustain: 0,
          release: 0.02,
        },
      }).toDestination();
      clapRef.current.volume.value = -9;
    }

    if (!hihatRef.current) {
      hihatRef.current = new Tone.MetalSynth({
        envelope: {
          attack: 0.0015,
          decay: 0.07,
          release: 0.014,
        },
        harmonicity: 5.1,
        modulationIndex: 30,
        resonance: 3000,
        octaves: 2,
      }).toDestination();
      hihatRef.current.frequency.value = 300;
      hihatRef.current.volume.value = -19;
    }
  }, []);

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

    Tone.Transport.bpm.rampTo(bpm, 0.05);
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

  const updateGeneratorProbability = (key: keyof GeneratorProbabilities, value: number) => {
    setGeneratorProbabilities((prev) => ({ ...prev, [key]: value }));
  };

  const handleRandomizeGeneratorKnobs = () => {
    const randomPercent = () => Math.floor(Math.random() * 101);

    setGeneratorProbabilities({
      lengthVariation: randomPercent(),
      chordVariation: randomPercent(),
      rootModeChange: randomPercent(),
      hasThird: randomPercent(),
      seventh: randomPercent(),
      suspended: randomPercent(),
      parallel: randomPercent(),
      diminished: randomPercent(),
      inversion: randomPercent(),
    });
  };

  const flashProgressionInput = () => {
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
  };

  const handleGenerateProgression = () => {
    let nextRoot = scaleRoot;
    let nextMode = scaleMode;
    const shouldChangeRoot = roll(generatorProbabilities.rootModeChange);
    const shouldChangeMode = roll(generatorProbabilities.rootModeChange);

    if (shouldChangeRoot) {
      const availableRoots = scaleRootNotes.filter((rootNote) => rootNote !== scaleRoot);
      if (availableRoots.length > 0) {
        const randomRootIndex = Math.floor(Math.random() * availableRoots.length);
        nextRoot = availableRoots[randomRootIndex];
      }
    }

    if (shouldChangeMode) {
      const availableModes = scaleModes.filter((modeValue) => modeValue !== scaleMode);
      if (availableModes.length > 0) {
        const randomModeIndex = Math.floor(Math.random() * availableModes.length);
        nextMode = availableModes[randomModeIndex];
      }
    }

    if (shouldChangeRoot || shouldChangeMode) {
      setScaleRoot(nextRoot);
      setScaleMode(nextMode);
    }

    setProgression(
      `Chords: ${generateDiatonicChordProgression(
        nextRoot,
        nextMode,
        generatorProbabilities,
        generatorLength,
      )}`,
    );
    flashProgressionInput();
    setError("");
  };

  const handleConvertFromRoman = () => {
    const converted = convertRomanNumeralsToChordSymbols(romanInput, scaleRoot, scaleMode);
    if (!converted) {
      setError("Use Roman numerals like I, IV, V, vi (optionally with b/# and dim).");
      return;
    }

    setProgression(`Chords: ${converted}`);
    flashProgressionInput();
    setError("");
  };

  const handleToggleNotation = () => {
    const converted = convertProgressionNotation(progression);
    if (!converted) {
      setError("Cannot convert progression. Check tokens and notation prefix.");
      return;
    }

    setProgression(converted);
    flashProgressionInput();
    setError("");
  };

  const buildAndStartTransportPlayback = useCallback(
    (events: SequenceEvent[], drumSteps: DrumStep[], bpm: number) => {
      disposeTransportParts();

      Tone.Transport.stop();
      Tone.Transport.cancel(0);
      Tone.Transport.position = 0;
      Tone.Transport.bpm.value = bpm;

      let accumulatedBeats = 0;
      const timelineEvents: Array<[string, SequenceEvent]> = [];
      for (const event of events) {
        timelineEvents.push([toTransportTicks(accumulatedBeats), event]);
        accumulatedBeats += event.durationBeats;
      }
      const loopBeats = Math.max(accumulatedBeats, 0.25);

      const chordPart = new Tone.Part<[string, SequenceEvent]>((time, event) => {
        const notes = event.notes;
        if (!notes) return;
        const secondsPerBeat = 60 / Tone.Transport.bpm.value;
        const eventDurationSeconds = Math.max(0.01, event.durationBeats * secondsPerBeat * 0.9);
        synthsRef.current.forEach((synth) => {
          synth.triggerAttackRelease(notes, eventDurationSeconds, time);
        });
      }, timelineEvents);
      chordPart.loop = true;
      chordPart.loopEnd = toTransportTicks(loopBeats);
      chordPart.start(0);
      chordPartRef.current = chordPart;

      if (drumSteps.length > 0) {
        const drumSequence = new Tone.Sequence<DrumStep>(
          (time, step) => {
            if (step === "K") {
              kickRef.current?.triggerAttackRelease("A0", "8n", time, 1);
              kickClickRef.current?.triggerAttackRelease("128n", time, 0.2);
            } else if (step === "S") {
              snareRef.current?.triggerAttackRelease("32n", time, 1);
              snareBodyRef.current?.triggerAttackRelease("G1", "16n", time, 1);
              clapRef.current?.triggerAttackRelease("64n", time, 0.9);
              clapRef.current?.triggerAttackRelease("64n", time + 0.012, 0.75);
              clapRef.current?.triggerAttackRelease("64n", time + 0.025, 0.6);
            } else if (step === "H") {
              hihatRef.current?.triggerAttackRelease("32n", time);
            }
          },
          drumSteps,
          "16n",
        );
        drumSequence.start(0);
        drumSequenceRef.current = drumSequence;
      }

      Tone.Transport.start("+0.02");
    },
    [disposeTransportParts, toTransportTicks],
  );

  const stopPlayback = () => {
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    disposeTransportParts();
    synthsRef.current.forEach((synth) => synth.releaseAll());
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
    const drumSteps = parseDrumPattern(drumBeatInput);

    if (events.length === 0) {
      setError("Use Notes: CEG@3*2, R*1, DFA or Chords: Cmaj7@3*2, R*1, Dm7.");
      return;
    }
    if (drumSteps === null) {
      setError("Drum beat supports only K (kick), S (snare), H (hihat), and - (silence).");
      return;
    }

    setError("");
    await Tone.start();
    getSynths();
    getDrumKit();
    buildAndStartTransportPlayback(events, drumSteps, bpm);
    setIsPlaying(true);
  };

  useEffect(() => {
    if (!isPlaying) return;

    const defaultBeats = Number.parseFloat(beatsInput);
    if (!Number.isFinite(defaultBeats) || defaultBeats <= 0) {
      return;
    }

    const events = parseSequenceEvents(progression, defaultBeats);
    if (events.length === 0) {
      return;
    }

    const drumSteps = parseDrumPattern(drumBeatInput);
    if (drumSteps === null) return;

    buildAndStartTransportPlayback(events, drumSteps, Tone.Transport.bpm.value);
  }, [isPlaying, progression, beatsInput, drumBeatInput, buildAndStartTransportPlayback]);

  useEffect(() => {
    return () => {
      disposeTransportParts();
    };
  }, [disposeTransportParts]);

  const currentNotation = parseInputNotation(progression).notation;
  const convertNotationLabel = currentNotation === "notes" ? "To Chords" : "To Notes";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <h1>Achording</h1>
          <p className={styles.versionMeta}>v0.2 · Latest changes: drum beat</p>
        </div>
        <div className={styles.form}>
          <details className={styles.collapsible}>
            <summary className={styles.collapsibleSummary}>Chord Generation Config</summary>
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
              <div className={styles.inlineActionRow}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="roman-input">
                    Roman Numerals
                  </label>
                  <input
                    id="roman-input"
                    className={styles.input}
                    value={romanInput}
                    onChange={(e) => setRomanInput(e.target.value)}
                    placeholder="I, IV, V, vi"
                  />
                </div>
                <button
                  type="button"
                  className={`${styles.generateButton} ${styles.convertButton}`}
                  onClick={handleConvertFromRoman}
                >
                  Roman to Chords
                </button>
              </div>
              <div className={styles.knobRowGenerator}>
                <Knob
                  id="generator-length"
                  label="length"
                  min={1}
                  max={16}
                  step={1}
                  value={generatorLength}
                  defaultValue={8}
                  onChange={(next) => setGeneratorLength(next)}
                  formatValue={(next) => `${next.toFixed(0)} beats`}
                />
                <Knob
                  id="generator-length-variation"
                  label="duration var"
                  min={0}
                  max={100}
                  step={1}
                  value={generatorProbabilities.lengthVariation}
                  defaultValue={0}
                  onChange={(next) => updateGeneratorProbability("lengthVariation", next)}
                  formatValue={(next) => `${next.toFixed(0)}%`}
                />
                <Knob
                  id="generator-chord-variation"
                  label="chord var"
                  min={0}
                  max={100}
                  step={1}
                  value={generatorProbabilities.chordVariation}
                  defaultValue={60}
                  onChange={(next) => updateGeneratorProbability("chordVariation", next)}
                  formatValue={(next) => `${next.toFixed(0)}%`}
                />
                <Knob
                  id="generator-root-mode-change"
                  label="key/mode"
                  min={0}
                  max={100}
                  step={1}
                  value={generatorProbabilities.rootModeChange}
                  defaultValue={20}
                  onChange={(next) => updateGeneratorProbability("rootModeChange", next)}
                  formatValue={(next) => `${next.toFixed(0)}%`}
                />
                <Knob
                  id="generator-parallel"
                  label="borrowed"
                  min={0}
                  max={100}
                  step={1}
                  value={generatorProbabilities.parallel}
                  defaultValue={20}
                  onChange={(next) => updateGeneratorProbability("parallel", next)}
                  formatValue={(next) => `${next.toFixed(0)}%`}
                />
              </div>
              <div className={styles.knobRowGenerator}>
                <Knob
                  id="generator-inversion"
                  label="inversions"
                  min={0}
                  max={100}
                  step={1}
                  value={generatorProbabilities.inversion}
                  defaultValue={20}
                  onChange={(next) => updateGeneratorProbability("inversion", next)}
                  formatValue={(next) => `${next.toFixed(0)}%`}
                />
                <Knob
                  id="generator-third"
                  label="3rd"
                  min={0}
                  max={100}
                  step={1}
                  value={generatorProbabilities.hasThird}
                  defaultValue={80}
                  onChange={(next) => updateGeneratorProbability("hasThird", next)}
                  formatValue={(next) => `${next.toFixed(0)}%`}
                />
                <Knob
                  id="generator-seventh"
                  label="7th"
                  min={0}
                  max={100}
                  step={1}
                  value={generatorProbabilities.seventh}
                  defaultValue={20}
                  onChange={(next) => updateGeneratorProbability("seventh", next)}
                  formatValue={(next) => `${next.toFixed(0)}%`}
                />
                <Knob
                  id="generator-sus"
                  label="sus"
                  min={0}
                  max={100}
                  step={1}
                  value={generatorProbabilities.suspended}
                  defaultValue={20}
                  onChange={(next) => updateGeneratorProbability("suspended", next)}
                  formatValue={(next) => `${next.toFixed(0)}%`}
                />
                <Knob
                  id="generator-diminished"
                  label="dim"
                  min={0}
                  max={100}
                  step={1}
                  value={generatorProbabilities.diminished}
                  defaultValue={20}
                  onChange={(next) => updateGeneratorProbability("diminished", next)}
                  formatValue={(next) => `${next.toFixed(0)}%`}
                />
              </div>
              <button
                type="button"
                className={`${styles.generateButton} ${styles.randomizeButton}`}
                onClick={handleRandomizeGeneratorKnobs}
              >
                Randomize Knobs
              </button>
            </div>
          </details>
          <button
            type="button"
            className={styles.generateButton}
            onClick={handleGenerateProgression}
          >
            Generate Chords
          </button>
          <div className={styles.progressionInputRow}>
            <input
              id="chords"
              className={`${styles.input} ${isProgressionFlashing ? styles.inputFlash : ""}`}
              value={progression}
              onChange={(e) => setProgression(e.target.value)}
              placeholder="Notes: CEG@3*2, R*1, DFA@3, GBD*0.5, CEG"
              aria-label="Chords progression"
            />
            <button
              type="button"
              className={`${styles.generateButton} ${styles.progressionConvertButton}`}
              onClick={handleToggleNotation}
            >
              {convertNotationLabel}
            </button>
          </div>
          <p className={styles.hint}>
            Explicit notes like <code>CEGB</code> or chords like{" "}
            <a href="https://tonaljs.github.io/tonal/docs/groups/chords" target="_blank" rel="noopener noreferrer">Cmaj7</a>.
            Optional <code>@[+|-]octave</code> and <code>*beats</code>. <code>R</code> or <code>rest</code> for silence.
          </p>
          <button
            type="button"
            className={styles.playButton}
            onClick={handleTogglePlay}
          >
            {isPlaying ? "Stop" : "Play"}
          </button>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="drum-beat">
              Drum Beat (K, S, H, -)
            </label>
            <input
              id="drum-beat"
              className={styles.input}
              value={drumBeatInput}
              onChange={(e) => setDrumBeatInput(e.target.value)}
              placeholder="K.H.S.H."
              aria-label="Drum beat pattern"
            />
          </div>

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
