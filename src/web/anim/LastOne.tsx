import type { CSSProperties } from "react";
import { useMemo } from "react";
import {
  ELIM_CELLS,
  ELIM_COLS,
  type Elimination,
  eliminationOrder,
  mulberry32,
  smootherstep,
} from "../spin";
import { type AnimProps, cellFilm, posterBackground } from "./shared";

/** Everything is eliminated by this point; the remainder of the spin is the hold. */
const ELIM_SPAN = 0.86;
/** Cells about to go turn down slightly, which reads as a countdown. */
const WARNING_DEPTH = 5;

type Cell = { id: string; style: CSSProperties };

export function elimCells(props: AnimProps, order: Elimination): Cell[] {
  const eT = Math.min(1, props.t / ELIM_SPAN);
  const eliminated = Math.min(
    ELIM_CELLS - 1,
    Math.floor(smootherstep(eT) * (ELIM_CELLS - 1) + 0.0001),
  );
  const locked = props.t > 0.9;
  const cells: Cell[] = [];
  for (let i = 0; i < ELIM_CELLS; i++) {
    const isWinner = i === order.winnerCell;
    const film = cellFilm(props, order.winnerCell, i);
    const rank = order.rank[i] ?? ELIM_CELLS - 1;
    const out = !isWinner && rank < eliminated;
    const soon = !out && !isWinner && rank < eliminated + WARNING_DEPTH;
    const crowned = isWinner && locked;
    cells.push({
      id: `e${i}`,
      style: {
        position: "relative",
        aspectRatio: "2 / 3",
        background: out ? "var(--accent)" : posterBackground(film.poster),
        filter: out || crowned ? "none" : "grayscale(1) contrast(1.08)",
        transform: crowned ? "scale(1.6)" : soon ? "scale(0.9)" : undefined,
        zIndex: crowned ? 3 : 1,
        boxShadow: crowned ? "0 0 0 3px var(--bg), 0 18px 50px rgba(20,20,20,0.5)" : undefined,
        transition: "transform 500ms cubic-bezier(.2,.8,.2,1)",
      },
    });
  }
  return cells;
}

export function LastOne(props: AnimProps) {
  // Derived from the spin's seed, never from Math.random: the order has to
  // survive every re-render the spin causes, or the field re-scrambles.
  const order = useMemo(
    () => eliminationOrder(mulberry32(props.seed), ELIM_CELLS, ELIM_COLS),
    [props.seed],
  );
  return (
    <div className="elim">
      <div className="elim-grid">
        {elimCells(props, order).map((c) => (
          <div key={c.id} style={c.style} />
        ))}
      </div>
    </div>
  );
}
