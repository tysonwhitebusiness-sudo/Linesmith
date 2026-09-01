'use client';

/**
 * The last-resort boundary — catches a throw in the root layout itself, which
 * `app/error.tsx` sits inside of and therefore cannot catch.
 *
 * It must render its own `<html>`/`<body>`: at this point the root layout is
 * the thing that failed, so nothing above this exists. That also means the
 * app's stylesheet may not have applied, which is why the few styles here are
 * inline literals rather than tokens — the one place in this codebase where
 * hard-coded colour is the correct call, since a token that resolves to
 * nothing would render invisible text on an unknown ground.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f4f5f6',
          color: '#16181c',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '420px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px' }}>Linesmith couldn&apos;t start</h1>
          <p style={{ fontSize: '14px', lineHeight: 1.5, color: '#4a4f57', margin: '0 0 20px' }}>
            The app hit an error before it could render. Reloading usually clears it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: 'none',
              borderRadius: '999px',
              background: '#141619',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 500,
              padding: '10px 20px',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p style={{ fontSize: '11px', color: '#8a9099', marginTop: '16px' }}>Ref: {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
