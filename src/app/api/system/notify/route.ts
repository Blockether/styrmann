import { NextResponse } from 'next/server';
import { getNotifyStatus } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getNotifyStatus());
}
