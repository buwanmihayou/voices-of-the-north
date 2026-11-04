/* =============================================================================
 * POST /api/ask-village —「Ask the Village」服務端問答路由
 * -----------------------------------------------------------------------------
 * 誠實性保證（與前端合約一致，見 lib/storyCorpus.js）：
 *  1. 答案只由「已錄製並獲授權的故事文字稿」檢索產生，不調用任何外部知識；
 *  2. 每條在範圍答案附 storyId + mm:ss 時間戳與可跳轉音訊 URL；
 *  3. 檢索無命中 → inScope:false，客戶端直出「抱歉，錄製故事中未包含此資訊。」
 *
 * RAG/LLM 演進路徑（只需取代 retrieveSegments 的實作，合約不變）：
 *  - Step 1（現狀）：關鍵詞群命中（lib/storyCorpus.js）；
 *  - Step 2：把問題與文字稿 segment 做向量檢索，保留 start/end 出處；
 *  - Step 3：檢索到的 segments 作為唯一 context 交予 LLM 改寫，
 *    prompt 必須要求逐條回傳 storyId+timestamp；
 *    模型回傳的每個引用都要對回文字稿，無法核對者整條視為 inScope:false。
 * ========================================================================== */

import { NextResponse } from 'next/server';
import { retrieveAnswer } from '@/lib/storyCorpus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUESTION_MAX_LEN = 500;
const HISTORY_MAX_TURNS = 8;
const SIMULATED_LATENCY_MS = 280; // 讓客戶端「打字中」狀態可感知；RAG 接入後移除

export async function POST(request) {
  /* ---------- 1. 請求解析與基本校驗 ---------- */
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'BAD_REQUEST', message: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }

  const question =
    typeof body.question === 'string' ? body.question.trim() : '';

  if (!question) {
    return NextResponse.json(
      { error: 'EMPTY_QUESTION', message: 'Question must be a non-empty string.' },
      { status: 400 }
    );
  }
  if (question.length > QUESTION_MAX_LEN) {
    return NextResponse.json(
      { error: 'QUESTION_TOO_LONG',
        message: 'Question must be ' + QUESTION_MAX_LEN + ' characters or fewer.' },
      { status: 400 }
    );
  }

  // history 只作未來指代消解之用；現階段截斷長度，不做儲存、不計費
  const history = Array.isArray(body.history)
    ? body.history
        .filter(function (m) {
          return m && (m.role === 'user' || m.role === 'assistant') &&
                 typeof m.content === 'string';
        })
        .slice(-HISTORY_MAX_TURNS)
    : [];

  /* ---------- 2. 在已錄製故事範圍內檢索並組裝答案 ---------- */
  await new Promise(function (resolve) {
    setTimeout(resolve, SIMULATED_LATENCY_MS);
  });

  const result = retrieveAnswer(question, history);

  /* ---------- 3. 最後防線：在範圍答案無引用，強制降為誠實拒答 ---------- */
  if (result.inScope && (!Array.isArray(result.sources) || result.sources.length === 0)) {
    return NextResponse.json({
      inScope: false,
      answer: '抱歉，錄製故事中未包含此資訊。',
      sources: [],
      demo: result.demo || false,
      storyId: null
    });
  }

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store',
      // 原型不含任何個人資料，仍明確聲明不被中繼快存
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

/* 其他方法一律 405 */
export function GET() {
  return NextResponse.json(
    { error: 'METHOD_NOT_ALLOWED', message: 'Use POST with a JSON body.' },
    { status: 405,
      headers: { Allow: 'POST' } }
  );
}
