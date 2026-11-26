document.querySelectorAll("[data-walkthrough]").forEach((figure) => {
  const controls = figure.querySelector("[data-walkthrough-controls]");
  const captionList = figure.querySelector(".walkthrough-captions");
  const captions = Array.from(captionList.children);
  const buttons = Array.from(controls.querySelectorAll("[data-go-step]"));
  const playButton = controls.querySelector('[data-action="play"]');
  const signals = figure.querySelectorAll("[data-reveal-at]");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const duration = 5500;
  let step = 1;
  let timer = null;
  let started = false;

  function update() {
    figure.setAttribute("data-active-step", step);
    figure.toggleAttribute("data-playing", timer !== null);
    buttons.forEach((button, index) => {
      if (index + 1 === step) {
        button.setAttribute("aria-current", "step");
      } else {
        button.removeAttribute("aria-current");
      }
    });
    captions.forEach((caption, index) => {
      caption.hidden = index + 1 !== step;
    });
    signals.forEach((signal) => {
      signal.classList.toggle("is-revealed", Number(signal.dataset.revealAt) <= step);
    });
    const pausedLabel = step === buttons.length ? "Replay" : "Play";
    playButton.textContent = timer !== null ? "Pause" : pausedLabel;
  }

  function pause() {
    window.clearInterval(timer);
    timer = null;
    update();
  }

  function play() {
    started = true;
    captionList.setAttribute("aria-live", "off");
    if (step === buttons.length) step = 1;
    timer = window.setInterval(() => {
      step += 1;
      if (step === buttons.length) {
        pause();
      } else {
        update();
      }
    }, duration);
    update();
  }

  playButton.addEventListener("click", () => {
    if (timer === null) play();
    else pause();
  });
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      started = true;
      step = Number(button.dataset.goStep);
      captionList.setAttribute("aria-live", "polite");
      pause();
    });
  });

  controls.hidden = false;
  captionList.setAttribute("aria-live", "off");
  update();
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && timer !== null) {
        pause();
      } else if (entry.intersectionRatio >= 0.4 && !started && !motion.matches && !document.hidden) {
        play();
      }
    }, { threshold: [0, 0.4] });
    observer.observe(figure);
  }
  motion.addEventListener("change", () => { if (motion.matches) pause(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
});

// Start the short cover animation when a reader reaches the paper in a long publication list.
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      target.classList.toggle("cover-in-view", isIntersecting);
    });
  });
  document.querySelectorAll("[data-training-cover]").forEach((cover) => observer.observe(cover));
}
