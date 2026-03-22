"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import * as Tone from "tone";
import { Knob } from "./components/Knob";
import {
  oscillatorTypes,
  filterTypes,
  scaleRootNotes,
  scaleModes,
  defaultScaleRoot,
  defaultScaleMode,
  defaultGeneratorProbabilities,
  defaultGeneratorLength,
  type ScaleRootNote,
  type ScaleMode,
  type OscillatorType,
  type FilterType,
  type EnvelopeSettings,
  type OscillatorSettings,
  type FilterSettings,
  type GeneratorProbabilities,
  type SequenceEvent,
  type DrumStep,
} from "./types";
import { roll } from "./utils/math";
import {
  generateDiatonicChordProgression,
  convertRomanNumeralsToChordSymbols,
  convertProgressionNotation,
  parseInputNotation,
  parseSequenceEvents,
  parseDrumPattern,
} from "./utils/music";

export default function Home() {
  const [progression, setProgression] = useState(
    () =>
      `Chords: ${generateDiatonicChordProgression(
        defaultScaleRoot,
        defaultScaleMode,
        defaultGeneratorProbabilities,
        defaultGeneratorLength,
        1,
      )}`,
  );
  const [bpmInput, setBpmInput] = useState("120");
  const [beatsInput, setBeatsInput] = useState("2");
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
    const defaultBeats = Number.parseFloat(beatsInput);
    const defaultChordLengthBeats =
      Number.isFinite(defaultBeats) && defaultBeats > 0 ? defaultBeats : 1;
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
        defaultChordLengthBeats,
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
          <p className={styles.versionMeta}>v0.2 · Latest changes: respect default chord length</p>
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
                  max={32}
                  step={1}
                  value={generatorLength}
                  defaultValue={defaultGeneratorLength}
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
