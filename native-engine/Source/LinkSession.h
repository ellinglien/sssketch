// native-engine/Source/LinkSession.h
#pragma once
#include <ableton/Link.hpp>
#include <optional>

namespace sssketch
{
    /** Thin wrapper around ableton::Link (https://github.com/Ableton/link)
     * for tempo sync with other Link-enabled apps on the local network
     * (Ableton Live, other DAWs, Link-enabled hardware/apps).
     *
     * Deliberately NOT wired into the real-time audio callback -- Link's
     * own captureAppSessionState()/commitAppSessionState() are documented
     * thread-safe (if not realtime-safe), so this runs entirely from the
     * message thread. Two separate call sites, matching the two sync
     * directions below: syncTempo is called from IpcConnection::
     * messageReceived's load-project handling (OUTBOUND -- fires on every
     * real project change, not tied to a timer, so it keeps syncing even
     * while paused); checkForExternalTempoChange is polled from
     * IpcConnection's own link-poll MultiTimer id, which runs continuously
     * from connection-made until teardown, independent of the separate
     * play-gated position-update timer (see IpcServer.cpp for both).
     * Simpler and lower-risk than threading Link through Transport's
     * actual audio callback, and fully sufficient for tempo sync -- this
     * doesn't attempt beat-quantized launch/start-stop sync, just "what
     * tempo is the session at."
     *
     * Sync is now two-way: sssketch's own tempo changes get pushed out to
     * the Link session via syncTempo/pushTempoNow (so other apps can
     * follow sssketch), AND a tempo change originating from a PEER is
     * detected by checkForExternalTempoChange and pushed forward (via
     * IpcConnection -> engineClient.ts -> preload -> StoreContext.tsx's
     * inbound listener) so the renderer can adopt it into state.bpm.
     * Feedback-loop note: when the renderer adopts a peer's tempo, its own
     * existing outbound sync effect fires right back (state.bpm changed ->
     * load-project -> transport.setBpm -> syncTempo). This does NOT echo
     * back to Link: checkForExternalTempoChange already updated
     * lastKnownSessionTempo to the peer's value the moment it detected the
     * change, so by the time that outbound syncTempo call lands, both
     * lastKnownSessionTempo and the incoming sssketchBpm already agree
     * with the session's own tempo -- syncTempo's own "did sssketch's
     * tempo actually differ from the session" check is false, so it's a
     * no-op. See checkForExternalTempoChange's own doc comment below for
     * the numPeers()>0 gate this relies on. */
    class LinkSession
    {
    public:
        explicit LinkSession(double initialBpm);

        void setEnabled(bool enabled) { link.enable(enabled); }
        bool isEnabled() const { return link.isEnabled(); }
        std::size_t numPeers() const { return link.numPeers(); }

        /** Called periodically (message thread only, see IpcConnection's
         * own 30Hz timerCallback) with sssketch's own current project
         * tempo. A no-op while disabled. See this class's own doc comment
         * for the one-way sync direction and why. */
        void syncTempo(double sssketchBpm);

        /** Unconditionally pushes sssketch's own tempo to the session,
         * bypassing syncTempo's own "only push the side that actually
         * changed" comparison -- call this once, right when Link gets
         * enabled (see IpcServer.cpp's set-link-enabled handler), NOT on
         * every poll. Needed because syncTempo's heuristic can't tell
         * "I just joined a session that already had a different tempo"
         * (should push MY tempo, per this class's one-way design) apart
         * from "a peer nudged an already-shared tempo" (should NOT push,
         * to avoid fighting them) -- both look identical the moment
         * lastKnownSessionTempo hasn't been initialized against this
         * particular session yet. Asserting sssketch's own tempo once at
         * enable time resolves the ambiguity in the enable case
         * specifically, matching what a user turning Link on actually
         * expects (their tempo, broadcast), without needing syncTempo's
         * own steady-state non-fighting behavior to get more
         * complicated. */
        void pushTempoNow(double sssketchBpm);

        /** Polled periodically (message thread only, see IpcConnection's
         * own link-poll MultiTimer id -- ~750ms cadence, running
         * continuously regardless of play state) to detect a tempo change
         * that originated from a PEER rather than from sssketch's own
         * syncTempo/pushTempoNow calls above, so it can be surfaced to the
         * renderer -- the "adopt a peer's tempo" half of two-way sync this
         * class's own doc comment describes.
         *
         * Returns the new tempo if the session's own current tempo
         * differs from lastKnownSessionTempo AND at least one peer is
         * present. The numPeers() > 0 gate specifically excludes "no
         * peers at all" sessions: with zero peers, commitAppSessionState
         * applies locally with no negotiation, so sessionTempo() already
         * reflects sssketch's own last outbound push by the time any
         * poll could observe it -- lastKnownSessionTempo's existing
         * bookkeeping (updated by every syncTempo/pushTempoNow call)
         * already keeps that case from reading as an "external" change on
         * its own; this gate is an extra, cheap belt-and-braces check
         * against relying on that alone, and it also matches the
         * intuition that "peer changed the tempo" is meaningless to
         * report when there is no peer.
         *
         * Updates lastKnownSessionTempo as a side effect when it DOES
         * detect a change (same bookkeeping syncTempo's own peer-detected
         * branch already performs) -- this is what makes the eventual
         * outbound echo (renderer adopts the value -> load-project ->
         * syncTempo) a no-op instead of fighting the peer right back; see
         * this class's own doc comment above for the full trace.
         *
         * Returns nullopt when nothing changed (including while
         * disabled, or with no peers). Real-time-unsafe, same as
         * syncTempo -- message thread only. */
        std::optional<double> checkForExternalTempoChange();

        /** The Link session's own current tempo -- exposed mainly for
         * tests (see LinkSessionTests.cpp); real callers use syncTempo
         * above rather than reading this directly. Real-time-unsafe
         * (captures a fresh SessionState each call), fine to call from
         * the message thread only, same as syncTempo. */
        double sessionTempo() const { return link.captureAppSessionState().tempo(); }

    private:
        ableton::Link link;
        double lastKnownSessionTempo;
    };
}
