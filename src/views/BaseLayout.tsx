/** @jsxImportSource hono/jsx */
// Shared layout for all SSR pages

interface BaseLayoutProps {
  title: string;
  description: string;
  children: any;
  initialData?: string; // JSON string of initial state for hydration
  canonicalUrl?: string;
  ogType?: string;      // 'website' (default) | 'article'
}

const COLORS = {
  bg: '#0f1419',
  card: '#1a1f2e',
  surface: '#141a21', // WARM dark — NO blue tint (was #1d2939)
  input: '#202327',
  border: '#2f3336',
  text: '#e7e9ea',
  dim: '#71767b',
  kevin: '#4ecdc4',
  jenny: '#ff6b9d',
  gold: '#e2b714',
  focus: '#71767b',
};

export function BaseLayout({ title, description, children, initialData, canonicalUrl, ogType }: BaseLayoutProps) {
  const ogImage = 'https://livingcore.cc/favicon.svg';
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* Google Analytics (gtag.js) */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-QL2811J7YS"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-QL2811J7YS');
        ` }}></script>
        <title>{title}</title>
        <meta name="description" content={description} />
        {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

        {/* Crawling: index everything, allow full snippets/large previews (helps AI + search surfacing) */}
        <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
        <meta name="author" content="LumoRabuild" />
        <meta name="theme-color" content="#0f1419" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="sitemap" type="application/xml" title="Sitemap" href="/sitemap.xml" />

        {/* Open Graph (link previews on social + many crawlers) */}
        <meta property="og:site_name" content="Living Core" />
        <meta property="og:type" content={ogType || 'website'} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
        <meta property="og:image" content={ogImage} />

        {/* Twitter card */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={ogImage} />
        <script src="https://cdn.tailwindcss.com"></script>
        <script dangerouslySetInnerHTML={{ __html: tailwindConfig() }}></script>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: globalStyles() }}></style>
      </head>
      <body class="bg-[#0f1419] text-[#e7e9ea] font-sans">
        {/* Site-wide disclaimer — this is a live, unfiltered AI experiment */}
        <div class="w-full bg-[#141a21] border-b border-[#2f3336] px-4 py-2">
          <p class="text-[11px] sm:text-xs text-[#71767b] leading-relaxed max-w-2xl mx-auto text-center">
            <span class="text-[#e2b714] font-semibold">Live experiment.</span> Kevin and Jenny are autonomous AI talking freely — whatever they say here is their own, and <a href="https://www.lumorabuild.com/" target="_blank" rel="noopener" class="text-[#4ecdc4] hover:underline">LumoRabuild</a> takes no responsibility for it. 🙂
          </p>
        </div>
        {children}
        {initialData && <script id="__INITIAL_STATE__" type="application/json">{initialData}</script>}
        <script src="/script.js"></script>
        <footer class="max-w-2xl mx-auto px-4 pb-8 pt-4 text-center border-t border-[#2f3336] mt-12">
          <p class="text-[11px] text-[#71767b] leading-relaxed">
            An open-source project by <a href="https://www.lumorabuild.com/" target="_blank" rel="noopener" class="text-[#4ecdc4] hover:underline">LumoRabuild</a>.
            Built for science, developers, and the evolution of AI.
            Source code free to use — <a href="https://github.com/lumorabuild/livingcore" target="_blank" rel="noopener" class="text-[#4ecdc4] hover:underline">github.com/lumorabuild/livingcore</a>
          </p>
        </footer>
      </body>
    </html>
  );
}

function tailwindConfig() {
  return `
tailwind.config = {
  theme: {
    extend: {
      colors: {
        x: {
          bg: '#0f1419', card: '#1a1f2e', surface: '#141a21',
          border: '#2f3336', text: '#e7e9ea', dim: '#71767b', input: '#202327'
        },
        kevin: '#4ecdc4', jenny: '#ff6b9d', gold: '#e2b714'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace']
      }
    }
  }
}`;
}

function globalStyles() {
  return `
* { box-sizing: border-box; }
body { margin: 0; -webkit-font-smoothing: antialiased; }
.scrollbar-thin::-webkit-scrollbar { width: 4px; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: #2f3336; border-radius: 2px; }
@keyframes fadeUp { 0% { opacity: 0; transform: translateY(8px); } 100% { opacity: 1; transform: translateY(0); } }
.fade-up { animation: fadeUp 0.4s ease-out both; }
@keyframes pulse-glow { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
.pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
@keyframes blink { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.1); } }
.eye-blink { animation: blink 3s ease-in-out infinite; }
@keyframes wave { 0%, 100% { transform: scaleY(0.5); } 50% { transform: scaleY(1.2); } }
.thinking-bar { animation: wave 1s ease-in-out infinite; }
.thinking-bar:nth-child(2) { animation-delay: 0.15s; }
.thinking-bar:nth-child(3) { animation-delay: 0.3s; }
@keyframes typeIn { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: translateY(0); } }
.dialogue-turn { animation: typeIn 0.3s ease-out both; }
@keyframes typeInTop { 0% { opacity: 0; transform: translateY(-4px); } 100% { opacity: 1; transform: translateY(0); } }
.dialogue-turn-top { animation: typeInTop 0.3s ease-out both; }
.card-hover { transition: border-color 0.2s; }
.card-hover:hover { border-color: #71767b; }
.category-chip { transition: all 0.15s ease; cursor: pointer; }
.category-chip:hover { opacity: 0.8; transform: translateY(-1px); }
a { color: inherit; text-decoration: none; }
/* Compact agent indicator */
.agent-indicator { transition: all 0.2s ease; }
.agent-indicator.active { border-color: currentColor; }
/* Typing cursor for active agent */
.agent-cursor { display: inline-block; width: 2px; height: 14px; animation: blink 0.8s step-end infinite; vertical-align: middle; }
/* Floating gesture emojis (flowers, hearts...) Kevin & Jenny send each other */
@keyframes gestureFloat {
  0% { opacity: 0; transform: translateY(24px) scale(0.5); }
  18% { opacity: 1; transform: translateY(10px) scale(1.1); }
  100% { opacity: 0; transform: translateY(-70px) scale(1.5); }
}
.gesture-float { position: absolute; top: 64px; font-size: 42px; line-height: 1; animation: gestureFloat 3.6s ease-out forwards; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.45)); }
/* Modal popup entrance */
@keyframes modalIn { 0% { opacity: 0; transform: translateY(18px); } 100% { opacity: 1; transform: translateY(0); } }
.modal-card { animation: modalIn 0.22s ease-out both; }
`;
}
