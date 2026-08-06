// native-engine/Source/LinkSession.h
#pragma once
#include <ableton/Link.hpp>

namespace sssketch
{
    /** Thin wrapper around ableton::Link (https://github.com/Ableton/link)
     * for tempo sync with other Link-enabled apps on the local network
     * (Ableton Live, other DAWs, Link-enabled hardware/apps).
     *
     * Deliberately NOT wired into the real-time audio callback -- Link's
     * own captureAppSessionState()/commitAppSessionState() are documented
     * thread-safe (if not realtime-safe), so this runs entirely from
     * IpcConnection's existing 30Hz message-thread timer (see
     * timerCallback's own call to syncTempo below). Simpler and lower-risk
     * than threading Link through Transport's actual audio callback, and
     * fully sufficient for tempo sync -- this doesn't attempt
     * beat-quantized launch/start-stop sync, just "what tempo is the
     * session at."
     *
     * Sync direction is deliberately ONE-WAY for now: sssketch's own
     * tempo changes get pushed out to the Link session (so other apps can
     * follow sssketch), but a tempo change originating from a PEER is
     * only tracked internally (see lastKnownSessionTempo) to avoid
     * fighting them for control of the session tempo -- it does NOT get
     * pulled back into sssketch's own project bpm. Adopting a peer's
     * tempo change would need a push all the way from this native
     * engine's own message-thread poll back to the renderer's own
     * state.bpm (a real, but separable, follow-up -- the one-way push
     * direction implemented here is already useful on its own: other
     * Link apps can already follow sssketch's tempo). */
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
