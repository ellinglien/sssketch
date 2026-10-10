# bing bong: trade loops with a friend, one turn at a time

Elling, 2026-10-10. Brainstormed in chat. Status: design agreed, write-up approved; next is a plan.

> "how about a game where the game is to build from a loop that the other created, but kind of like
> words with friends.. like a whenever you have time thing.. so it's a 1 for 1 project sharing game
> within sssketch"

> "if a stem doesnt change it would save the storage and just note it you know?"

> "i dont want to maintain anything for others"

> "no need to call it a game, bing bong is enough"

## Words

- **bing bong** is the feature's name (a doorbell: a turn has arrived). Lowercase in the UI. Never
  "bing bong game", and the UI doesn't call it a game.
- **A bing bong** is one running exchange: two players trading one loop back and forth
  ("start a bing bong with ben").
- A **turn** is one riff a player makes from the last one and hands over.
- The **folder** is the shared folder a bing bong lives in (Google Drive for desktop, or
  Dropbox/iCloud), which both players can read and write.
- The **bing bong sketch** is the sketch project each player's sssketch builds from the turns. It
  is where the archive lives and how the whole exchange is played back.
- The **doorbell** is how the other player hears a turn is waiting: an email.

## Decisions

1. **Two players, strictly alternating.** The file format records each turn's parent, so chains
   and more players stay possible later without a format change.
2. **Free play.** A turn may change anything about the loop: add, swap, remove, re-level, mute.
3. **A turn is one riff.** The turns, laid end to end, are the bing bong sketch: press play and
   hear the whole back-and-forth; export it to Ableton/REAPER like any sketch.
4. **The bing bong sketch is a sketch project, with boundaries.** Past turns are locked. Only the
   player whose turn it is can edit, and only the new riff at the end.
5. **A turn is taken in Cross**, then an optional edit pass in Sketch/Arrange, then a one-line chat
   message, then **end turn**.
   - Left column: the turn they just sent.
   - Center: your new riff, starting as a copy of theirs.
   - Right column: what you bring: **your last turn**, **a riff from the shelf**, or **nothing**.
     Discover is already in Cross's center ("add a stem that is:"), so it needs no column.
6. **No server.** Turns travel through the shared folder. Nothing Elling runs is involved, except
   that he and Ben happen to send email through RPM's SES (decision 8).
7. **The shared folder only ever gets new files.** Nothing in it is overwritten by two people, so
   Drive can't make conflict copies of shared state. Each Mac rebuilds its bing bong sketch
   locally.
8. **Doorbell = email through the sender's own SMTP**, with presets for Gmail and iCloud app
   passwords. No SMTP set up: fall back to a prefilled draft in the user's mail app. Elling and Ben
   use a dedicated RPM SES SMTP user restricted to `bingbong@rpmchallenge.com`.
9. **Fully integrated into sssketch**, not an add-on.
10. **sssketchy is the courier and host.** He delivers turns, says what changed, carries the chat
    line, nudges gently, and marks milestones. He never makes a move.
11. **Players are identified by Endlesss username**, which sssketch already knows
    (`src/main/ownUsernameStore.ts`). Someone with no username types a display name once.

## How a bing bong goes

1. **Start.** Elling selects a riff → `start a bing bong…` → picks (or creates) a folder in his
   shared Drive → types Ben's name and email. That riff becomes turn 1. sssketch writes the folder
   and rings Ben's doorbell.
2. **Join.** Ben gets an email from Elling's address: "elling started a bing bong with you". It
   says: share the folder, then in Drive add it to My Drive (a folder only "shared with me" does
   not sync to the Mac), then pick the folder from `bing bong → join a bing bong…`. Ben's sssketch
   writes `players/<ben>.json` with his email. (If Elling has no SMTP set up, this invite goes as
   a `mailto:` draft he sends himself, like any doorbell.)
3. **Play.** Ben's sssketch builds the bing bong sketch from the turns. sssketchy walks on with an
   envelope and says what's in it. Ben opens his turn in Cross, builds, optionally edits, types a
   line, presses end turn. Elling's doorbell rings.
4. **And so on**, whenever either of them has time.

## The folder

```
<shared drive>/bing bong/elling-and-ben/
  bingbong.json                 written once, by the player who started it
  players/elling.json           written only by elling (may be rewritten by elling alone)
  players/ben.json              written only by ben
  turns/0001-elling.json        one immutable file per turn
  turns/0002-ben.json
  audio/<contentId>.<ext>       each audio file once, named by its content id
```

The rule that makes Drive safe: **every file has exactly one writer**, and turn and audio files
are never rewritten at all. A file Drive renames as a conflict copy (`… (1).json`) is ignored.

### bingbong.json

```json
{
  "format": "bingbong/1",
  "id": "bb_7f3k9q2x",
  "name": "elling-and-ben",
  "createdAt": "2026-10-10T14:02:11Z",
  "createdBy": "elling",
  "players": [
    { "username": "elling" },
    { "username": "ben", "inviteEmail": "ben@example.com" }
  ]
}
```

