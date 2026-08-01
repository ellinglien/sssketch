// native-engine/Source/PluginEditorWindow.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <functional>

namespace sssketch
{
    /** A DocumentWindow hosting one plugin's AudioProcessorEditor -- shared
     * between the main engine (PluginChain's own master/channel plugin
     * slots) and the x86_64 bridge process (see native-engine-bridge/),
     * compiled into both targets from this one source file. Mirrors the
     * DocumentWindow-hosting-an-AudioProcessorEditor pattern used by JUCE's
     * own AudioPluginHost example, simplified to this app's actual needs. */
    class PluginEditorWindow : public juce::DocumentWindow
    {
    public:
        PluginEditorWindow(const juce::String& name, juce::AudioProcessorEditor* editor, std::function<void()> onClosed)
            : juce::DocumentWindow(name, juce::Colours::darkgrey, juce::DocumentWindow::closeButton),
              onClosedCallback(std::move(onClosed))
        {
            setUsingNativeTitleBar(true);
            setContentOwned(editor, true);
            setResizable(editor->isResizable(), false);
            centreWithSize(getWidth(), getHeight());
            // Three different cross-process "activate the app so its window
            // comes to the front" mechanisms were tried and all failed in
            // practice for the main engine's own windows (self-activation,
            // `open -a` from Electron, NSRunningApplication::activateWithOptions:
            // from Electron) -- see git history. Sidestepping the problem
            // entirely: pin the window itself above everything at the
            // window-server level, which macOS enforces directly based on
            // window level, independent of which app is active. Applies
            // just as well to the bridge's own windows, which face the
            // identical backgrounded-helper-process activation problem.
            setAlwaysOnTop(true);
            setVisible(true);
        }
        void closeButtonPressed() override
        {
            if (onClosedCallback)
                onClosedCallback();
        }

    private:
        std::function<void()> onClosedCallback;
    };
}
