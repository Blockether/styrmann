import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getHimalayaStatus } from '@/lib/himalaya';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const workspace = db.prepare("SELECT himalaya_account FROM workspaces WHERE id = 'default'").get() as { himalaya_account?: string } | undefined;
    const status = getHimalayaStatus(workspace?.himalaya_account || null);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({
      installed: false,
      configured: false,
      accounts: [],
      default_account: null,
      configured_account: null,
      healthy_account: false,
      error: error instanceof Error ? error.message : 'Failed to inspect Himalaya',
    }, { status: 500 });
  }
}
