(() => {
  'use strict';
  document.body.classList.add('js-ready');
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#site-nav');
  const closeMenu = () => {
    nav?.classList.remove('open');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', '開啟導覽選單');
  };
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '關閉導覽選單' : '開啟導覽選單');
  });
  nav?.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
      closeMenu(); toggle.focus();
    }
  });
  document.addEventListener('click', event => { if (!header?.contains(event.target)) closeMenu(); });
  matchMedia('(min-width:1001px)').addEventListener('change', closeMenu);
  const progress = document.querySelector('.reading-progress');
  const topLink = document.querySelector('.back-top');
  let scheduled = false;
  const updateScroll = () => {
    const range = document.documentElement.scrollHeight - innerHeight;
    if (progress) progress.style.transform = `scaleX(${range > 0 ? Math.min(1, scrollY / range) : 0})`;
    header?.classList.toggle('scrolled', scrollY > 12);
    topLink?.classList.toggle('visible', scrollY > 650);
    scheduled = false;
  };
  addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(updateScroll); } }, { passive: true });
  addEventListener('resize', updateScroll, { passive: true });
  updateScroll();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if ('IntersectionObserver' in window && !reduced.matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.07, rootMargin: '0px 0px -24px 0px' });
    document.querySelectorAll('main section:not(.hero) .head, .about-grid, .compare .card, .step, .prep, .cat-card, .topic-list li, .app-copy, .phone-mock, .chatbot-copy, .chat-thread, .impact-grid, .team-subhead, .person, .partner-logo, .support, .resource-card').forEach(element => {
      if (element.getBoundingClientRect().top > innerHeight) {
        const index = [...element.parentElement.children].indexOf(element);
        element.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 55}ms`);
        element.classList.add('reveal-ready'); observer.observe(element);
      }
    });
    document.addEventListener('focusin', event => {
      const target = event.target.closest('.reveal-ready');
      if (target) { target.classList.add('is-visible'); observer.unobserve(target); }
    });
    reduced.addEventListener('change', event => {
      if (event.matches) { observer.disconnect(); document.querySelectorAll('.reveal-ready').forEach(element => element.classList.add('is-visible')); }
    });
  }
  if ('IntersectionObserver' in window) {
    const links = [...document.querySelectorAll('#site-nav a[href^="/#"]')];
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        links.forEach(link => {
          if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-15% 0px -65% 0px' });
    document.querySelectorAll('main section[id]').forEach(section => observer.observe(section));
  }
  const screenDialog = document.querySelector('#screen-dialog');
  const screenZoom = document.querySelector('.screen-zoom');
  screenZoom?.addEventListener('click', event => {
    if (typeof screenDialog?.showModal !== 'function') return;
    event.preventDefault();
    screenDialog.showModal();
    document.body.classList.add('dialog-open');
  });
  screenDialog?.querySelector('.dialog-close')?.addEventListener('click', () => screenDialog.close());
  screenDialog?.addEventListener('click', event => {
    const bounds = screenDialog.getBoundingClientRect();
    if (event.target === screenDialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) screenDialog.close();
  });
  screenDialog?.addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
    screenZoom?.focus({ preventScroll: true });
  });
  document.querySelector('[data-copy-email]')?.addEventListener('click', async event => {
    const status = document.querySelector('.copy-status');
    try {
      await navigator.clipboard.writeText(event.currentTarget.dataset.copyEmail);
      status.textContent = '已複製電郵地址';
    } catch { status.textContent = '請選取上方電郵地址複製。'; }
  });
  const precisePointer = matchMedia('(hover:hover) and (pointer:fine)');
  const heroVisual = document.querySelector('.hero-visual');
  heroVisual?.addEventListener('pointermove', event => {
    if (reduced.matches || !precisePointer.matches) return;
    const bounds = heroVisual.getBoundingClientRect();
    heroVisual.style.setProperty('--glow-x', `${(event.clientX - bounds.left) / bounds.width * 100}%`);
    heroVisual.style.setProperty('--glow-y', `${(event.clientY - bounds.top) / bounds.height * 100}%`);
  }, { passive: true });
  heroVisual?.addEventListener('pointerleave', () => { heroVisual.style.removeProperty('--glow-x'); heroVisual.style.removeProperty('--glow-y'); });
})();
