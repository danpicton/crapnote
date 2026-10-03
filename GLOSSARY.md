# Notes

The language used to describe a note as it moves between devices and through its lifecycle.

## Language

**Note**:
A user-authored entry with a title and body that can be edited, archived, locked, or moved to Trash.

**Saved to device**:
The latest edit is retained on the current device but has not been confirmed by the server.

**Synced**:
The server has confirmed the latest writing saved on this device, whether on the original note or a recovered copy.

**Recovered copy**:
A separate note that preserves an edit which could not safely replace the original note. It carries a reason for its creation and remains marked for review until the user explicitly clears that mark.

**Conflict**:
Competing edits to the same note made before either device had seen the other's change.

**Needs review**:
The visible status of a recovered copy whose reason and contents the user has not yet acknowledged.

**Locked note**:
A note that cannot be edited, archived, or moved to Trash until it is unlocked.

**Archive**:
The retained location for a note removed from the active list. Its archived status remains if the note is moved to Trash and later restored.

**Trash**:
The temporary location for a removed note before it is restored or permanently deleted.
