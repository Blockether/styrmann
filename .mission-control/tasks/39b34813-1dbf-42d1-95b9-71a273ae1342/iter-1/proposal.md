# Auto-Train Supervisor RESUME Signal Bug Fix

## Problem

The autotrain supervisor has a critical bug that prevents `AUTOTRAIN_RESUME` signals from being processed after a task has been stopped.

### Root Cause

The `handledStates` Map uses `task.status:task.updated_at` as the state key to prevent re-processing. However, when activities are logged (like AUTOTRAIN_STOP or AUTOTRAIN_RESUME), the task's `updated_at` field is NOT updated - only the activities table changes.

**Bug flow:**
1. Task is `done`, stateKey = `"done:2024-01-01T10:00:00"`
2. AUTOTRAIN_STOP activity is logged
3. Supervisor picks up task, finds STOP signal, adds to handledStates
4. Task remains in `done` status with unchanged `updated_at`
5. User wants to resume, logs AUTOTRAIN_RESUME activity
6. Supervisor picks up task, stateKey is STILL `"done:2024-01-01T10:00:00"`
7. `handledStates.get(task.id) === stateKey` → **SKIPS the task!**
8. RESUME signal is ignored

### Impact

- Stopped autotrain tasks cannot be resumed without manual intervention
- Operators must either restart the daemon or manually update the task to change the stateKey
- Reduces operational flexibility for autotrain workflows

## Solution

Modify the state key to include the count of control signal activities (AUTOTRAIN_STOP/AUTOTRAIN_RESUME) in addition to task status and updated_at. This ensures the stateKey changes when new control signals are logged.

### Implementation

Update the `tick()` function in `src/daemon/autotrain.ts`:

1. Calculate the control signal count before checking handledStates
2. Include this count in the stateKey: `${task.status}:${task.updated_at}:${signalCount}`

This ensures:
- Each new control signal creates a new stateKey
- RESUME signals are properly processed after STOP
- STOP signals after RESUME also work correctly

## Verification

1. Create an autotrain task
2. Let it run and then stop it with AUTOTRAIN_STOP
3. Verify it's properly stopped
4. Send AUTOTRAIN_RESUME
5. Verify it resumes correctly

## Files Changed

- `src/daemon/autotrain.ts` - Fix stateKey calculation to include signal count
