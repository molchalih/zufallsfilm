import type { CSSProperties } from "react";
import { interiorCell, padIndex } from "../spin";
import { type AnimProps, cellFilm, posterBackground } from "./shared";

export const MONTAGE_COLS = 14;
/** Eight rows. Past that the cells are too small to read as posters. */
export const MONTAGE_MAX_CELLS = MONTAGE_COLS * 8;
/**
 * Five rows, tiling the pool when it is shorter. The grid divides the stage by
 * its row count, so a 21-film watchlist laid out in two rows produces cells
 * three times taller than a poster, and `cover` crops away the whole image.
 */
export const MONTAGE_MIN_CELLS = MONTAGE_COLS * 5;
/** Frames the cursor visits. The design's cut rate, not a display rate. */
export const MONTAGE_TICKS = 36;

type Cell = { id: string; style: CSSProperties };

export type MontageFrame = {
  cells: Cell[];
  title: string;
  titleStyle: CSSProperties;
  hLine: CSSProperties;
  vLine: CSSProperties;
  tick: string;
  coord: string;
};

/**
 * A glitching contact sheet. Every cell is decided from the tick number and
 * its own index, so the disturbances — inversions, accent flashes, dropouts —
 * are stable within a tick and re-roll on the next one.
 */
export function montageFrame(props: AnimProps): MontageFrame {
  const count = Math.min(Math.max(props.pool.length, MONTAGE_MIN_CELLS), MONTAGE_MAX_CELLS);
  const rows = Math.ceil(count / MONTAGE_COLS);
  const winnerCell = interiorCell(props.seed % count, count, MONTAGE_COLS);
  const tick = Math.floor(props.t * MONTAGE_TICKS);
  const locked = props.t > 0.9;
  const cursor = locked ? winnerCell : (Math.imul(tick + 1, 2654435761) >>> 0) % count;
  // The last fifth fades everything but the winner, which grows through it.
  const endT = Math.max(0, (props.t - 0.8) / 0.2);
  const cursorFilm = cellFilm(props, winnerCell, cursor);

  const cells: Cell[] = [];
  for (let i = 0; i < count; i++) {
    const film = cellFilm(props, winnerCell, i);
    const h = (((i + 1) * 2654435761 + tick * 104729) % 1000) / 1000;
    const isCursor = i === cursor;
    const isWinner = locked && i === winnerCell;
    let filter = "grayscale(1) contrast(1.15)";
    let background = posterBackground(film.poster);
    let opacity = 1;
    if (h < 0.07) filter = "invert(1)";
    else if (h < 0.11) {
      background = "var(--accent)";
      filter = "none";
    } else if (h > 0.93) opacity = 0.12;
    if (isCursor) {
      filter = "none";
      opacity = 1;
    }
    if (endT > 0 && !isWinner) opacity *= 1 - endT;
    cells.push({
      id: `m${i}`,
      style: {
        position: "relative",
        background,
        filter: isWinner ? "none" : filter,
        opacity: isWinner ? 1 : opacity,
        transform: isWinner ? `scale(${1 + endT * 1.4})` : isCursor ? "scale(1.05)" : undefined,
        zIndex: isWinner ? 3 : isCursor ? 2 : 1,
        boxShadow: isCursor || isWinner ? "0 0 0 2px var(--accent)" : undefined,
      },
    });
  }

  const cr = Math.floor(cursor / MONTAGE_COLS);
  const cc = cursor % MONTAGE_COLS;
  return {
    cells,
    title: (locked ? props.reel.winner.name : cursorFilm.name).toUpperCase(),
    titleStyle: {
      transform: `rotate(${((tick % 3) - 1) * 1.5}deg)`,
      opacity: tick % 6 === 5 && props.t < 0.85 ? 0 : 1,
    },
    hLine: {
      position: "absolute",
      left: 0,
      right: 0,
      top: `${((cr + 0.5) / rows) * 100}%`,
      height: "1px",
      background: "var(--accent)",
      zIndex: 4,
      pointerEvents: "none",
    },
    vLine: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: `${((cc + 0.5) / MONTAGE_COLS) * 100}%`,
      width: "1px",
      background: "var(--accent)",
      zIndex: 4,
      pointerEvents: "none",
    },
    tick: `FR ${String(tick).padStart(3, "0")} / ${String(MONTAGE_TICKS).padStart(3, "0")}`,
    coord: `R${padIndex(cr, rows)} · C${padIndex(cc, MONTAGE_COLS)}`,
  };
}

export function Montage(props: AnimProps) {
  const f = montageFrame(props);
  return (
    <div className="montage">
      <div className="montage-grid">
        {f.cells.map((c) => (
          <div key={c.id} style={c.style} />
        ))}
      </div>
      <div style={f.hLine} />
      <div style={f.vLine} />
      <div className="montage-title-layer">
        <span className="montage-title" style={f.titleStyle}>
          {f.title}
        </span>
      </div>
      <div className="montage-ticker">
        <span>{f.tick}</span>
        <span>{f.coord}</span>
      </div>
    </div>
  );
}
