(() => {
  'use strict';
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
    document.querySelectorAll('main section:not(.hero) .head, .about-grid, .compare, .steps, .prep-row, .cat-grid, .topic-list, .app-grid, .chatbot-grid, .impact-grid, .team-group, .partner-logos, .support, .resource-card').forEach(element => {
      if (element.getBoundingClientRect().top > innerHeight) {
        element.classList.add('reveal-ready'); observer.observe(element);
      }
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
})();
