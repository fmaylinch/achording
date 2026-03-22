"use client";

import { useRef } from "react";
import styles from "../page.module.css";
import type { KnobProps } from "../types";
import { clamp, quantize } from "../utils/math";

export function Knob({
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
