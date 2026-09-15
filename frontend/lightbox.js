/**
 * lightbox.js
 * 
 * Global image slider overlay.
 * Usage: openLightbox(imageUrlsArray, startingIndex)
 */

document.addEventListener("DOMContentLoaded", () => {
  // Inject Lightbox HTML into the DOM
  const lightboxHTML = `
    <div id="globalLightbox" class="lightbox-overlay" hidden>
      <div class="lightbox-backdrop"></div>
      <div class="lightbox-content">
        <button id="lightboxClose" class="lightbox-close" aria-label="Close slider">&times;</button>
        <button id="lightboxPrev" class="lightbox-nav prev" aria-label="Previous image">&#10094;</button>
        <div class="lightbox-image-container">
          <img id="lightboxImage" src="" alt="Property view" />
        </div>
        <button id="lightboxNext" class="lightbox-nav next" aria-label="Next image">&#10095;</button>
        <div id="lightboxCounter" class="lightbox-counter">1 / 1</div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', lightboxHTML);

  const overlay = document.getElementById("globalLightbox");
  const imgElement = document.getElementById("lightboxImage");
  const btnClose = document.getElementById("lightboxClose");
  const btnPrev = document.getElementById("lightboxPrev");
  const btnNext = document.getElementById("lightboxNext");
  const counter = document.getElementById("lightboxCounter");

  let currentImages = [];
  let currentIndex = 0;

  const updateLightbox = () => {
    if (!currentImages || currentImages.length === 0) return;
    
    // Add fade-out effect
    imgElement.classList.add('fading');
    
    setTimeout(() => {
      imgElement.src = currentImages[currentIndex];
      counter.textContent = `${currentIndex + 1} / ${currentImages.length}`;
      
      // Remove fade-out, add fade-in
      imgElement.onload = () => {
        imgElement.classList.remove('fading');
      };
      
      // Hide arrows if only 1 image
      if (currentImages.length <= 1) {
        btnPrev.style.display = 'none';
        btnNext.style.display = 'none';
      } else {
        btnPrev.style.display = 'flex';
        btnNext.style.display = 'flex';
      }
    }, 150);
  };

  window.openLightbox = (imageUrls, startIndex = 0) => {
    if (!imageUrls || imageUrls.length === 0) return;
    currentImages = imageUrls;
    currentIndex = startIndex;
    
    overlay.removeAttribute("hidden");
    // Trigger reflow for animation
    void overlay.offsetWidth;
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden"; // Prevent background scrolling
    
    updateLightbox();
  };

  const closeLightbox = () => {
    overlay.classList.remove("is-open");
    setTimeout(() => {
      overlay.setAttribute("hidden", "true");
      document.body.style.overflow = ""; // Restore scrolling
    }, 300); // Matches transition duration
  };

  const nextImage = (e) => {
    if (e) e.stopPropagation();
    currentIndex = (currentIndex + 1) % currentImages.length;
    updateLightbox();
  };

  const prevImage = (e) => {
    if (e) e.stopPropagation();
    currentIndex = (currentIndex - 1 + currentImages.length) % currentImages.length;
    updateLightbox();
  };

  // Event Listeners
  btnClose.addEventListener("click", closeLightbox);
  btnNext.addEventListener("click", nextImage);
  btnPrev.addEventListener("click", prevImage);
  
  // Close on backdrop click
  overlay.querySelector('.lightbox-backdrop').addEventListener("click", closeLightbox);

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (overlay.hasAttribute("hidden")) return;
    
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowRight") nextImage();
    else if (e.key === "ArrowLeft") prevImage();
  });

  // Global delegate listener for any element with .lightbox-trigger
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".lightbox-trigger");
    if (trigger) {
      e.preventDefault();
      try {
        const images = JSON.parse(trigger.dataset.images);
        const index = parseInt(trigger.dataset.index, 10) || 0;
        window.openLightbox(images, index);
      } catch (err) {
        console.error("Error parsing lightbox images", err);
      }
    }
  });
});
