import type { EditCommand, ExecutionResult, OperationOutcome, VerificationFailure } from './types/editTypes';

/**
 * Execute a single EditCommand against the Logseq Editor API.
 * Used by PermissionPrompt "Allow" action.
 */
export async function executeOne(command: EditCommand): Promise<OperationOutcome> {
  try {
    switch (command.action) {
      case 'insert': {
        if (!command.parentBlockUUID) {
          return { command, status: 'error', error: 'Missing parentBlockUUID for insert command' };
        }
        const newBlock = await logseq.Editor.insertBlock(command.parentBlockUUID, command.content ?? '', {
          sibling: false,
        });
        return { command, status: 'success', insertedBlockUUID: newBlock?.uuid };
      }
      case 'update': {
        if (!command.blockUUID) {
          return { command, status: 'error', error: 'Missing blockUUID for update command' };
        }
        await logseq.Editor.updateBlock(command.blockUUID, command.content ?? '');
        return { command, status: 'success' };
      }
      case 'delete': {
        if (!command.blockUUID) {
          return { command, status: 'error', error: 'Missing blockUUID for delete command' };
        }
        await logseq.Editor.removeBlock(command.blockUUID);
        return { command, status: 'success' };
      }
      default:
        return { command, status: 'error', error: `Unknown action: ${(command as any).action}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`BlockExecutor: failed to execute ${command.action} command:`, message);
    return { command, status: 'error', error: message };
  }
}

/**
 * Execute all commands automatically (autopilot mode).
 * Iterates sequentially, logging errors and continuing on failure.
 */
export async function executeAll(commands: EditCommand[]): Promise<ExecutionResult> {
  const outcomes: OperationOutcome[] = [];

  for (const command of commands) {
    const outcome = await executeOne(command);
    outcomes.push(outcome);
  }

  const successCount = outcomes.filter((o) => o.status === 'success').length;
  const failedCount = outcomes.filter((o) => o.status === 'error').length;
  const deniedCount = outcomes.filter((o) => o.status === 'denied').length;

  return { successCount, failedCount, deniedCount, outcomes };
}

/**
 * Verify that successfully executed commands actually took effect by reading
 * the blocks back. Returns a list of failures with correction attempts.
 */
export async function verifyAndCorrect(result: ExecutionResult): Promise<VerificationFailure[]> {
  const failures: VerificationFailure[] = [];
  const successOutcomes = result.outcomes.filter((o) => o.status === 'success');

  for (const outcome of successOutcomes) {
    const { command } = outcome;
    try {
      switch (command.action) {
        case 'update': {
          const block = await logseq.Editor.getBlock(command.blockUUID!);
          if (!block) {
            // Block disappeared — retry
            const corrected = await retryCommand(command);
            failures.push({ command, reason: 'Block not found after update', corrected });
          } else if (block.content !== command.content) {
            // Content mismatch — retry
            const corrected = await retryCommand(command);
            failures.push({ command, reason: `Content mismatch: expected "${command.content?.slice(0, 50)}", got "${block.content?.slice(0, 50)}"`, corrected });
          }
          break;
        }
        case 'insert': {
          const parent = await logseq.Editor.getBlock(command.parentBlockUUID!, { includeChildren: true });
          if (!parent) {
            failures.push({ command, reason: 'Parent block not found after insert', corrected: false });
          } else {
            const children = parent.children ?? [];
            const found = children.some((child: any) => {
              const content = typeof child === 'object' && child !== null ? child.content : '';
              return content === command.content;
            });
            if (!found) {
              const corrected = await retryCommand(command);
              failures.push({ command, reason: 'Inserted block not found among parent children', corrected });
            }
          }
          break;
        }
        case 'delete': {
          const block = await logseq.Editor.getBlock(command.blockUUID!);
          if (block) {
            // Block still exists — retry deletion
            const corrected = await retryCommand(command);
            failures.push({ command, reason: 'Block still exists after delete', corrected });
          }
          break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`BlockExecutor: verification failed for ${command.action}:`, message);
      failures.push({ command, reason: `Verification error: ${message}`, corrected: false });
    }
  }

  return failures;
}

/** Retry a command once. Returns true if the retry succeeded without throwing. */
async function retryCommand(command: EditCommand): Promise<boolean> {
  try {
    const outcome = await executeOne(command);
    return outcome.status === 'success';
  } catch {
    return false;
  }
}
