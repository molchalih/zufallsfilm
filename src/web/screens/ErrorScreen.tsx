import type { Copy } from "../copy";

export function ErrorScreen({ copy, onBack }: { copy: Copy; onBack: () => void }) {
  return (
    <div className="error">
      <div className="error-row">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span className="error-code">{copy.code}</span>
          <span className="error-headline">{copy.headline}</span>
        </div>
        <button type="button" className="error-back" onClick={onBack}>
          pick a film instead →
        </button>
      </div>
    </div>
  );
}
