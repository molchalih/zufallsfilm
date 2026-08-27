import type { CSSProperties } from "react";
import { clamp01, frameAt } from "../spin";
import { type AnimProps, hashUnit, positionLabel, posterBackground } from "./shared";

/** Cuts across the whole spin. Sparse on purpose: this one is the quiet option. */
export const VOID_TICKS = 14;

export type VoidFrame = {
  title: string;
  index: string;
  dot: CSSProperties;
  poster: CSSProperties;
};

export function voidFrame(props: AnimProps): VoidFrame {
  const locked = props.t > 0.88;
  const tick = Math.floor(clamp01(props.t) * VOID_TICKS);
  const film = locked
    ? props.reel.winner
    : (props.reel.tease[frameAt(props.reel.tease.length, props.t, (x) => x)] ?? props.reel.winner);

  // Once locked the dot settles right of centre, where the eye already is.
  const x = locked ? 78 : 14 + hashUnit(film.lid, 3) * 70;
  const y = locked ? 50 : 16 + hashUnit(film.lid, 7) * 66;
  const size = locked ? 18 : 10;

  return {
    title: film.name,
    index: `#${positionLabel(props, film)} / ${props.total}`,
    dot: {
      position: "absolute",
      left: `${x}%`,
      top: `${y}%`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      background: "var(--accent)",
      transform: "translate(-50%,-50%)",
      transition:
        "left 600ms cubic-bezier(.6,0,.2,1), top 600ms cubic-bezier(.6,0,.2,1), width 400ms, height 400ms",
      zIndex: 3,
    },
    poster: {
      position: "absolute",
      right: "12%",
      top: "50%",
      width: "150px",
      aspectRatio: "2 / 3",
      transform: `translateY(-50%) rotate(${((tick % 3) - 1) * 2}deg)`,
      background: posterBackground(film.poster),
      border: "1px solid var(--hairline)",
      transition: "opacity 300ms",
    },
  };
}

export function Void(props: AnimProps) {
  const f = voidFrame(props);
  return (
    <div className="void">
      <div style={f.poster} />
      <div className="void-caption">
        <span className="void-title">{f.title}</span>
        <span className="void-index">{f.index}</span>
      </div>
      <div style={f.dot} />
    </div>
  );
}
