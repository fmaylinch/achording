export type SequenceEvent = {
  durationBeats: number;
  notes: string[] | null;
};

export type InputNotation = "chords" | "notes";
export type DrumStep = "K" | "S" | "H" | "-";

export const oscillatorTypes = ["sine", "triangle", "sawtooth", "square"] as const;
export type OscillatorType = (typeof oscillatorTypes)[number];

export const filterTypes = ["lowpass", "highpass", "bandpass", "notch"] as const;
export type FilterType = (typeof filterTypes)[number];

export const scaleRootNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type ScaleRootNote = (typeof scaleRootNotes)[number];

export const scaleModes = ["Major", "Minor", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Locrian"] as const;
export type ScaleMode = (typeof scaleModes)[number];

export const chromaticScale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export const modeSemitoneSteps: Record<ScaleMode, number[]> = {
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
};

export const romanDegreeToIndex: Record<string, number> = {
  I: 0,
  II: 1,
  III: 2,
  IV: 3,
  V: 4,
  VI: 5,
  VII: 6,
};

export type EnvelopeSettings = {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
};

export type OscillatorSettings = {
  id: string;
  type: OscillatorType;
  volumeDb: number;
  detuneCents: number;
};

export type FilterSettings = {
  type: FilterType;
  frequency: number;
  q: number;
};

export type GeneratorProbabilities = {
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

export type KnobProps = {
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

export const defaultScaleRoot: ScaleRootNote = "C";
export const defaultScaleMode: ScaleMode = "Major";
export const defaultGeneratorProbabilities: GeneratorProbabilities = {
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
export const defaultGeneratorLength = 16;
