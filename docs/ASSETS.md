# Fonts, music, and images

## What ships in this repo

| Asset | Licence | Redistributable |
|---|---|---|
| `assets/fonts/Anton-Regular.ttf` | SIL OFL 1.1 | yes |
| `assets/fonts/ArchivoBlack-Regular.ttf` | SIL OFL 1.1 | yes |
| `site/public/fonts/Rokkitt-*.woff2` | SIL OFL 1.1 | yes |
| Music | — | **none bundled** |
| Cover photography | — | **none bundled** |

Everything here is OFL on purpose, so a fresh clone renders correctly without
anyone having to buy anything.

## Adding your own display face

The artwork looks better with a hand-drawn, slightly irregular display face
than with Anton — it sits with archival source photography instead of fighting
it. If you own one:

1. Drop the `.ttf`/`.otf` in `assets/fonts/` and name it in `ART.titleFont`
   (`config/show.mjs`). Type is fitted to a box rather than set at a fixed
   point size, so any face and any title behave.
2. For the website, add the `.woff2` to `site/public/fonts/`, add an
   `@font-face` in `site/app/globals.css`, and point `--font-display` at it.

**Then add it to `.gitignore`.** Most commercial font EULAs prohibit
redistribution, and a public repo is redistribution. Webfont licences in
particular are often domain-scoped and do not survive someone forking you.

## Music

`music/{theme,sting,bed}/` is empty and gitignored. Drop MP3s in, then:

```bash
npm run music     # measures LUFS, loudness range, spectral centroid; sorts by role
```

It sorts by measurement rather than by filename, so tracks land in the right
slot without you tagging them.

Aim for **3–5 themes, 6–10 stings, 4–8 beds**. With one of each, the same
button plays five mornings running and the show starts to feel automated.

Two things worth knowing:

- **Avoid anything with a lead vocal.** A voice under a voice is unlistenable.
- **Do not commit the audio.** `*.mp3` is gitignored. A production-music
  subscription licenses you to *use* tracks in your show, essentially never to
  redistribute the source files from a public repository.

Blue Dot Sessions is free, CC-licensed, and close to the intended sound.

## Cover photography

With `UNSPLASH_ACCESS_KEY` set, `npm run art` pulls a source photo and applies
a duotone. Unsplash requires photographer attribution — the pipeline records it
and writes it into the episode notes automatically. Generated covers are
gitignored.

Episode art deliberately carries no type: a podcast app already prints the
title next to it, so a slab of display face over the top just covers the thing
worth looking at.
