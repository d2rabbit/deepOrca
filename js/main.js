/* DeepOrca Studio — theme toggle + scroll reveal */
(function () {
  "use strict";

  var root = document.documentElement;

  // Theme toggle — light & dark only, persisted.
  var toggle = document.getElementById("theme-toggle");
  toggle.addEventListener("click", function () {
    var next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("deeporca-theme", next);
    } catch (e) {
      /* private mode — theme just won't persist */
    }
  });

  // Reveal on scroll.
  var revealed = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealed.forEach(function (el) {
      io.observe(el);
    });
  } else {
    revealed.forEach(function (el) {
      el.classList.add("in");
    });
  }
})();
