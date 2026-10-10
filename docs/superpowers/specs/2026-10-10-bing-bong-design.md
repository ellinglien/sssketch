# bing bong: trade loops with a friend, one turn at a time

Elling, 2026-10-10. Brainstormed in chat. Status: design agreed, awaiting his review of this
write-up before a plan.

> "how about a game where the game is to build from a loop that the other created, but kind of like
> words with friends.. like a whenever you have time thing.. so it's a 1 for 1 project sharing game
> within sssketch"

> "if a stem doesnt change it would save the storage and just note it you know?"

> "i dont want to maintain anything for others"

## Words

- **bing bong** is the feature's name (a doorbell: a turn has arrived). Lowercase in the UI.
- A **game** is two players trading one loop back and forth.
- A **turn** is one riff a player makes from the last one and hands over.
- The **game folder** is a shared folder (Google Drive for desktop, or Dropbox/iCloud) both players
  can read and write.
- The **game sketch** is the sketch project each player's sssketch builds from the turns. It is
  where the archive lives and how the game is played back.
- The **doorbell** is how the other player hears a turn is waiting: email, optional phone push.

## Decisions

1. **Two players, strictly alternating.** The file format records each turn's parent, so chains
   and more players stay possible later without a format change.
2. **Free play.** A turn may change anything about the loop: add, swap, remove, re-level, mute.
3. **A turn is one riff.** The game's turns, laid end to end, are the game sketch: press play and
   hear the whole back-and-forth; export it to Ableton/REAPER like any sketch.
4. **The game is a sketch project, with boundaries.** Past turns are locked. Only the player whose
   turn it is can edit, and only the new riff at the end.
5. **A turn is taken in Cross**, then an optional edit pass in Sketch/Arrange, then a one-line chat
   message, then **end turn**.
   - Left column: the turn they just sent.
   - Center: your new riff, starting as a copy of theirs.
   - Right column: switchable between **a riff of yours** (shelf/library) and **Discover**.
6. **No server.** Turns travel through the shared game folder. Nothing Elling runs is involved,
   except that he and Ben happen to send email through RPM's SES (decision 8).
7. **The shared folder only ever gets new files.** Nothing in it is overwritten by two people, so
   Drive can't make conflict copies of game state. Each Mac rebuilds its game sketch locally.
8. **Doorbell = email through the sender's own SMTP**, with presets for Gmail and iCloud app
   passwords. No SMTP set up: fall back to a prefilled draft in the user's mail app. Elling and Ben
   use a dedicated RPM SES SMTP user restricted to `bingbong@rpmchallenge.com`.
9. **Optional phone push via ntfy.sh**, one private random topic per player, scanned once by QR.
10. **Fully integrated into sssketch**, not an add-on.
11. **sssketchy is the courier and host.** He delivers turns, says what changed, carries the chat
    line, nudges gently, and marks milestones. He never makes a move.
12. **Players are identified by Endlesss username**, which sssketch already knows
    (`src/main/ownUsernameStore.ts`). Someone with no username types a display name once.

## How a game goes

1. **Start.** Elling selects a riff → `start a bing bong game…` → picks (or creates) a folder in
   his shared Drive → types Ben's name and email. That riff becomes turn 1. sssketch writes the
   game folder, offers the ntfy QR code, and rings Ben's doorbell.
2. **Join.** Ben gets an email from Elling's address: "elling started a bing bong game with you".
   It says: share the folder, then in Drive add it to My Drive (a folder only "shared with me"
   does not sync to the Mac), then pick the folder from `bing bong → join a game…`. Ben's
   sssketch writes `players/<ben>.json` with his email. (If Elling has no SMTP set up, this
   invite goes as a `mailto:` draft he sends himself, like any doorbell.)
3. **Play.** Ben's sssketch builds the game sketch from the turns. sssketchy walks on with an
   envelope and says what's in it. Ben opens his turn in Cross, builds, optionally edits, types
   a line, presses end turn. Elling's doorbell rings.
4. **And so on**, whenever either of them has time.

## The game folder

```
<shared drive>/bing bong/elling-vs-ben/
  game.json                     written once, by the player who started the game
  players/elling.json           written only by elling (may be rewritten by elling alone)
  players/ben.json              written only by ben
  turns/0001-elling.json        one immutable file per turn
  turns/0002-ben.json
  audio/<contentId>.<ext>       each audio file once, named by its content id
```

The rule that makes Drive safe: **every file has exactly one writer**, and turn and audio files
are never rewritten at all. A file Drive renames as a conflict copy (`… (1).json`) is ignored.

