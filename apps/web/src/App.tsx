import { useEffect, useState } from 'react';

type Status = 'loading' | 'ok' | 'unavailable' | 'config-error';

const apiUrl = import.meta.env.VITE_API_URL;

// A browser app can't "crash at boot" the way a server process can - the
// closest equivalent to fail-fast here is refusing to silently fetch
// against `undefined` and instead surfacing the misconfiguration in the UI.
export default function App() {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    if (!apiUrl) {
      setStatus('config-error');
      return;
    }

    fetch(`${apiUrl}/readyz`)
      .then((res) => setStatus(res.ok ? 'ok' : 'unavailable'))
      .catch(() => setStatus('unavailable'));
  }, []);

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>SentinelOps</h1>
      {status === 'config-error' && (
        <p style={{ color: 'crimson' }}>Configuration error: VITE_API_URL is not set.</p>
      )}
      {status === 'loading' && <p>Checking API status...</p>}
      {status === 'ok' && <p style={{ color: 'green' }}>API ready</p>}
      {status === 'unavailable' && <p style={{ color: 'crimson' }}>API not ready</p>}
    </main>
  );
}
