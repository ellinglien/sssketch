// native-engine/Source/LinkSession.cpp
#include "LinkSession.h"
#include <cmath>

namespace sssketch
{
    namespace
    {
        constexpr double kTempoEpsilon = 0.001;
    }

    LinkSession::LinkSession(double initialBpm) : link(initialBpm), lastKnownSessionTempo(initialBpm)
    {
        // ableton::Link's own documented default is DISABLED -- sssketch wants
        // Link on from the moment the engine starts, rather than requiring a
        // manual per-session toggle in the renderer's Transport bar, so enable
        // it here, before any renderer-driven set-link-enabled IPC call could
        // otherwise be the first thing to flip it on.
        link.enable(true);
    }

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

    std::optional<double> LinkSession::checkForExternalTempoChange()
    {
        // See this method's own doc comment (.h) for why numPeers() == 0 is
        // excluded, not just !isEnabled() -- a lone session's own outbound
        // pushes already keep lastKnownSessionTempo in lockstep with
        // sessionTempo() with zero peers involved, so this is mainly a
        // cheap, intention-revealing guard rather than one that's ever
        // strictly load-bearing on its own.
        if (!link.isEnabled() || link.numPeers() == 0) return std::nullopt;

        auto sessionState = link.captureAppSessionState();
        const double sessionTempo = sessionState.tempo();

        if (std::abs(sessionTempo - lastKnownSessionTempo) > kTempoEpsilon)
        {
            // Mirrors syncTempo's own peer-detected branch exactly (see its
            // comment above) -- absorbing the new value into
            // lastKnownSessionTempo here, immediately, is what keeps the
            // eventual outbound echo (renderer adopts this value ->
            // load-project -> syncTempo) a no-op instead of fighting the
            // peer right back. See this method's own .h doc comment for the
            // full trace.
            lastKnownSessionTempo = sessionTempo;
            return sessionTempo;
        }
        return std::nullopt;
    }
}
