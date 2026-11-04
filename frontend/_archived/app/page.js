/* =============================================================================
 * Voices of the North — Next.js 首頁
 * 純展示型 Server Component（無互動狀態），交互集中於右下角懸浮助手。
 * ========================================================================== */

const PROTOTYPE_URL =
  process.env.NEXT_PUBLIC_PROTOTYPE_URL || 'http://127.0.0.1:8421/demo.html';

const PRINCIPLES = [
  {
    icon: 'fa-book-open',
    title: '答案只來自已錄製的故事',
    body: '助手唔會維基、唔會估。每一條回答都由長者已授權嘅故事文字稿檢索而來，冇記錄嘅內容絕唔作實。'
  },
  {
    icon: 'fa-link',
    title: '每條答案附時間戳出處',
    body: '例如「Source: [YL-001] at 00:21」，一按即可跳到音訊該秒，逐句對返原文，內容可溯源、可核對。'
  },
  {
    icon: 'fa-shield-halved',
    title: '超出範圍，老實講唔知',
    body: '問題喺故事以外，助手會直接答「抱歉，錄製故事中未包含此資訊」，唔會編造任何歷史或資料。'
  }
];

const TEST_CASES = [
  { q: '元朗條村朝早係點㗎？', expect: '命中「公雞・晨光」段，附 00:02 出處' },
  { q: '以前村民喺邊度聚會？', expect: '命中「祠堂・曬穀坪・盆菜」段，附 00:21 出處' },
  { q: '以前主要耕種啲咩？', expect: '命中「戰後種稻米」段，附 00:31 出處' },
  { q: '錦田有咩歷史？', expect: '故事冇記錄 → 誠實拒答，唔附出處' }
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#F6F1E6]">
      {/* ---------- 頂欄 ---------- */}
      <header className="border-b border-[#B9CDB6]/50 bg-[#FDFBF4]">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <img
            src="/assets/app-icon.png"
            alt="Voices of the North 標誌"
            className="h-11 w-11 rounded-2xl shadow-sm"
          />
          <div>
            <p className="text-[12px] font-bold tracking-[0.2em] text-[#83632B]">
              VOICES OF THE NORTH
            </p>
            <p className="text-[15px] font-semibold text-[#21453A]">
              北部都會區・鄉村故事館
            </p>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage: 'url(/assets/home-background.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center right'
          }}
        />
        <div className="relative mx-auto max-w-5xl px-5 py-16 sm:py-20">
          <p className="text-[14px] font-bold tracking-[0.18em] text-[#83632B]">
            ASK THE VILLAGE・村落問答
          </p>
          <h1 className="mt-3 max-w-2xl font-serif text-4xl font-black leading-[1.25] text-[#21453A] sm:text-5xl">
            讓每一條鄉村記憶，
            <br />
            都可以被誠實咁查閱
          </h1>
          <p className="mt-5 max-w-xl text-[18px] leading-[1.8] text-[#2E4A3B]">
            右下角嘅村落小幫手，只根據<strong className="text-[#21453A]">已經錄製嘅故事</strong>
            回答提問。每一條答案都有音訊時間戳出處；故事冇講過嘅，佢會直頭話你知。
          </p>

          <a
            href="#try"
            className="mt-8 inline-flex min-h-[58px] items-center gap-2 rounded-full bg-[#2C5742] px-8 text-[18px] font-bold tracking-wider text-[#F4F8F1] shadow-cta transition-colors hover:bg-[#31604A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5E8C70] focus-visible:outline-offset-2"
          >
            即刻試吓
            <i className="fa-solid fa-arrow-down" aria-hidden="true" />
          </a>
        </div>
      </section>

      {/* ---------- 三項誠實原則 ---------- */}
      <section className="mx-auto max-w-5xl px-5 py-10">
        <h2 className="font-serif text-2xl font-black text-[#21453A]">
          點解可以信任佢？
        </h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          {PRINCIPLES.map(function (p) {
            return (
              <article
                key={p.title}
                className="rounded-3xl border border-[#B9CDB6] bg-[#FDFBF4] p-6 shadow-sm"
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#EAF0E5] text-xl text-[#2C5742]">
                  {/* Tailwind 不內置 FontAwesome，整頁唯一圖標改用內聯 SVG 風格圓點替代時，
                      此處沿用原型已載入的 FA 字體（演示台環境），無 FA 時靜默降級為文字 */}
                  <i className={'fa-solid ' + p.icon} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[19px] font-bold leading-snug text-[#21453A]">
                  {p.title}
                </h3>
                <p className="mt-2 text-[16px] leading-[1.75] text-[#2E4A3B]">
                  {p.body}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ---------- 現場可試的提問 ---------- */}
      <section id="try" className="mx-auto max-w-5xl px-5 py-10">
        <div className="rounded-[28px] bg-[#2C5742] p-7 text-[#F4F8F1] sm:p-9">
          <h2 className="font-serif text-2xl font-black">現場試呢幾條問題</h2>
          <p className="mt-2 text-[16px] leading-relaxed text-[#DCE9DC]">
            撳右下角圓形小幫手，直接點推薦問題，或自己輸入：
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {TEST_CASES.map(function (t) {
              return (
                <li
                  key={t.q}
                  className="rounded-2xl bg-white/8 px-5 py-4"
                  style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                >
                  <p className="text-[17px] font-bold">「{t.q}」</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-[#DCE9DC]">
                    預期：{t.expect}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 flex items-center gap-2 text-[14px] text-[#DCE9DC]">
            <i className="fa-solid fa-circle-info" aria-hidden="true" />
            第四條示範「誠實拒答」——係整個設計最重要嘅紅線。
          </p>
        </div>
      </section>

      {/* ---------- 前往完整原型 ---------- */}
      <section className="mx-auto max-w-5xl px-5 pb-16 pt-4">
        <a
          href={PROTOTYPE_URL}
          className="flex flex-col gap-4 rounded-[28px] border-2 border-dashed border-[#B9CDB6] bg-[#FDFBF4] p-7 transition-colors hover:border-[#2C5742] hover:bg-[#EAF0E5] sm:flex-row sm:items-center"
        >
          <span className="grid h-14 w-14 flex-none place-items-center rounded-2xl bg-[#F1E3C1] text-2xl text-[#83632B]">
            <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
          </span>
          <span className="flex-1">
            <span className="block text-[19px] font-bold text-[#21453A]">
              開啟完整手機原型（四頁演示台）
            </span>
            <span className="mt-1 block break-all text-[15px] text-[#5D7063]">
              {PROTOTYPE_URL}
            </span>
          </span>
          <span className="inline-flex min-h-[52px] items-center gap-2 rounded-full bg-[#2C5742] px-6 text-[16px] font-bold text-[#F4F8F1]">
            前往
            <i className="fa-solid fa-arrow-right" aria-hidden="true" />
          </span>
        </a>

        <p className="mt-6 rounded-2xl border border-[#B9CDB6] bg-[#F1E3C1]/50 px-5 py-4 text-[14px] leading-relaxed text-[#6d5326]">
          誠實披露：現階段僅載入一則角色扮演示範故事《元朗・村落晨光》（Boris Lau・00:45），
          音訊為佔位音訊，並非合成人聲。其餘故事須待長者授權錄製後方可查閱。
        </p>
      </section>
    </main>
  );
}
