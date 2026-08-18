# Music

Drop MP3s into `_inbox/` and run:

```bash
npm run music
```

It measures each track (LUFS, loudness range, spectral centroid) and files it
as a **theme**, **sting**, or **bed** by what it actually sounds like rather
than by filename. Re-run `npm run assemble <show> <week>` to hear a change —
nothing else needs touching.

Target **3–5 themes, 6–10 stings, 4–8 beds**. With one of each, the same button
plays five mornings running.

Two rules:

- **No lead vocals.** A voice under a voice is unlistenable.
- **Nothing here is committed.** `*.mp3` is gitignored. Your production-music
  licence almost certainly permits use in the show and not redistribution from
  a public repo.

Blue Dot Sessions is free, CC-licensed, and close to the intended sound.

The pipeline renders with silent breaks of the correct length if these folders
are empty, so timing stays right and you can add music later.
