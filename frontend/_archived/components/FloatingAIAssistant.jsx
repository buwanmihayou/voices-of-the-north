'use client';

/* =============================================================================
 * FloatingAIAssistant —「Ask the Village」懸浮式村落問答助手
 * -----------------------------------------------------------------------------
 * 技術棧：React（Next.js App Router 就緒，檔首 'use client'）＋ Tailwind CSS
 * 設計：Direction B「Oat × Sage」；長者無障礙：17px 正文、56px 觸控目標、
 *       高對比、鍵盤可達、尊重 prefers-reduced-motion。
 *
 * 用法（app/layout.js 或任何頁面，掛載一次即全局懸浮）：
 *   import FloatingAIAssistant from '@/components/FloatingAIAssistant';
 *   <FloatingAIAssistant />
 *
 * 可選 props：
 *   mascotSrc   吉祥物圖片位址          預設 '/assets/mascot.png'
 *   storageKey  對話記錄 localStorage 鍵 預設 'vtn-ask-village-chat-v1'
 *   askApi      注入查詢函式（測試用）   預設 askVillage()
 * ========================================================================== */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback
} from 'react';

import {
  askVillage as defaultAskApi,
  SUGGESTED_QUESTIONS,
  OUT_OF_SCOPE_MESSAGE
} from '../lib/askVillageApi.js';

/* -----------------------------------------------------------------------------
 * 圖示（內聯 SVG，零依賴；24×24 視框，stroke 統一）
 * --------------------------------------------------------------------------- */
function IconSend() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.4 11.3 20.2 4.6c.7-.3 1.4.4 1.1 1.1l-6.7 16.8c-.3.8-1.4.8-1.8.1l-3.5-6.6c-.2-.3-.4-.6-.7-.7l-6.6-3.5c-.8-.4-.7-1.5.1-1.8l1.3.3Z"
        stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="m9.3 14.7 5.4-5.4" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function IconMinimize() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 5 5.8v5.6c0 4.4 2.9 7.6 7 9.6 4.1-2 7-5.2 7-9.6V5.8L12 3Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m9 11.8 2.2 2.2L15.5 9.7" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCitation() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9.2 4.5H6.4C4.5 4.5 3 6 3 7.9v4.7c0 1.9 1.5 3.4 3.4 3.4h1.4v-4.1H6.2c-.3 0-.5-.2-.5-.5V8.4c0-.3.2-.5.5-.5h3c.3 0 .5.2.5.5v9.6c0 .3-.2.5-.5.5Zm9 0h-2.8c-1.9 0-3.4 1.5-3.4 3.4v4.7c0 1.9 1.5 3.4 3.4 3.4h1.4v-4.1h-1.6c-.3 0-.5-.2-.5-.5V8.4c0-.3.2-.5.5-.5h3c.3 0 .5.2.5.5v9.6c0 .3-.2.5-.5.5Z"
        fill="currentColor" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5c.3 3.2 1.9 4.9 5 5.3-3.1.4-4.7 2.1-5 5.3-.3-3.2-1.9-4.9-5-5.3 3.1-.4 4.7-2.1 5-5.3Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/* -----------------------------------------------------------------------------
 * 小元件
 * --------------------------------------------------------------------------- */

function TypingDots() {
  return (
    <span className="vtn-typing" aria-label="AI 正在輸入">
      <span />
      <span />
      <span />
    </span>
  );
}

function SourceChip({ source }) {
  return (
    <a
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#B9CDB6] bg-white/80 px-3 py-1.5 text-[14px] font-semibold leading-tight text-[#2C5742] underline-offset-2 hover:bg-[#DCE9DC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5E8C70]"
      href={source.audioUrl}
      title={'打開《' + source.title + '》音訊 ' + source.label}
      onClick={function (e) {
        // Mock 音訊為佔位錨點：阻止跳轉到無效位置（接入真音訊後移除此段）
        if (String(source.audioUrl).charAt(0) === '#') e.preventDefault();
      }}
    >
      <IconCitation />
      <span className="truncate">{source.label}</span>
    </a>
  );
}

