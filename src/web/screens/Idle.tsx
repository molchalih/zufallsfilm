import type { Copy } from "../copy";

export type IdleProps = {
  username: string;
  onUsername: (value: string) => void;
  onSubmit: () => void;
  onSurprise: () => void;
  busy: boolean;
  /**
   * The service's verdict on this name, shown here rather than on its own
   * page. Null until a name is refused, and cleared by the next keystroke.
   */
  rejection: Copy | null;
};

export function Idle({ username, onUsername, onSubmit, onSurprise, busy, rejection }: IdleProps) {
  const rejected = rejection !== null;
  return (
    <div className="idle">
      <div className="idle-inner">
        <div className={rejected ? "field field-rejected" : "field"}>
          <span className="field-at" aria-hidden="true">
            @
          </span>
          <input
            className="field-input"
            value={username}
            onChange={(e) => onUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
            placeholder="letterboxd username"
            aria-label="letterboxd username"
            // Colour alone is not an error message to a screen reader.
            aria-invalid={rejected}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="button button-primary"
            onClick={onSubmit}
            disabled={busy}
          >
            {busy ? "· · ·" : "pick a film →"}
          </button>
        </div>
        {rejection ? (
          // The same slot the link occupies, so nothing moves. The marked field
          // carries the alarm; this carries which of the five reasons it was.
          <p className="rejection" role="alert">
            {rejection.headline}
          </p>
        ) : (
          <button type="button" className="link-quiet" onClick={onSurprise} disabled={busy}>
            or go completely random
          </button>
        )}
      </div>
    </div>
  );
}
