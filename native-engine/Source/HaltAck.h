#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace sssketch
{
    /** One renderer stop request waiting for its "transport-stopped" reply
     * (IpcConnection's pendingHaltAcks). MESSAGE THREAD only.
     *
     * The normal answer comes from the audio thread: Transport reports the
     * Stop's command generation complete once its fade has reached silence.
     * That never happens while the device isn't calling back at all (a
     * Bluetooth route change, an unplugged interface, a mono output the
     * callback won't render to), and the renderer used to wait out its full
     * 2 s timeout and get a rejection on every stop. A device that renders
     * nothing is already silent, so the stop is acknowledged then too: at
     * once when no device is running, and after a short stall when callbacks
     * have stopped arriving. A Stop still pending when callbacks resume is
     * applied by the next callback as usual. */
    struct HaltAckWait
    {
        int token = -1;
        unsigned long long commandGeneration = 0;
        // The rendered-callback count last seen, and when it last moved.
        unsigned long long lastSeenRenderedCallbacks = 0;
        std::uint32_t lastAdvanceMs = 0;
    };

    /** How long without a rendered callback counts as "not running": three
     * device blocks, never under 250 ms, so a large buffer (one callback
     * every ~190 ms at 8192 samples) is never mistaken for a stall. */
    inline std::uint32_t haltAckStallMs(int blockSize, double sampleRate)
    {
        if (blockSize <= 0 || sampleRate <= 0.0)
            return 250;
        const double threeBlocksMs = 3000.0 * (double) blockSize / sampleRate;
        return (std::uint32_t) std::max(250.0, std::ceil(threeBlocksMs));
    }

    /** True when `wait` should be answered stopped=true now. Updates its
     * stall bookkeeping as a side effect, so call it once per poll. */
    inline bool haltAckDue(HaltAckWait& wait,
                           unsigned long long completedHaltGeneration,
                           bool deviceRunning,
                           unsigned long long renderedCallbacksNow,
                           std::uint32_t nowMs,
                           std::uint32_t stallMs)
    {
        if (wait.commandGeneration <= completedHaltGeneration)
            return true;
        if (! deviceRunning)
            return true;
        if (renderedCallbacksNow != wait.lastSeenRenderedCallbacks)
        {
            wait.lastSeenRenderedCallbacks = renderedCallbacksNow;
            wait.lastAdvanceMs = nowMs;
            return false;
        }
        // Unsigned subtraction: correct across the millisecond counter's wrap.
        return (std::uint32_t) (nowMs - wait.lastAdvanceMs) >= stallMs;
    }

    /** A Play supersedes every stop still waiting for silence: it will not be
     * silent now, so each is answered stopped=false at once rather than left
     * to time out while the transport plays. Returns their tokens in request
     * order and empties `pending`. */
    inline std::vector<int> takeSupersededHaltAcks(std::vector<HaltAckWait>& pending)
    {
        std::vector<int> tokens;
        tokens.reserve(pending.size());
        for (const auto& wait : pending)
            tokens.push_back(wait.token);
        pending.clear();
        return tokens;
    }
}
