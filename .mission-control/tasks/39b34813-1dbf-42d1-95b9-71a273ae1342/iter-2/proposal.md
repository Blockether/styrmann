# Auto-Train Supervisor Traceability Improvement

## Problem

The autotrain supervisor logs limited information about its decision-making process. When debugging why a task is or isn't being re-dispatched, operators need more visibility into:

1. Why a task was skipped (state key already processed)
2. The current iteration count vs max iterations
3. Whether a stop/resume signal was detected
4. The state key being used for deduplication

### Current Behavior

```typescript
// Only logs when tasks are dispatched or when errors occur
log.info(`Found ${dispatchable.length} assigned task(s) to dispatch`);
```

The supervisor doesn't log:
- When a task is skipped due to state key match
- The iteration count for each task
- Which control signal was detected (if any)
- The computed state key for debugging

### Impact

- Harder to debug autotrain loops that aren't progressing
- Difficult to understand why a task wasn't re-dispatched
- Limited visibility for smoke tests and operational monitoring

## Solution

Add structured debug logging at key decision points in the autotrain tick:

1. Log when a task is skipped due to state key match
2. Log the current iteration count and max iterations
3. Log which control signal was detected (if any)
4. Log the computed state key for each task

### Implementation

Add `log.debug()` calls in `src/daemon/autotrain.ts`:

```typescript
// Before the stateKey check
log.debug(`Task ${task.id}: iteration ${dispatchCount}/${maxIterations}, signals=${signalCount}, stateKey=${stateKey}`);

// When skipping due to state key
log.debug(`Task ${task.id}: skipping - state already processed`);

// When control signal is detected
log.debug(`Task ${task.id}: control signal=${controlSignal}`);
```

This improves traceability without changing behavior.

## Verification

1. Run the daemon with debug logging enabled
2. Create an autotrain task
3. Verify logs show iteration counts and state keys
4. Verify skipped tasks are logged with reason

## Files Changed

- `src/daemon/autotrain.ts` - Add debug logging for decision points
