// native-engine/Source/LinkSession.cpp
#include "LinkSession.h"
#include <cmath>

namespace sssketch
{
    namespace
    {
        constexpr double kTempoEpsilon = 0.001;
    }

    LinkSession::LinkSession(double initialBpm) : link(initialBpm), lastKnownSessionTempo(initialBpm) {}

    void LinkSession::syncTempo(double sssketchBpm)
    {
        if (!link.isEnabled()) return;

        auto sessionState = link.captureAppSessionState();
        const double sessionTempo = sessionState.tempo();

        if (std::abs(sessionTempo - lastKnownSessionTempo) > kTempoEpsilon)
        {
            // A peer changed the session's tempo -- don't fight it (see
            // this class's own doc comment on the one-way sync
            // direction). Just remember the new value so the comparison
            // below is against what the session actually has now, not a
            // stale figure -- otherwise the very next call would read
            // this same peer-driven change as "sssketch's tempo differs
            // from the session" and immediately push it right back.
            lastKnownSessionTempo = sessionTempo;
            return;
        }

        if (std::abs(sssketchBpm - sessionTempo) > kTempoEpsilon)
        {
            // sssketch's own tempo changed locally (e.g. the user edited
            // the BPM field) -- broadcast it to the session.
            sessionState.setTempo(sssketchBpm, link.clock().micros());
            link.commitAppSessionState(sessionState);
            lastKnownSessionTempo = sssketchBpm;
        }
    }

    void LinkSession::pushTempoNow(double sssketchBpm)
    {
        if (!link.isEnabled()) return;
        auto sessionState = link.captureAppSessionState();
        sessionState.setTempo(sssketchBpm, link.clock().micros());
        link.commitAppSessionState(sessionState);
        lastKnownSessionTempo = sssketchBpm;
    }
}
