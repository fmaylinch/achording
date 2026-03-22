import * as Tone from "tone";
import { Chord, Note } from "@tonaljs/tonal";
import {
  chromaticScale,
  modeSemitoneSteps,
  romanDegreeToIndex,
  type DrumStep,
  type GeneratorProbabilities,
  type InputNotation,
  type ScaleMode,
  type ScaleRootNote,
  type SequenceEvent,
} from "../types";
import { clamp, quantize, roll } from "./math";

export function getChordPitchClasses(symbol: string): string[] | null {
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

export function toPlayableChord(chordSymbol: string, baseOctave: number): string[] {
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

export function extractCompactNoteParts(symbol: string): string[] | null {
  const compactSymbol = symbol.replace(/\s+/g, "");
  if (!compactSymbol) return null;

  const noteParts = compactSymbol.match(/[A-Ga-g](?:#|b)?/g);
  if (!noteParts || noteParts.join("") !== compactSymbol) return null;
  return noteParts;
}

export function toPlayableNotes(noteSymbol: string, baseOctave: number): string[] {
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

export function parseInputNotation(progression: string): { notation: InputNotation; content: string } {
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

export function convertProgressionNotation(progression: string): string | null {
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

export function resolveOctaveSpec(currentOctave: number, octaveSpec: string): number | null {
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

export function parseSequenceEvents(progression: string, defaultBeats: number): SequenceEvent[] {
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

export function generateDiatonicChordProgression(
  root: ScaleRootNote,
  mode: ScaleMode,
  probabilities: GeneratorProbabilities,
  progressionLengthBeats: number,
  defaultChordLengthBeats: number,
): string {
  const minChordLengthBeats = 0.25;
  const maxChordLengthBeats = 4;
  const durationStepBeats = 0.25;
  const rootIndex = chromaticScale.indexOf(root);
  const scaleNotes = modeSemitoneSteps[mode].map((step) => chromaticScale[(rootIndex + step) % 12]);
  const allDegrees = [0, 1, 2, 3, 4, 5, 6];
  const usedDegrees: number[] = [];
  const normalizedLengthBeats = clamp(Math.round(progressionLengthBeats), 1, 16);
  const normalizedLengthVariation = clamp(probabilities.lengthVariation, 0, 100);
  const normalizedChordVariation = clamp(probabilities.chordVariation, 0, 100);
  const normalizedDefaultChordLengthBeats = clamp(
    quantize(defaultChordLengthBeats, minChordLengthBeats, durationStepBeats),
    minChordLengthBeats,
    maxChordLengthBeats,
  );

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

    let durationBeats = normalizedDefaultChordLengthBeats;
    if (normalizedLengthVariation > 0) {
      const variationScale = normalizedLengthVariation / 100;
      const shouldVaryDuration = Math.random() < variationScale;
      if (shouldVaryDuration) {
        const direction = Math.random() < 0.5 ? -1 : 1;
        const maxDirectionalDelta =
          direction < 0
            ? normalizedDefaultChordLengthBeats - minChordLengthBeats
            : maxChordLengthBeats - normalizedDefaultChordLengthBeats;
        const randomDirectionalDelta = Math.random() * maxDirectionalDelta * variationScale;
        durationBeats = clamp(
          quantize(
            normalizedDefaultChordLengthBeats + randomDirectionalDelta * direction,
            minChordLengthBeats,
            durationStepBeats,
          ),
          minChordLengthBeats,
          maxChordLengthBeats,
        );
      }
    }

    if (durationBeats > remainingBeats) {
      durationBeats = remainingBeats;
    }
    accumulatedBeats += durationBeats;
    chordSymbols.push(`${chordSymbol}*${formatDuration(durationBeats)}`);
  }

  return chordSymbols.join(", ");
}

export function convertRomanNumeralsToChordSymbols(
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

export function parseDrumPattern(pattern: string): DrumStep[] | null {
  const compact = pattern.replace(/\s+/g, "").toUpperCase();
  if (!compact) return [];
  if (!/^[KSH-]+$/.test(compact)) return null;
  return compact.split("") as DrumStep[];
}