function AssistantMessage({ message, onRetry }) {
  return (
    <div className="flex items-start gap-2.5">
      <img
        src={message.mascotSrc}
        alt=""
        className="mt-0.5 h-9 w-9 flex-none rounded-full border-2 border-white object-cover shadow-sm"
      />
      <div className="max-w-[86%]">
        <div
          className={
            'rounded-3xl rounded-tl-md px-4 py-3 text-[17px] leading-[1.7] text-[#24483A] shadow-sm ' +
            (message.error
              ? 'border border-[#d9b3b0] bg-[#f9eceb]'
              : 'bg-[#EAF0E5]')
          }
        >
          {message.loading ? <TypingDots /> : message.content}

          {message.error && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-[#2C5742] bg-white px-4 text-[15px] font-bold text-[#2C5742] hover:bg-[#DCE9DC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5E8C70]"
            >
              重新嘗試
            </button>
          )}
        </div>

        {/* 角色演示披露：僅在有引用文字稿的在範圍答案上顯示（拒答不顯示） */}
        {!message.loading && !message.error && message.demo &&
          Array.isArray(message.sources) && message.sources.length > 0 && (
          <p className="mt-1.5 px-1 text-[13px] leading-snug text-[#8a6d3b]">
            角色演示示範答案・依據佔位音訊之文字稿
          </p>
        )}

        {/* 來源引用：每條答案必須可回溯到故事 ID＋時間戳 */}
        {!message.loading && !message.error &&
          Array.isArray(message.sources) && message.sources.length > 0 && (
          <div className="mt-2 space-y-2">
            <p className="flex items-center gap-1.5 px-1 text-[13px] font-bold tracking-wide text-[#5D7063]">
              <IconShield />
              來源引用（已錄製故事）
            </p>
            <div className="flex flex-wrap gap-2">
              {message.sources.map(function (s, i) {
                return <SourceChip key={s.storyId + '-' + s.start + '-' + i} source={s} />;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * 主元件
 * --------------------------------------------------------------------------- */
export default function FloatingAIAssistant(props) {
  var mascotSrc = (props && props.mascotSrc) || '/assets/mascot.png';
  var storageKey =
    (props && props.storageKey) || 'vtn-ask-village-chat-v1';
  var hintKey = 'vtn-ask-village-hint-dismissed-v1';
  var askApi = (props && props.askApi) || defaultAskApi;

  var [open, setOpen] = useState(false);
  var [mounted, setMounted] = useState(false); // 控制進出場動畫
  var [input, setInput] = useState('');
  var [sending, setSending] = useState(false);
  var [messages, setMessages] = useState([]);
  var [hintVisible, setHintVisible] = useState(true);
  var [retryQuestion, setRetryQuestion] = useState(null);

  var scrollRef = useRef(null);
  var inputRef = useRef(null);
  var fabRef = useRef(null);
  var sendingRef = useRef(false);

  /* ---------- 初始：讀回本機對話／氣泡關閉狀態 ---------- */
  useEffect(function () {
    try {
      var raw = window.localStorage.getItem(storageKey);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setMessages(parsed.filter(function (m) { return !m.loading && !m.error; }));
        }
      }
      if (window.localStorage.getItem(hintKey) === '1') setHintVisible(false);
    } catch (err) {
      /* 無隱私模式或資料毀損：安靜降級，不影響使用 */
    }
  }, [storageKey]);

  /* ---------- 對話持久化 ---------- */
  useEffect(function () {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(
        messages.map(function (m) {
          return {
            role: m.role,
            content: m.content,
            sources: m.sources,
            demo: m.demo
          };
        })
      ));
    } catch (err) { /* 容量不足時忽略 */ }
  }, [messages, storageKey]);

  /* ---------- 開合：進場動畫、焦點、捲動 ---------- */
  useEffect(function () {
    if (open) {
      setMounted(true);
      setHintVisible(false);
      try { window.localStorage.setItem(hintKey, '1'); } catch (err) {}
      var t = window.setTimeout(function () {
        if (inputRef.current) inputRef.current.focus();
      }, 120);
      return function () { window.clearTimeout(t); };
    }
    // 收合後把焦點交還 FAB（鍵盤用戶不丟焦點）
    var t2 = window.setTimeout(function () {
      if (!open && fabRef.current) fabRef.current.focus();
    }, 120);
    return function () { window.clearTimeout(t2); };
  }, [open]);

  useEffect(function () {
    var el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, mounted]);

  /* ---------- 查詢 ---------- */
  var sendQuestion = useCallback(function (questionText) {
    var text = String(questionText || '').trim();
    if (!text || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setRetryQuestion(null);
    setInput('');

    var userMsg = { id: 'u-' + Date.now(), role: 'user', content: text };
    var loadingMsg = {
      id: 'a-' + Date.now(),
      role: 'assistant',
      content: '',
      loading: true,
      sources: [],
      mascotSrc: mascotSrc
    };

    setMessages(function (prev) { return prev.concat([userMsg, loadingMsg]); });

    askApi(text, messages)
      .then(function (result) {
        var inScope = result && result.inScope !== false;
        setMessages(function (prev) {
          return prev.map(function (m) {
            if (m.id !== loadingMsg.id) return m;
            return {
              id: m.id,
              role: 'assistant',
              content: inScope ? result.answer : OUT_OF_SCOPE_MESSAGE,
              sources: inScope ? (result.sources || []) : [],
              demo: !!result.demo,
              mascotSrc: mascotSrc
            };
          });
        });
      })
      .catch(function () {
        setRetryQuestion(text);
        setMessages(function (prev) {
          return prev.map(function (m) {
            if (m.id !== loadingMsg.id) return m;
            return {
              id: m.id,
              role: 'assistant',
              content: '網絡或服務暫時出咗問題，請再試一次。',
              error: true,
              sources: [],
              mascotSrc: mascotSrc
            };
          });
        });
      })
      .finally(function () {
        sendingRef.current = false;
        setSending(false);
      });
  }, [askApi, mascotSrc, messages]);

  function handleSubmit(e) {
    e.preventDefault();
    sendQuestion(input);
  }

  function handleRetry() {
    if (retryQuestion) sendQuestion(retryQuestion);
  }

  /* ---------- 鍵盤：Esc 收合 ---------- */
  function handlePanelKeyDown(e) {
    if (e.key === 'Escape') setOpen(false);
  }

  function dismissHint() {
    setHintVisible(false);
    try { window.localStorage.setItem(hintKey, '1'); } catch (err) {}
  }

  var hasHistory = messages.length > 0;

  return (
    <>
      {/* 元件自身需要的少量 keyframes（Tailwind 無法表達三點波動） */}
      <style>{`
        .vtn-typing{display:inline-flex;gap:5px;align-items:center;padding:2px 1px}
        .vtn-typing span{width:8px;height:8px;border-radius:999px;background:#5E8C70;
          animation:vtn-bounce 1.2s infinite ease-in-out}
        .vtn-typing span:nth-child(2){animation-delay:.18s}
        .vtn-typing span:nth-child(3){animation-delay:.36s}
        @keyframes vtn-bounce{0%,80%,100%{transform:translateY(0);opacity:.45}
          40%{transform:translateY(-5px);opacity:1}}
        @keyframes vtn-fab-pulse{0%{box-shadow:0 0 0 0 rgba(44,87,66,.35)}
          70%{box-shadow:0 0 0 14px rgba(44,87,66,0)}100%{box-shadow:0 0 0 0 rgba(44,87,66,0)}}
        @media (prefers-reduced-motion: reduce){
          .vtn-typing span{animation:none}.vtn-fab{animation:none !important}
        }
      `}</style>

      <div
        className="fixed bottom-5 right-4 z-[90] flex flex-col items-end gap-3 font-['Noto_Sans_TC','PingFang_HK','Microsoft_JhengHei',sans-serif] sm:right-6 sm:bottom-6"
        onKeyDown={handlePanelKeyDown}
      >
        {/* ===== 聊天對話框 ===== */}
        {mounted && (
          <section
            role="dialog"
            aria-modal="false"
            aria-label="Ask the Village 村落問答"
            className={
              'pointer-events-auto flex h-[min(620px,calc(100dvh-9.5rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px] border border-[#B9CDB6] bg-[#FDFBF4] shadow-[0_28px_70px_-20px_rgba(33,69,58,0.55)] transition-all duration-300 ease-out motion-reduce:transition-none ' +
              (open
                ? 'translate-y-0 scale-100 opacity-100'
                : 'pointer-events-none translate-y-4 scale-95 opacity-0')
            }
          >
            {/* 標題列 */}
            <header className="flex flex-none items-center gap-3 bg-[#2C5742] px-4 py-3 text-[#F4F8F1]">
              <img
                src={mascotSrc}
                alt=""
                className="h-11 w-11 flex-none rounded-full border-2 border-[#DCE9DC] object-cover"
              />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[19px] font-black leading-tight tracking-wide">
                  Ask the Village
                </h2>
                <p className="truncate text-[14px] leading-snug text-[#DCE9DC]">
                  答案只來自已錄製的故事
                </p>
              </div>
              <button
                type="button"
                onClick={function () { setOpen(false); }}
                aria-label="收起對話"
                className="grid h-11 w-11 flex-none place-items-center rounded-full text-[#F4F8F1] hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9ec3aa]"
              >
                <IconMinimize />
              </button>
              <button
                type="button"
                onClick={function () { setOpen(false); }}
                aria-label="關閉助手"
                className="grid h-11 w-11 flex-none place-items-center rounded-full text-[#F4F8F1] hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9ec3aa]"
              >
                <IconClose />
              </button>
            </header>

            {/* 訊息歷史 */}
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-label="對話內容"
              className="flex-1 space-y-4 overflow-y-auto bg-[#F6F1E6] px-3.5 py-4"
            >
              {/* 歡迎語＋推薦問題（不寫進持久紀錄） */}
              <div className="flex items-start gap-2.5">
                <img
                  src={mascotSrc}
                  alt=""
                  className="mt-0.5 h-9 w-9 flex-none rounded-full border-2 border-white object-cover shadow-sm"
                />
                <div className="max-w-[86%]">
                  <div className="rounded-3xl rounded-tl-md bg-[#EAF0E5] px-4 py-3 text-[17px] leading-[1.7] text-[#24483A] shadow-sm">
                    你好！我係村落問幫手。我只可以根據<b>已經錄製嘅故事</b>回答你，
                    冇記錄嘅內容我會直頭話你知。試下問：
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SUGGESTED_QUESTIONS.map(function (q) {
                      return (
                        <button
                          key={q}
                          type="button"
                          disabled={sending}
                          onClick={function () { sendQuestion(q); }}
                          className="min-h-[44px] rounded-full border-2 border-[#2C5742] bg-white px-3.5 py-2 text-[15px] font-semibold text-[#2C5742] transition-colors hover:bg-[#DCE9DC] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5E8C70]"
                        >
                          {q}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 正式對話 */}
              {messages.map(function (m) {
                if (m.role === 'user') {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-tr-md bg-[#2C5742] px-4 py-2.5 text-[17px] leading-[1.7] text-[#F4F8F1] shadow-sm">
                        {m.content}
                      </p>
                    </div>
                  );
                }
                return (
                  <AssistantMessage
                    key={m.id}
                    message={Object.assign({}, m, { mascotSrc: mascotSrc })}
                    onRetry={handleRetry}
                  />
                );
              })}

              {!hasHistory && !sending && (
                <p className="px-1 pt-1 text-center text-[13px] leading-snug text-[#7a8578]">
                  演示版本僅載入一則已錄製故事：《元朗・村落晨光》
                </p>
              )}
            </div>

            {/* 誠實性底註 */}
            <div className="flex flex-none items-center justify-center gap-1.5 bg-[#F1E3C1]/70 px-3 py-1.5 text-center text-[13px] text-[#6d5326]">
              <IconShield />
              無來源引用的內容，不會當成答案
            </div>

            {/* 輸入區 */}
            <form
              onSubmit={handleSubmit}
              className="flex flex-none items-center gap-2 border-t border-[#B9CDB6] bg-[#FDFBF4] p-3"
            >
              <label htmlFor="vtn-ask-input" className="sr-only">
                輸入你對村落故事的問題
              </label>
              <input
                id="vtn-ask-input"
                ref={inputRef}
                type="text"
                value={input}
                onChange={function (e) { setInput(e.target.value); }}
                placeholder="輸入問題，例如：以前村民耕種啲咩？"
                disabled={sending}
                autoComplete="off"
                className="min-h-[56px] min-w-0 flex-1 rounded-full border-2 border-[#B9CDB6] bg-white px-5 text-[17px] text-[#24483A] placeholder:text-[#8a978b] focus:border-[#2C5742] focus:outline focus:outline-2 focus:outline-[#5E8C70]/50 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="發送問題"
                className="grid h-14 w-14 flex-none place-items-center rounded-full bg-[#2C5742] text-[#F4F8F1] shadow-[0_10px_22px_-10px_rgba(33,69,58,0.8)] transition-colors hover:bg-[#31604A] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5E8C70]"
              >
                {sending
                  ? <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-white/35 border-t-white" />
                  : <IconSend />}
              </button>
            </form>
          </section>
        )}

        {/* ===== 關閉時：提示氣泡＋懸浮按鈕 ===== */}
        {!open && (
          <div className="pointer-events-none flex items-center gap-3">
            {hintVisible && (
              <div
                role="status"
                className="vtn-hint pointer-events-auto relative max-w-[230px] rounded-2xl rounded-r-md bg-white px-4 py-3 text-[16px] font-semibold leading-snug text-[#24483A] shadow-[0_10px_30px_-12px_rgba(33,69,58,0.45)]"
              >
                有咩需要幫忙？
                <span className="mt-0.5 block text-[13px] font-medium text-[#5D7063]">
                  How may I help you?
                </span>
                <button
                  type="button"
                  onClick={dismissHint}
                  aria-label="關閉提示"
                  className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-[#B9CDB6] bg-white text-[#5D7063] shadow-sm hover:bg-[#EAF0E5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5E8C70]"
                >
                  <IconClose />
                </button>
              </div>
            )}

            <button
              ref={fabRef}
              type="button"
              onClick={function () { setOpen(true); }}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label="開啟 Ask the Village 村落問答助手"
              className="vtn-fab pointer-events-auto relative h-[68px] w-[68px] flex-none overflow-hidden rounded-full border-[3px] border-white bg-[#2C5742] shadow-[0_16px_36px_-10px_rgba(33,69,58,0.6)] motion-safe:animate-[vtn-fab-pulse_2.6s_ease-out_infinite] hover:scale-105 focus-visible:outline focus-visible:outline-4 focus-visible:outline-[#5E8C70] focus-visible:outline-offset-2"
            >
              <img
                src={mascotSrc}
                alt=""
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-[#F1E3C1] text-[#83632B]">
                <IconSpark />
              </span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
