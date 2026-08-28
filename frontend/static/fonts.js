// Webfont loader. Lives here as a static file rather than inline in app.html
// because the CSP that ships in index.html hashes only the inline bootstrap
// SvelteKit generates (issue #90) — any other inline <script> would be blocked.
// As a same-origin file it is covered by script-src 'self'. See docs/csp.md.
//
// Webfonts are progressive enhancement: the stylesheet is injected after the
// window load event so a slow or unreachable fonts CDN (airplane mode, captive
// portal, flaky mobile link) can never block first render or delay app startup.
// display=swap keeps text visible in the fallback stacks until (if ever) the
// webfonts arrive.
(function () {
	function addFonts() {
		var l = document.createElement('link');
		l.rel = 'stylesheet';
		l.href =
			'https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400..700;1,400..700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Archivo+Black&family=Work+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=DM+Sans:wght@400;500;700&family=Fira+Code:wght@400;500&display=swap';
		document.head.appendChild(l);
	}
	if (document.readyState === 'complete') addFonts();
	else window.addEventListener('load', addFonts);
})();