### game.json

```json
{
  "format": "bingbong-game/1",
  "id": "bb_7f3k9q2x",
  "name": "elling-vs-ben",
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
  "email": "ben@example.com",
  "ntfyTopic": "bingbong-ben-4h8w1c7r2m9q",
  "chatInNotifications": true
}
```

The email here is where the other player's doorbell sends. `inviteEmail` in `game.json` is used
only until this file exists.

### turns/NNNN-<username>.json

```json
{
  "format": "bingbong-turn/1",
  "game": "bb_7f3k9q2x",
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
  player's sssketch download them) keeps a game playable if Endlesss is unreachable and doesn't
  depend on the other player's library. The cost is one copy per new stem, which is the
  "note it, don't resend it" saving Elling asked for. Reference-only Endlesss stems can be added
  later if storage ever matters.
- Content id: `sha256-<hex>` of the file's bytes. For an Endlesss stem whose cache file is already
  named by StemCID, the id is still the hash, so one rule covers every source.

## The game sketch

- Each player's sssketch keeps a local project per game, in the sketch library
  (`~/Music/sssketch/games/<game name>.sssketchproj`), never in the shared folder.
- It is rebuilt from `turns/` whenever a new turn file appears: turn N's riff placed after turn
  N-1, each riff **locked**. Gains and mutes come from the turn record.
- The project carries a `bingBong` block (`gameId`, `folderPath`, `me`, `lastTurnSeen`, and the
  draft of the current turn if it's mine). `PersistedProject` (`src/renderer/src/state/serialize.ts`)
  grows this optional field; projects without it are unaffected.
- Whose turn: the player who didn't play the latest turn. With no turns yet, the creator.
- When it isn't my turn, the game sketch opens read-only with a quiet line: "waiting for ben".
  Play, solo, map view and every export still work.

## Taking a turn

1. **Open in Cross.** From sssketchy's envelope, the game's `your turn` button, or the riff's
   inspector. Left: their latest turn. Center: a copy of it. Right: `riff` / `discover` switch.
   Cross's existing tools all work: audition per column, move stems in, generate matching stems,
   mute/solo/gain, undo/redo, preview tempo.
2. **Edit pass (optional).** `done in cross` places the draft riff at the end of the game sketch,
   unlocked, for normal Sketch/Arrange edits on that riff only (downbeat, length, levels).
3. **Chat line.** One line, optional, 140 characters, in the end-turn dialog.
4. **End turn** writes, in this order, so the other player never reads a turn whose audio isn't
   there yet:
   1. each new audio file to `audio/` (temp name, then rename; skip any whose id already exists)
   2. `turns/NNNN-<me>.json` (temp name, then rename)
   3. the doorbell (email, then ntfy if set)
   4. the local game sketch: the draft riff becomes locked turn N.
   If a step fails, nothing after it runs and the user sees which step and why. A turn file that
   exists has, by construction, all its audio written first. Retrying end turn resumes: audio
   already present is skipped.

## Receiving a turn

- While sssketch is open it polls each game folder it knows about (every 30 s, and on window
  focus) for new turn files, and listens on the player's own ntfy topic if one is set, which
  makes the arrival immediate.
- A turn file whose audio hasn't all synced yet is **pending**: sssketchy says "ben's turn is on
  its way" and the game sketch isn't rebuilt until every `audio` it names exists. Drive for
  desktop's stream mode can show a file before its bytes arrive. Reading it triggers the
  download, so pending clears on its own.
- On arrival: the doorbell sound, a macOS notification, sssketchy with the envelope, and the
  game's entry in `bing bong → games` shows `your turn`.
- A turn file that breaks the rules (wrong player, a turn number already taken, a gap) is shown,
  not applied: "turn 8 from ben doesn't follow turn 6. waiting for turn 7." Two different files
  for the same turn number can only come from a sync accident. Both are kept and the players pick
  one, which is recorded locally.

## The doorbell

### Email (default)

- **Settings → bing bong → email:** host, port, security, username, password, from address, and
  `send test`. Presets: Gmail (`smtp.gmail.com:587`, app password), iCloud
  (`smtp.mail.me.com:587`, app-specific password), custom.
- The password is encrypted with Electron `safeStorage`, as the Endlesss session already is
  (`src/main/endlesssApi.ts`). It never goes in a game folder.
- Sent from the main process with nodemailer (new dependency) to the other player's
  `players/<them>.json` email.
- **Message:** subject `bing bong: elling played turn 7`. Body: the chat line (if
  `chatInNotifications`), sssketchy's one-line summary of what changed, and "open sssketch to
  play". Plain text plus a small HTML version with sssketchy's sprite. Never any audio.
- **No SMTP configured:** end turn opens a `mailto:` draft with the same subject and body in the
  user's own mail app. The turn is written either way: the doorbell never blocks a turn.
- **Elling and Ben:** a new SES SMTP IAM user for bing bong only, with an IAM policy condition
  limiting `ses:FromAddress` to `bingbong@rpmchallenge.com`, so the shared credential can't send
  as anything else at RPM and can be revoked on its own.

### Phone push (optional)

- `players/<me>.json` holds my ntfy topic: `bingbong-<username>-<12 random chars>`, made on
  joining. The topic name is the secret.
- sssketch shows a QR code (reusing `src/shared/qrSvg.ts`) for the ntfy phone app to subscribe.
- End turn POSTs to **the other player's** topic: title `bing bong`, tag `bell`, message the same
  as the email subject, plus the chat line only if the recipient's `chatInNotifications` is on.
  ntfy.sh can read message text, so that switch is per player.
- The ntfy server address is a setting (default `https://ntfy.sh`) in case it ever needs to change.

