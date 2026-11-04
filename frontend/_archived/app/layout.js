import './globals.css';
import FloatingAIAssistant from '@/components/FloatingAIAssistant.jsx';

/* =============================================================================
 * 根版面：所有路由共用。
 * Ask the Village 懸浮助手在此掛載一次，即於全部頁面右下角生效，
 * 不侵入任何頁面的主內容。
 * ========================================================================== */

export const metadata = {
  title: 'Voices of the North｜北部都會區・鄉村故事館',
  description:
    '讓長者安心講述鄉土記憶。Ask the Village 村落問答助手，答案只來自已錄製的故事。',
  icons: {
    icon: '/assets/app-icon.png'
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant-HK">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=Noto+Serif+TC:wght@700;900&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.6.0/css/all.min.css"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}

        {/* 全局懸浮：Ask the Village 村落問答助手 */}
        <FloatingAIAssistant mascotSrc="/assets/mascot.png" />
      </body>
    </html>
  );
}
