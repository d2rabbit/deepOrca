/* global document, window, IntersectionObserver, requestAnimationFrame, setTimeout, console */
// DeepOrca GitHub Pages — Ocean Fresh interactions

// Navbar scroll state
const nav = document.getElementById("nav");
let lastScrollY = window.scrollY;
let ticking = false;

function updateNav() {
  const scrolled = window.scrollY > 20;
  nav.classList.toggle("scrolled", scrolled);

  // Hide/show on scroll direction (only after hero)
  if (window.scrollY > 120) {
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

// Reveal-on-scroll with stagger
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const parent = entry.target.parentElement;
        const siblings = Array.from(parent.querySelectorAll(".reveal"));
        const index = siblings.indexOf(entry.target);
        const delay = Math.min(index * 0.08, 0.4);

        entry.target.style.setProperty("--reveal-delay", `${delay}s`);
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
);

document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

// Smooth scroll for in-page anchors
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    const targetId = link.getAttribute("href");
    if (targetId === "#") return;

    const target = document.querySelector(targetId);
    if (target) {
      e.preventDefault();
      const navHeight = nav.offsetHeight;
      const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight - 20;

      window.scrollTo({ top: targetPosition, behavior: "smooth" });
    }
  });
});

// Subtle parallax for hero orca (gentler than before)
const hero = document.querySelector(".hero");
const orcaImg = document.querySelector(".orca-img");

if (hero && orcaImg) {
  let mouseX = 0.5;
  let mouseY = 0.5;
  let currentX = 0.5;
  let currentY = 0.5;
  let rafId = null;

  function lerp(start, end, factor) {
    return start + (end - start) * factor;
  }

  function animateParallax() {
    currentX = lerp(currentX, mouseX, 0.06);
    currentY = lerp(currentY, mouseY, 0.06);

    const moveX = (currentX - 0.5) * 12;
    const moveY = (currentY - 0.5) * 12;

    orcaImg.style.setProperty("--parallax-x", `${moveX}px`);
    orcaImg.style.setProperty("--parallax-y", `${moveY}px`);

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
        orcaImg.style.removeProperty("--parallax-x");
        orcaImg.style.removeProperty("--parallax-y");
      }
    }, 500);
  });
}

// Gentle card hover tilt (reduced intensity)
document.querySelectorAll(".pillar-card, .mod-card, .ext-card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;

    card.style.transform = `perspective(1000px) rotateY(${x * 2}deg) rotateX(${-y * 2}deg) translateY(-4px)`;
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "";
  });
});

// Button ripple (soft blue)
const style = document.createElement("style");
style.textContent = `
  @keyframes ripple {
    to { transform: scale(4); opacity: 0; }
  }
`;
document.head.appendChild(style);

document.querySelectorAll(".cbtn").forEach((btn) => {
  btn.addEventListener("click", function (e) {
    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ripple = document.createElement("span");
    ripple.style.cssText = `
      position: absolute;
      border-radius: 50%;
      background: rgba(56, 189, 248, 0.25);
      transform: scale(0);
      animation: ripple 0.5s ease-out;
      left: ${x}px;
      top: ${y}px;
      width: 80px;
      height: 80px;
      margin-left: -40px;
      margin-top: -40px;
      pointer-events: none;
    `;

    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  });
});

// Console greeting
console.log(
  "%c🐋 DeepOrca %c| AI 创作 Studio · 原型 · 设计 · 编码",
  "color: #38bdf8; font-size: 20px; font-weight: bold;",
  "color: #64748b; font-size: 12px;"
);
