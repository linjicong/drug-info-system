import { NextResponse } from 'next/server';
import { getProgress } from '@/lib/progress-manager';

export async function GET() {
  const progress = getProgress();
  return NextResponse.json(progress);
}