### players/<username>.json

```json
{
  "format": "bingbong-player/1",
  "username": "ben",
  "displayName": "ben",
  "email": "ben@example.com"
}
```

The email here is where the other player's doorbell sends. `inviteEmail` in `bingbong.json` is
used only until this file exists.

### turns/NNNN-<username>.json

```json
{
  "format": "bingbong-turn/1",
  "bingBong": "bb_7f3k9q2x",
  "turn": 7,
  "parent": 6,
  "player": "elling",
  "playedAt": "2026-10-12T21:40:03Z",
  "chat": "wonky bass, sorry",
  "riff": {
    "name": "turn 7",
    "bpm": 92,
    "barLength": 8,
    "stems": [
      {
        "slot": 0,
        "audio": "sha256-3b1f…",
        "ext": "ogg",
        "author": "rowan",
        "name": "drums",
        "type": "drums",
        "durationSec": 20.87,
        "barLength": 8,
        "gain": 0.8,
        "muted": false,
        "creationTime": 1712345678
      }
    ]
  },
  "audioAdded": ["sha256-9c02…"]
}
```

- `chat` is at most 140 characters, single line.
- `audio` names the file actually heard: the materialised (re-oned) copy, not a source plus an
  offset. The receiver needs no phase rebuild, and the turn sounds identical on both Macs.
- `audioAdded` lists the files this turn put in `audio/`. Everything else the riff uses was
  already there: unchanged stems are noted, not copied.
- Turn files are named `NNNN-<username>.json` with four digits, so a listing sorts in play order.

### Audio

- Every audio file a turn uses is copied into `audio/` **once**, the first time any turn uses it,
  named by its content id. A turn that only remixes adds no audio at all.
