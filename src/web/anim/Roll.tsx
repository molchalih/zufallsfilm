import { easeOutQuint, formatYear } from "../spin";
import { type AnimProps, positionLabel } from "./shared";

export const ROW_HEIGHT = 64;
/** Rows above the gate: two of five in the window, so the strip reads as a strip. */
export const GATE_OFFSET = 128;

/** Rows past the winner, so the strip runs off the bottom instead of ending. */
export const OVERSCROLL = 4;

type Row = { id: string; num: string; title: string; year: string };

/**
 * The strip is laid out once and only translated, so the browser animates a
 * single transform instead of re-flowing ninety rows every frame. It runs a
 * few rows past the winner: a strip that stops dead at the gate reads as a
 * list that ran out, not as a reel that was stopped.
 */
export function rollRows(props: AnimProps): Row[] {
  const pool = props.pool.length > 0 ? props.pool : [props.reel.winner];
  const trailing = Array.from(
    { length: OVERSCROLL },
    (_, i) => pool[(props.seed + i) % pool.length],
  );
  return [...props.reel.tease, ...trailing].map((f, i) => ({
    id: `${i}:${f.lid}`,
    num: positionLabel(props, f),
    title: f.name,
    year: formatYear(f.year),
  }));
}

/** Pixels the strip is translated by, so that frame `n-1` lands on the gate. */
export function rollOffset(frames: number, t: number): number {
  return GATE_OFFSET - easeOutQuint(t) * (frames - 1) * ROW_HEIGHT;
}

export function Roll(props: AnimProps) {
  const rows = rollRows(props);
  return (
    <div className="roll">
      <div className="roll-window">
        <div
          style={{
            // Offset is driven by the reel, not the row count: the overscroll
            // rows exist to be scrolled past, never to be landed on.
            transform: `translateY(${rollOffset(props.reel.tease.length, props.t)}px)`,
            willChange: "transform",
          }}
        >
          {rows.map((r) => (
            <div className="roll-row" key={r.id}>
              <span className="roll-num">{r.num}</span>
              <span className="roll-title">{r.title}</span>
              <span className="roll-year">{r.year}</span>
            </div>
          ))}
        </div>
        <div className="roll-gate" />
      </div>
    </div>
  );
}
