/* global document, window, IntersectionObserver, requestAnimationFrame, cancelAnimationFrame, setTimeout, console */
// DeepOrca GitHub Pages — Cyber HUD interactions

// Navbar scroll state with enhanced transition
const nav = document.getElementById("nav");
let lastScrollY = window.scrollY;
let ticking = false;

function updateNav() {
  const scrolled = window.scrollY > 20;
  nav.classList.toggle("scrolled", scrolled);

  // Add subtle hide/show on scroll direction
  if (window.scrollY > 100) {
    if (window.scrollY > lastScrollY) {
      nav.style.transform = "translateY(-100%)";
    } else {
      nav.style.transform = "translateY(0)";
    }
  } else {
    nav.style.transform = "translateY(0)";
  }
  lastScrollY = window.scrollY;
  ticking = false;
}

window.addEventListener(
  "scroll",
  () => {
    if (!ticking) {
      window.requestAnimationFrame(updateNav);
      ticking = true;
    }
  },
  { passive: true }
);

// Reveal-on-scroll with stagger support
const observerOptions = {
  threshold: 0.12,
  rootMargin: "0px 0px -40px 0px",
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      // Add stagger delay based on element index within parent
      const parent = entry.target.parentElement;
      const siblings = Array.from(parent.querySelectorAll(".reveal"));
      const index = siblings.indexOf(entry.target);
      const delay = Math.min(index * 0.08, 0.4); // Cap at 0.4s

      entry.target.style.setProperty("--reveal-delay", `${delay}s`);
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

// Smooth scroll for in-page anchors with offset for sticky nav
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    const targetId = link.getAttribute("href");
    if (targetId === "#") return;

    const target = document.querySelector(targetId);
    if (target) {
      e.preventDefault();
      const navHeight = nav.offsetHeight;
      const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight - 20;

      window.scrollTo({
        top: targetPosition,
        behavior: "smooth",
      });
    }
  });
});

// Parallax effect for hero section
const hero = document.querySelector(".hero");
const orcaImg = document.querySelector(".orca-img");
const bgGlowCyan = document.querySelector(".bg-glow--cyan");
const bgGlowMagenta = document.querySelector(".bg-glow--magenta");

if (hero && orcaImg) {
  let mouseX = 0;
  let mouseY = 0;
  let currentX = 0;
  let currentY = 0;
  let rafId = null;

  function lerp(start, end, factor) {
    return start + (end - start) * factor;
  }

  function animateParallax() {
    currentX = lerp(currentX, mouseX, 0.08);
    currentY = lerp(currentY, mouseY, 0.08);

    const moveX = (currentX - 0.5) * 20;
    const moveY = (currentY - 0.5) * 20;

    orcaImg.style.transform = `translate(${moveX}px, ${moveY}px)`;

    if (bgGlowCyan) {
      bgGlowCyan.style.transform = `translate(${moveX * 0.5}px, ${moveY * 0.5}px)`;
    }
    if (bgGlowMagenta) {
      bgGlowMagenta.style.transform = `translate(${-moveX * 0.3}px, ${-moveY * 0.3}px)`;
    }

    rafId = requestAnimationFrame(animateParallax);
  }

  hero.addEventListener("mousemove", (e) => {
    const rect = hero.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) / rect.width;
    mouseY = (e.clientY - rect.top) / rect.height;

    if (!rafId) {
      rafId = requestAnimationFrame(animateParallax);
    }
  });

  hero.addEventListener("mouseleave", () => {
    mouseX = 0.5;
    mouseY = 0.5;
    setTimeout(() => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
        orcaImg.style.transform = "";
        if (bgGlowCyan) bgGlowCyan.style.transform = "";
        if (bgGlowMagenta) bgGlowMagenta.style.transform = "";
      }
    }, 500);
  });
}

// Typing effect for HUD window
const hudBody = document.querySelector(".hud-window-body");
if (hudBody) {
  const lines = hudBody.querySelectorAll("div");
  lines.forEach((line, index) => {
    line.style.opacity = "0";
    line.style.transform = "translateX(-8px)";
    line.style.transition = `opacity 0.4s ease ${index * 0.15}s, transform 0.4s ease ${index * 0.15}s`;
  });

  const hudObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          lines.forEach((line) => {
            line.style.opacity = "1";
            line.style.transform = "translateX(0)";
          });
          hudObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );

  hudObserver.observe(hudBody);
}

// Card tilt effect on mouse move
document.querySelectorAll(".mod-card, .ext-card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;

    card.style.transform = `perspective(1000px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg) translateY(-6px)`;
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "";
  });
});

// Button ripple effect
document.querySelectorAll(".cbtn").forEach((btn) => {
  btn.addEventListener("click", function (e) {
    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ripple = document.createElement("span");
    ripple.style.cssText = `
      position: absolute;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.3);
      transform: scale(0);
      animation: ripple 0.6s ease-out;
      left: ${x}px;
      top: ${y}px;
      width: 100px;
      height: 100px;
      margin-left: -50px;
      margin-top: -50px;
      pointer-events: none;
    `;

    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
});

// Add ripple keyframes dynamically
const style = document.createElement("style");
style.textContent = `
  @keyframes ripple {
    to {
      transform: scale(4);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Console easter egg
console.log(
  "%c🐋 DeepOrca %c| Cyber HUD Interface",
  "color: #00f3ff; font-size: 24px; font-weight: bold; text-shadow: 0 0 10px #00f3ff;",
  "color: #8b9bb4; font-size: 12px;"
);