## sssketchy

- **Delivers.** A turn arrives: he walks on with an envelope. Clicking it opens the turn in Cross.
- **Says what changed**, from a plain diff of the two riffs' stems by content id and gain:
  "ben swapped your bass and added a shaker. kept your drums."
- **Carries the chat line** in his speech bubble.
- **Nudges gently, only in-app:** after 4 days of a game waiting on me, "ben's been waiting 4
  days." After 4 days waiting on them, an offer: "send ben a poke?", which rings their doorbell
  once (at most once a day).
- **Marks milestones** the way he marks guided-flow steps: turn 10, the first recorded take in a
  game, the game sketch passing 3 minutes.
- **Never plays a move**, and never suggests one unless asked.

## Prep work in sssketch

Each item stands on its own and is useful without the game:

1. **A content id for audio.** `contentIdForFile(path)` (sha256, cached by path + mtime + size)
   in `src/main/`. Used by bing bong's audio dedupe and by item 2.
2. **Collect all and save.** Copy every audio file a sketch uses into a folder beside it,
   deduplicated by content id, and repoint the copy's stems at them. For backups and moving a
   sketch to another Mac. Bing bong's end-turn audio step is the same operation on one riff.
3. **Locked riffs.** An optional `locked` flag on a timeline riff. Sketch, Arrange and Map can play
   and solo it but can't move, resize, edit or delete it. The commands that would are disabled,
   with a tooltip saying why.
4. **Cross opens from any setup.** An entry point that takes a left parent, a right source (riff
   or Discover), a pre-filled center, and a replacement for the primary action (`end turn` instead
   of `add to shelf`). `createCrossDraft` (`src/shared/cross.ts`) today starts the center empty.
5. **Reload on change.** When the open project's source of truth changes on disk (for bing bong,
   a new turn file), rebuild and reload while keeping view, zoom, selection and playhead.

## The bing bong menu

- `start a bing bong game…` (from a selected riff), `join a game…`, `games` (each game: the
  other player, turn count, `your turn` / `waiting for ben` / `ben's turn is on its way`), and
  settings (email, phone push).

## Testing

- **Pure rules in `src/shared/`, test-first, like the rest of the codebase:** whose turn, turn
  validation (order, gaps, duplicates, wrong player), rebuild from turn files to project, the
  stem diff behind sssketchy's summary, chat line limits, end-turn step ordering and resume.
- **Main-process tests** with a temp directory as the game folder: two simulated players taking
  turns, audio dedupe (a remix turn writes no audio), pending turns whose audio arrives later,
  conflict-copy files ignored, a failed write mid end-turn resumes cleanly.
- **Doorbell:** SMTP sending tested against a fake transport. The mailto fallback is built from
  the same message. ntfy POST against a fake fetch.
- **By hand (Elling and Ben):** a real game over a real shared Drive folder, on two Macs, with
  the RPM SES user and the ntfy app. No agent can hear audio or see a phone.

## Later, not now

- More than two players, round-robin.
- Chain letters: anyone holding the folder plays next, so history can branch (the `parent` field
  is there for this).
- A game server or other backends behind the same "game folder" interface (GitHub repo,
  Cloudflare R2).
- Referencing Endlesss stems by StemCID instead of copying them.
- Scoring.
