import { easeOutCubic, frameAt } from "../spin";
import { type AnimProps, posterBackground } from "./shared";

/**
 * The mildest of the five: a poster and a title flicking through the reel.
 * Its layout is the result screen's, so the switch at the end of the spin is
 * a content change rather than a transition — the title simply stops moving.
 *
 * The easing is cubic rather than quintic, and maps across the full reel: the
 * winner lands as the natural last tick instead of a runner-up lingering while
 * the real answer swaps in at the very end.
 */
export function Shuffle({ reel, t }: AnimProps) {
  const film = reel.tease[frameAt(reel.tease.length, t, easeOutCubic)] ?? reel.winner;
  return (
    <div className="result">
      <div className="poster" style={{ background: posterBackground(film.poster) }} />
      <div className="result-body">
        <div
          style={{
            fontSize: "clamp(38px,5.5vw,84px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 0.98,
            height: "2.05em",
            display: "flex",
            alignItems: "flex-start",
            overflow: "hidden",
          }}
        >
          <span>{film.name}</span>
        </div>
      </div>
    </div>
  );
}
