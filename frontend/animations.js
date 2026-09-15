/**
 * animations.js
 * 
 * Global scroll animation engine using IntersectionObserver.
 * Elements with the [data-reveal] attribute will receive the .is-visible class
 * when they enter the viewport, triggering their CSS entrance animations.
 * When scrolling out of view, the class is removed to allow re-animation on scroll (up and down).
 */

document.addEventListener("DOMContentLoaded", () => {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('[data-reveal]').forEach((el) => {
      el.classList.add('is-visible');
    });
    return;
  }

  const DELAYS = { "0": 0, "1": 120, "2": 240, "3": 360, "4": 480, "5": 600 };

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const d = entry.target.dataset.delay || "0";
      const ms = DELAYS[d] ?? 0;
      
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add("is-visible"), ms);
      } else {
        // Remove class when out of view to allow animation to trigger again on scroll up/down
        entry.target.classList.remove('is-visible');
      }
    });
  }, { threshold: 0.12 });

  window.initScrollAnimations = () => {
    document.querySelectorAll('[data-reveal]').forEach(el => revealObserver.observe(el));
  };

  window.initScrollAnimations();
});