- Copying Endlesss stems too (rather than referencing them by StemCID and letting the other
  player's sssketch download them) keeps a bing bong playable if Endlesss is unreachable and
  doesn't depend on the other player's library. The cost is one copy per new stem, which is the
  "note it, don't resend it" saving Elling asked for. Reference-only Endlesss stems can be added
  later if storage ever matters.
- Content id: `sha256-<hex>` of the file's bytes. For an Endlesss stem whose cache file is already
  named by StemCID, the id is still the hash, so one rule covers every source.

## The bing bong sketch

- Each player's sssketch keeps a local project per bing bong, a library sketch named
  `bingbong-<name>`, never in the shared folder.
- New turns are appended as they appear in `turns/`: turn N's riff after everything placed, each
  riff **locked**. Gains and mutes come from the turn record. Appending a turn reaches every undo
  step, so no undo takes a turn away.
- The project carries a `bingBong` block (`id`, `folderPath`, `me`, `lastTurnSeen`, and the
  draft of the current turn if it's mine). `PersistedProject` (`src/renderer/src/state/serialize.ts`)
  grows this optional field; projects without it are unaffected.
- Whose turn: the player who didn't play the latest turn. With no turns yet, the creator.
- When it isn't my turn, the bing bong sketch opens read-only with a quiet line: "waiting for
  ben". Play, solo, map view and every export still work.

## Taking a turn

1. **Open in Cross.** From sssketchy's envelope or the bing bong bar's `take your turn`. Left:
   their latest turn. Center: a copy of it. Right: what you bring (your last turn, a shelf riff,
   or nothing). Cross's existing tools all work: audition per column, move stems in, add a stem
   from Discover, mute/solo/gain, undo/redo, preview tempo.
2. **Edit pass (optional).** `done in cross` places the draft riff at the end of the bing bong
   sketch, unlocked, for normal Sketch/Arrange edits on that riff only (downbeat, length, levels).
3. **Chat line.** One line, optional, 140 characters, in the end-turn dialog.
4. **End turn** writes, in this order, so the other player never reads a turn whose audio isn't
   there yet:
   1. each new audio file to `audio/` (temp name, then rename; skip any whose id already exists)
   2. `turns/NNNN-<me>.json` (temp name, then rename)
   3. the doorbell
   4. the local bing bong sketch: the draft riff becomes locked turn N.
   If a step fails, nothing after it runs and the user sees which step and why. A turn file that
   exists has, by construction, all its audio written first. Retrying end turn resumes: audio
   already present is skipped. A failed doorbell doesn't undo the turn; it offers the `mailto:`
   draft instead.

## Receiving a turn

- While sssketch is open it polls each bing bong folder it knows about (every 30 s, and on window
  focus) for new turn files. When it's closed, the email is the notice; the turn is picked up at
  the next launch.
- A turn file whose audio hasn't all synced yet is **pending**: sssketchy says "ben's turn is on
  its way" and the bing bong sketch isn't rebuilt until every `audio` it names exists. Drive for
  desktop's stream mode can show a file before its bytes arrive. Reading it triggers the
  download, so pending clears on its own.
- On arrival: the doorbell sound, a macOS notification, sssketchy with the envelope, and the bing
  bong's entry in the `bing bong` menu shows `your turn`.
- A turn file that breaks the rules is shown, not applied. A gap, an unreadable file or a wrong
  parent stops there: "turn 8 is here but turn 7 isn't yet. waiting for it." A file from the
  player whose turn it wasn't is reported and skipped, and never blocks the real turn: only one
  player may write each turn number, and the file name says who wrote it, so two valid files for
  one turn can't exist.

## The doorbell

- **Settings → bing bong → email:** host, port, security, username, password, from address, and
  `send test`. Presets: Gmail (`smtp.gmail.com:587`, app password), iCloud
  (`smtp.mail.me.com:587`, app-specific password), custom.
- The password is encrypted with Electron `safeStorage`, as the Endlesss session already is
  (`src/main/endlesssApi.ts`). It never goes in a shared folder.
- Sent from the main process with nodemailer (new dependency) to the other player's
  `players/<them>.json` email.
- **Message:** subject `bing bong: elling played turn 7`. Body: the chat line, sssketchy's
  one-line summary of what changed, and "open sssketch to play". Plain text plus a small HTML
  version with sssketchy's sprite. Never any audio.
- **No SMTP configured:** end turn opens a `mailto:` draft with the same subject and body in the
  user's own mail app. The turn is written either way: the doorbell never blocks a turn.
- **Elling and Ben:** a new SES SMTP IAM user for bing bong only, with an IAM policy condition
  limiting `ses:FromAddress` to `bingbong@rpmchallenge.com`, so the shared credential can't send
  as anything else at RPM and can be revoked on its own.

## sssketchy

- **Delivers.** A turn arrives: he walks on with an envelope. Clicking it opens the turn in Cross.
- **Says what changed**, from a plain diff of the two riffs' stems by content id and gain:
  "ben swapped your bass and added a shaker. kept your drums."
- **Carries the chat line** in his speech bubble.
- **Nudges gently, only in-app:** after 4 days waiting on me, "ben's been waiting 4 days." After
  4 days waiting on them, an offer: "send ben a poke?", which rings their doorbell once (at most
  once a day).
- **Marks milestones** the way he marks guided-flow steps: turn 10, the first recorded take in a
  bing bong, the bing bong sketch passing 3 minutes.
- **Never plays a move**, and never suggests one unless asked.

## Prep work in sssketch

Each item stands on its own and is useful without bing bong:

1. **A content id for audio.** `contentIdForFile(path)` (sha256, cached by path + mtime + size)
   in `src/main/`. Used by bing bong's audio dedupe.
2. **Locked riffs.** An optional `locked` flag on a riff. It plays and solos, but any action that
   would move, resize, edit or delete it (a whole batch included) is refused, and a notice says
   why: "that's a past turn, so it's locked."
3. **Cross opens from any setup.** `openCrossFromRiffs` can pre-fill the center from the left riff
   and swap add to shelf / add to timeline for one button (`done in cross`).

Plan: `docs/superpowers/plans/2026-10-10-bing-bong-1-foundations.md`; the core is
`2026-10-10-bing-bong-2-core.md`.

## The bing bong menu

- A `bing bong` button in the project menu row: `start a bing bong…` (from the selected riff),
  `join a bing bong…`, then (plan 4) the list of bing bongs (each: the other player, turn count,
  `your turn` / `waiting for ben` / `ben's turn is on its way`), and settings (email, plan 3).

## Testing

- **Pure rules in `src/shared/`, test-first, like the rest of the codebase:** whose turn, turn
  validation (order, gaps, duplicates, wrong player), rebuild from turn files to project, the
  stem diff behind sssketchy's summary, chat line limits, end-turn step ordering and resume.
- **Main-process tests** with a temp directory as the shared folder: two simulated players taking
  turns, audio dedupe (a remix turn writes no audio), pending turns whose audio arrives later,
  conflict-copy files ignored, a failed write mid end-turn resumes cleanly.
- **Doorbell:** SMTP sending tested against a fake transport. The mailto fallback is built from
  the same message.
- **By hand (Elling and Ben):** a real bing bong over a real shared Drive folder, on two Macs,
  with the RPM SES user. No agent can hear audio or see a phone.

## Later, not now

- Phone push (e.g. ntfy.sh topics). Email covers the doorbell for now.
- More than two players, round-robin.
- Chain letters: anyone holding the folder plays next, so history can branch (the `parent` field
  is there for this).
- A server or other backends behind the same "shared folder" interface (GitHub repo,
  Cloudflare R2).
- Referencing Endlesss stems by StemCID instead of copying them.
- Collect all and save: copy every audio file a sketch uses beside it, for moving it to another
  Mac.
- Recording how many bars a turn plays (today each turn plays its loop once in the sketch).
- Scoring.
