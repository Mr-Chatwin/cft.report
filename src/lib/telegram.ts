import { ReportData } from './types';

export async function sendTelegramNotification(data: ReportData) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const threadId = process.env.TELEGRAM_THREAD_ID; // For topic-based groups

  if (!botToken || !chatId) {
    console.warn('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping notification');
    return;
  }

  try {
    // Determine app URL
    const appUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.APP_URL || 'http://localhost:3000';

    const reportUrl = `${appUrl}/reports/${data.report_date}`;

    // Extract "Core Changes" from AI analysis
    let summary = 'AI 分析生成中，请先查看数据面板。';
    if (data.ai_analysis) {
      // Try to find the "本周核心变化" section
      const match = data.ai_analysis.match(/### 一、本周核心变化\n([\s\S]*?)(?=###|$)/i);
      if (match) {
        // Clean up markdown for telegram (limit length)
        let text = match[1].trim();
        // Remove markdown bolding for cleaner telegram text
        text = text.replace(/\*\*(.*?)\*\*/g, '$1');
        // Limit to 250 chars
        if (text.length > 250) {
          text = text.substring(0, 247) + '...';
        }
        summary = text;
      }
    }

    // Construct message
    const message = `
<b>📊 CFTC 持仓周报已生成</b>
📅 <b>数据日期:</b> ${data.report_date}
🔗 <b>完整面板:</b> <a href="${reportUrl}">点击查看</a>

<b>📌 核心变化:</b>
${summary}
`;

    // Send to Telegram
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: message.trim(),
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    };

    // Add thread ID if provided (for groups with topics)
    if (threadId) {
      payload.message_thread_id = parseInt(threadId, 10);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Failed to send Telegram notification:', response.status, errText);
    } else {
      console.log('Telegram notification sent successfully');
    }
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
}
