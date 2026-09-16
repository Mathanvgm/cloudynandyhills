/**
 * animations.js
 * 
 * High-performance scroll animation engine using IntersectionObserver.
 * Elements with [data-reveal] receive the .is-visible class once when entering viewport.
 * Unobserves immediately upon reveal to prevent layout thrashing and scroll lag.
 */

document.addEventListener("DOMContentLoaded", () => {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('[data-reveal]').forEach((el) => {
      el.classList.add('is-visible');
    });
    return;
  }

  const DELAYS = { "0": 0, "1": 100, "2": 200, "3": 300, "4": 400, "5": 500 };

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const d = entry.target.dataset.delay || "0";
        const ms = DELAYS[d] ?? 0;
        setTimeout(() => {
          entry.target.classList.add("is-visible");
        }, ms);
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px 50px 0px" });

  window.initScrollAnimations = () => {
    document.querySelectorAll('[data-reveal]:not(.is-visible)').forEach(el => revealObserver.observe(el));
  };

  window.initScrollAnimations();
});
