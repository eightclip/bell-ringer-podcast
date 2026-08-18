'use client';
import { useState, useEffect } from 'react';

const SHOWS = [
  { id: 'grade6', label: '6th Grade' },
  { id: 'grade7', label: '7th Grade' },
];

export default function Home() {
  const [pw, setPw] = useState('');
  const [week, setWeek] = useState('');
  const [text, setText] = useState({ grade6: '', grade7: '' });
  const [state, setState] = useState({ status: 'idle' });
  const [remembered, setRemembered] = useState(null); // null = still checking

  // Ask the server whether this device is already trusted. If it is, the
  // password field never appears again on this browser.
  useEffect(() => {
    fetch('/api/week')
      .then((r) => r.json())
      .then((d) => setRemembered(Boolean(d.remembered)))
      .catch(() => setRemembered(false));
  }, []);

  async function forget() {
    await fetch('/api/week', { method: 'DELETE' });
    setRemembered(false);
  }

  async function submit(e) {
    e.preventDefault();
    setState({ status: 'saving' });
    const res = await fetch('/api/week', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(pw ? { 'x-ingest-password': pw } : {}) },
      body: JSON.stringify({ week: week || undefined, ...text }),
    });
    const data = await res.json().catch(() => ({ error: 'server error' }));
    if (!res.ok) return setState({ status: 'error', message: data.error });
    setState({ status: 'saved', week: data.week, saved: data.saved });
    setText({ grade6: '', grade7: '' });
    setPw('');
    setRemembered(true); // the server just set the device cookie
  }

  return (
    <main className="admin">
      <header>
        <h1>Admin</h1>
        <p>Paste the teachers&rsquo; emails. Sunday night it becomes five episodes.</p>
      </header>

      <form onSubmit={submit}>
        <div className="row">
          {remembered === false && (
            <label>
              <span>Password</span>
              <input
                type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                required autoComplete="current-password"
              />
              <small>Just this once — this device stays signed in after.</small>
            </label>
          )}
          <label>
            <span>Week of</span>
            <input type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
            <small>Blank = next Monday</small>
          </label>
        </div>

        {SHOWS.map((k) => (
          <label key={k.id} className="block">
            <span>{k.label}</span>
            <textarea
              rows={9}
              placeholder={`Paste the ${k.label.toLowerCase()} lesson plan email. Subject, topics, vocabulary, whatever the teacher sent — it doesn't need tidying up.`}
              value={text[k.id]}
              onChange={(e) => setText({ ...text, [k.id]: e.target.value })}
            />
          </label>
        ))}

        <button disabled={state.status === 'saving'}>
          {state.status === 'saving' ? 'Saving…' : 'Save this week'}
        </button>

        {state.status === 'error' && <p className="err">{state.message}</p>}
        {state.status === 'saved' && (
          <p className="ok">
            Saved for the week of {state.week} — {state.saved.join(' and ')}.
            You can paste the other teacher&rsquo;s email later; it merges rather than replacing.
          </p>
        )}
      </form>

      <footer>
        {remembered && (
          <p>
            This device is signed in.{' '}
            <button type="button" className="link" onClick={forget}>Forget it</button>
          </p>
        )}
        <p>
          Every fact is checked against the page it came from before it&rsquo;s written.
          Anything that doesn&rsquo;t hold up gets cut. <a href="/">Back to the show</a>.
        </p>
      </footer>
    </main>
  );
}
