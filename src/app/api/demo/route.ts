import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    demo: process.env.STYRMAN_DEMO_MODE === 'true',
    message: process.env.STYRMAN_DEMO_MODE === 'true'
      ? 'This is a live demo of Styrmann. All actions are simulated.'
      : undefined,
    github: 'https://github.com/crshdn/mission-control',
  });
}
