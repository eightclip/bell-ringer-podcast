---
name: Something is broken
about: A reproduction beats a description
labels: bug
---

**What you ran**

```
npm run ...
```

**What happened** — the error, or the wrong output. Paste it rather than
summarising it; the exact wording is usually the clue.

**What you expected instead**

**Where it broke** — which stage: demo, research, script, voice, assemble,
publish, feed, or the site.

**Your setup**

- OS and Node version (`node --version`)
- `ffmpeg -version | head -1`
- Voice mode (`full-stock`, `hybrid`, `duo-hume`, `full-hume`)
- Roster: how many shows, which grades

**Before you post,** please check there is no API key, feed token, ingest
password, R2 URL or child's name in anything you pasted. Logs from this
pipeline print URLs and show ids freely.
