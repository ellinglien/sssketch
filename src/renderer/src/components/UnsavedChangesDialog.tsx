import { ConfirmationDialog } from './ConfirmationDialog'

// Same backdrop+panel shape as LockInConfirmDialog.tsx, but driven by plain
// props (App.tsx's Frame owns the visibility state and a stored
// resolve-function ref) rather than reducer state -- confirmDiscardIfDirty
// is only ever invoked from within Frame itself, or from a callback Frame
// hands down as a prop (see ProjectLibraryBrowser.tsx's
// onBeforeReplaceProject), never from several independent component
// instances at once the way LockInConfirmDialog's pendingLockInConfirm
// needs to be (see that component's own doc comment for why THAT one
// needs reducer-level state). So this one skips that complexity entirely
// and just takes callback props.
//
// Deliberately no backdrop-click-to-dismiss, for the same reason
// LockInConfirmDialog has none: "click outside to cancel" would just
// reintroduce the exact ambiguity (save? discard? cancel?) this dialog
// exists to remove. The user must press one of the three explicitly
// labeled buttons.
export function UnsavedChangesDialog({
  hasShapeChanges,
  onSave,
  onDiscard,
  onCancel
}: {
  hasShapeChanges?: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <ConfirmationDialog
      message="this project has unsaved changes."
      detail={hasShapeChanges ? 'Saving will add the open edited riff to the shelf.' : undefined}
      actions={[
        { label: 'cancel', onClick: onCancel },
        { label: 'discard', onClick: onDiscard, danger: true },
        { label: 'save', onClick: onSave, primary: true }
      ]}
    />
  )
}
