import { NextRequest, NextResponse } from 'next/server';
import { generateReport } from '@/lib/cftc';
import { saveReport, loadReport } from '@/lib/storage';
import { generateAnalysis } from '@/lib/analysis';
import { sendTelegramNotification } from '@/lib/telegram';
import { ReportData } from '@/lib/types';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // === STRICT AUTH: Only Vercel Cron or matching secret can trigger ===
  // Vercel Cron automatically sends this header
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In production: must be Vercel Cron OR have correct secret
  // In development: allow if CRON_SECRET is not set (local testing only)
  const isAuthorized =
    isVercelCron ||
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (!cronSecret && process.env.NODE_ENV === 'development');

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('Starting CFTC report generation...');
    const reportData: ReportData = await generateReport();

    // Check if report already exists — analysis results are immutable
    const existing = await loadReport(reportData.report_date);
    if (existing) {
      console.log(`Report for ${reportData.report_date} already exists, immutable — skipping.`);
      return NextResponse.json({
        status: 'skipped',
        report_date: reportData.report_date,
        message: 'Report already exists and is immutable',
      });
    }

    // Generate AI analysis (server-side only, key never exposed to client)
    console.log('Generating AI analysis...');
    const analysis = await generateAnalysis(reportData);
    if (analysis) {
      reportData.ai_analysis = analysis;
    }

    // Save report — once saved, never modified
    const savedPath = await saveReport(reportData);
    console.log(`Report saved (immutable): ${savedPath}`);

    // Send Telegram notification
    await sendTelegramNotification(reportData);

    return NextResponse.json({
      status: 'success',
      report_date: reportData.report_date,
      tff_count: reportData.tff_rows.length,
      disagg_count: reportData.disagg_rows.length,
      has_analysis: !!analysis,
    });
  } catch (error) {
    console.error('Cron update failed:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    );
  }
}
