import { execFileSync } from 'child_process';
import type { HimalayaStatus } from '@/lib/types';

type HimalayaAccount = { name: string; backend?: string; default?: boolean };

function runHimalaya(args: string[]): string {
  return execFileSync('himalaya', args, {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function getHimalayaStatus(configuredAccount?: string | null): HimalayaStatus {
  try {
    runHimalaya(['--version']);
  } catch (error) {
    return {
      installed: false,
      configured: false,
      accounts: [],
      default_account: null,
      configured_account: configuredAccount || null,
      healthy_account: false,
      error: error instanceof Error ? error.message : 'himalaya not installed',
    };
  }

  try {
    const raw = runHimalaya(['account', 'list', '--output', 'json']);
    const accounts = JSON.parse(raw) as HimalayaAccount[];
    const defaultAccount = accounts.find((account) => account.default)?.name || null;
    const targetAccount = configuredAccount || defaultAccount;

    let healthyAccount = false;
    let error: string | null = null;
    if (targetAccount) {
      try {
        runHimalaya(['account', 'doctor', targetAccount]);
        healthyAccount = true;
      } catch (doctorError) {
        healthyAccount = false;
        error = doctorError instanceof Error ? doctorError.message : 'account doctor failed';
      }
    } else {
      error = 'No Himalaya account configured';
    }

    return {
      installed: true,
      configured: accounts.length > 0,
      accounts,
      default_account: defaultAccount,
      configured_account: targetAccount,
      healthy_account: healthyAccount,
      error,
    };
  } catch (error) {
    return {
      installed: true,
      configured: false,
      accounts: [],
      default_account: null,
      configured_account: configuredAccount || null,
      healthy_account: false,
      error: error instanceof Error ? error.message : 'failed to inspect himalaya accounts',
    };
  }
}

export function sendHumanAssignmentEmail(input: {
  account: string;
  fromEmail: string;
  toEmail: string;
  taskTitle: string;
  taskDescription?: string | null;
  workspaceName: string;
  taskUrl: string;
}): { ok: boolean; error?: string } {
  const message = [
    `From: ${input.fromEmail}`,
    `To: ${input.toEmail}`,
    `Subject: Mission Control assignment: ${input.taskTitle}`,
    '',
    `You have been assigned work in ${input.workspaceName}.`,
    '',
    `Task: ${input.taskTitle}`,
    input.taskDescription ? `Description: ${input.taskDescription}` : null,
    '',
    `Open task: ${input.taskUrl}`,
    '',
    'This assignment was sent by Mission Control via Himalaya.',
  ].filter(Boolean).join('\n');

  try {
    execFileSync('himalaya', ['template', 'send', '--account', input.account], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, NO_COLOR: '1' },
      input: message,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to send assignment email',
    };
  }
}
