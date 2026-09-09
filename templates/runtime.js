
  (() => {
    "use strict";

    const config = JSON.parse(document.getElementById("roadbook-config").textContent);
    const cities = config.cities;
    const dayLabels = ["今", "明", "后"];

    function positionStayIcons() {
      document.querySelectorAll('.city-mark .label-stay').forEach(icon => {
        const box = icon.parentElement.querySelector('.map-city-label').getBBox();
        icon.setAttribute('transform', `translate(${box.x+box.width+4+16*.72} ${box.y+box.height/2}) scale(.72)`);
      });
    }
    function fitCityNames() {
      document.querySelectorAll('.station-meta .city').forEach(label => {
        label.style.fontSize = '';
        const width = label.parentElement.clientWidth;
        const size = parseFloat(getComputedStyle(label).fontSize);
        if (label.getBoundingClientRect().width > width) label.style.fontSize = `${Math.max(16, size * width / label.getBoundingClientRect().width)}px`;
      });
    }
    fitCityNames();
    window.addEventListener('resize', fitCityNames, {passive:true});
    document.fonts?.ready.then(fitCityNames);
    positionStayIcons();
    window.addEventListener('resize', positionStayIcons, {passive:true});
    document.fonts?.ready.then(positionStayIcons);

    function conditionFor(code) {
      if (code === 0) return { name: "晴", icon: "sun" };
      if (code === 1 || code === 2) return { name: "多云", icon: "cloud" };
      if (code === 3) return { name: "阴", icon: "overcast" };
      if (code === 45 || code === 48) return { name: "雾", icon: "fog" };
      if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { name: "雨", icon: "rain" };
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { name: "雪", icon: "snow" };
      if (code >= 95 && code <= 99) return { name: "雷雨", icon: "thunder" };
      return null;
    }

    function showUnavailable(container) {
      container.innerHTML = '<span class="weather-error">天气暂不可用</span>';
    }

    function renderForecast(container, city, response) {
      const daily = response && response.daily;
      const codes = daily && daily.weather_code;
      const highs = daily && daily.temperature_2m_max;
      const lows = daily && daily.temperature_2m_min;
      if (![codes, highs, lows].every(values => Array.isArray(values) && values.length >= 3)) {
        showUnavailable(container);
        return;
      }

      const dates = daily.time;
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
      if (!Array.isArray(dates) || dates[0] !== today || dates.slice(0, 3).some((d, i) => Date.parse(d) !== Date.parse(today) + i * 86400000)) throw new Error("Stale forecast");
      const summaries = [];
      const cards = dayLabels.map((label, index) => {
        if ([codes[index], highs[index], lows[index]].some(v => v === null || typeof v !== "number")) throw new Error("Missing forecast");
        const code = Number(codes[index]);
        const high = Number(highs[index]);
        const low = Number(lows[index]);
        const condition = conditionFor(code);
        if (!condition || !Number.isFinite(high) || !Number.isFinite(low)) throw new Error("Invalid forecast data");
        const roundedHigh = Math.round(high);
        const roundedLow = Math.round(low);
        summaries.push(`${label}${condition.name}${roundedHigh}至${roundedLow}度`);
        return `<span class="weather-day"><span class="weather-label">${label}</span><svg class="weather-icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#wx-${condition.icon}"/></svg><span class="weather-temp">${roundedHigh}°/${roundedLow}°</span><span class="weather-name">${condition.name}</span></span>`;
      });
      container.innerHTML = cards.join("");
      container.setAttribute("aria-label", `${city.name}未来三天天气：${summaries.join("，")}`);
    }

    async function loadWeather() {
      if (!cities.length) return;
      const params = new URLSearchParams({
        latitude: cities.map(city => city.latitude).join(","),
        longitude: cities.map(city => city.longitude).join(","),
        daily: "weather_code,temperature_2m_max,temperature_2m_min",
        forecast_days: "3",
        timezone: "Asia/Shanghai",
        temperature_unit: "celsius"
      });
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
        const data = await response.json();
        const forecasts = Array.isArray(data) ? data : cities.length === 1 ? [data] : [];
        cities.forEach((city, index) => {
          const containers = document.querySelectorAll(`[data-weather-city="${city.id}"]`);
          containers.forEach(container => {
          try {
            renderForecast(container, city, forecasts[index]);
          } catch (error) {
            showUnavailable(container);
          }
          });
        });
      } catch (error) {
        document.querySelectorAll("[data-weather-city]").forEach(showUnavailable);
      } finally {
        window.clearTimeout(timeout);
      }
    }


    const isMobileDevice = /Android|iPhone|iPad|iPod|HarmonyOS/i.test(navigator.userAgent);
    document.querySelectorAll(".food-search[data-fallback]").forEach(link => {
      link.addEventListener("click", event => {
        const fallback = link.dataset.fallback;
        if (!fallback) return;
        if (!isMobileDevice) {
          event.preventDefault();
          window.open(fallback, "_blank", "noopener,noreferrer");
          return;
        }
        const timer = window.setTimeout(() => {
          if (!document.hidden) window.location.href = fallback;
        }, 1200);
        const cancel = () => window.clearTimeout(timer);
        window.addEventListener("pagehide", cancel, { once: true });
        document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); }, { once: true });
      });
    });

    const setupChecklist = () => {
      const trigger = document.getElementById("note-trigger");
      const dialog = document.getElementById("checklist-dialog");
      const closeButton = dialog?.querySelector(".checklist-close");
      const list = document.getElementById("checklist-list");
      const form = document.getElementById("checklist-form");
      const input = document.getElementById("checklist-input");
      if (!trigger || !dialog || !closeButton || !list || !form || !input) return;

      const storageKey = `roadbook-town:checklist:v1:${config.tripId}`;
      const defaultItems = [
        "驾驶证和行驶证",
        "身份证等随身证件",
        "检查油量或电量",
        "检查轮胎和胎压",
        "ETC与导航设备",
        "手机、充电线和充电宝",
        "常用药和急救用品",
        "饮用水与简单食物"
      ].map((text, index) => ({ id: `default-${index + 1}`, text, checked: false }));

      const cloneDefaults = () => defaultItems.map(item => ({ ...item }));
      const createId = () => {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      };
      const loadItems = () => {
        try {
          const saved = window.localStorage.getItem(storageKey);
          if (saved === null) return cloneDefaults();
          const parsed = JSON.parse(saved);
          if (!Array.isArray(parsed)) throw new Error("Invalid checklist data");
          return parsed
            .filter(item => item && typeof item.text === "string" && item.text.trim())
            .slice(0, 200)
            .map(item => ({
              id: typeof item.id === "string" && item.id ? item.id : createId(),
              text: item.text.trim().slice(0, 30),
              checked: Boolean(item.checked)
            }));
        } catch (error) {
          return cloneDefaults();
        }
      };
      const saveItems = () => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(items));
        } catch (error) {
          // 存储不可用时仍保留当前页面会话中的清单。
        }
      };

      let items = loadItems();

      const makeDeleteIcon = () => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("viewBox", "0 0 18 18");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("fill", "currentColor");
        path.setAttribute("d", "M5 2h8v2h3v2h-2v10H4V6H2V4h3zm2 4v7h2V6zm4 0v7h2V6zM7 1h4v2H7z");
        svg.append(path);
        return svg;
      };

      const renderItems = () => {
        const fragment = document.createDocumentFragment();
        if (!items.length) {
          const empty = document.createElement("li");
          empty.className = "checklist-empty";
          empty.textContent = "还没有准备事项";
          fragment.append(empty);
        } else {
          items.forEach((item, index) => {
            const row = document.createElement("li");
            row.className = `checklist-item${item.checked ? " is-done" : ""}`;

            const checkbox = document.createElement("input");
            checkbox.className = "checklist-check";
            checkbox.type = "checkbox";
            checkbox.id = `checklist-item-${index}`;
            checkbox.checked = item.checked;
            checkbox.setAttribute("aria-label", `${item.checked ? "取消完成" : "标记完成"}：${item.text}`);
            checkbox.addEventListener("change", () => {
              item.checked = checkbox.checked;
              saveItems();
              renderItems();
            });

            const text = document.createElement("label");
            text.className = "checklist-text";
            text.htmlFor = checkbox.id;
            text.textContent = item.text;

            const remove = document.createElement("button");
            remove.className = "checklist-delete";
            remove.type = "button";
            remove.setAttribute("aria-label", `删除：${item.text}`);
            remove.append(makeDeleteIcon());
            remove.addEventListener("click", () => {
              items = items.filter(candidate => candidate.id !== item.id);
              saveItems();
              renderItems();
            });

            row.append(checkbox, text, remove);
            fragment.append(row);
          });
        }
        list.replaceChildren(fragment);
      };

      const finishClose = () => {
        document.body.classList.remove("modal-open");
        trigger.focus({ preventScroll: true });
      };
      const closeDialog = () => {
        if (typeof dialog.close === "function") dialog.close();
        else {
          dialog.removeAttribute("open");
          finishClose();
        }
      };

      trigger.addEventListener("click", () => {
        document.body.classList.add("modal-open");
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
        closeButton.focus();
      });
      closeButton.addEventListener("click", closeDialog);
      dialog.addEventListener("close", finishClose);
      dialog.addEventListener("click", event => {
        if (event.target === dialog) closeDialog();
      });
      form.addEventListener("submit", event => {
        event.preventDefault();
        const text = input.value.trim().replace(/\s+/g, " ").slice(0, 30);
        if (!text) {
          input.value = "";
          input.focus();
          return;
        }
        items.push({ id: createId(), text, checked: false });
        saveItems();
        renderItems();
        input.value = "";
        input.focus();
      });

      renderItems();
    };

    const setupQuickNav = () => {
      const track = document.querySelector(".quick-nav-track");
      if (!track) return;

      const entries = Array.from(track.querySelectorAll('a[href^="#"]'))
        .map(link => ({ link, target: document.getElementById(link.hash.slice(1)) }))
        .filter(entry => entry.target);
      if (!entries.length) return;

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let activeId = "";
      let frame = 0;
      let lockedTarget = "";
      let unlockTimer = 0;

      const centerLink = link => {
        const maxLeft = Math.max(0, track.scrollWidth - track.clientWidth);
        const desiredLeft = link.offsetLeft - (track.clientWidth - link.offsetWidth) / 2;
        track.scrollTo({
          left: Math.max(0, Math.min(maxLeft, desiredLeft)),
          behavior: reducedMotion.matches ? "auto" : "smooth"
        });
      };

      const setActive = id => {
        if (activeId === id) return;
        activeId = id;
        entries.forEach(({ link, target }) => {
          const selected = target.id === id;
          link.classList.toggle("is-active", selected);
          if (selected) {
            link.setAttribute("aria-current", "location");
            centerLink(link);
          } else {
            link.removeAttribute("aria-current");
          }
        });
      };

      const updateFromScroll = force => {
        if (lockedTarget && !force) return;
        const readingLine = window.innerHeight * 0.33;
        let current = entries[0];
        for (const entry of entries) {
          if (entry.target.getBoundingClientRect().top <= readingLine) current = entry;
          else break;
        }
        const pageBottom = window.scrollY + window.innerHeight;
        if (pageBottom >= document.documentElement.scrollHeight - 4) current = entries[entries.length - 1];
        setActive(current.target.id);
      };

      const releaseClickLock = () => {
        if (!lockedTarget) return;
        lockedTarget = "";
        window.clearTimeout(unlockTimer);
        updateFromScroll(true);
      };

      entries.forEach(({ link, target }) => {
        link.addEventListener("click", () => {
          lockedTarget = target.id;
          setActive(target.id);
          window.clearTimeout(unlockTimer);
          unlockTimer = window.setTimeout(releaseClickLock, reducedMotion.matches ? 0 : 1000);
        });
      });

      const requestUpdate = () => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          updateFromScroll(false);
        });
      };

      window.addEventListener("scroll", requestUpdate, { passive: true });
      window.addEventListener("resize", requestUpdate, { passive: true });
      window.addEventListener("scrollend", releaseClickLock, { passive: true });

      const initialTarget = entries.find(({ target }) => `#${target.id}` === window.location.hash);
      if (initialTarget) setActive(initialTarget.target.id);
      else updateFromScroll(true);
    };

    const setupMobileMotionFallback = () => {
      const touchDevice = window.matchMedia("(hover: none) and (pointer: coarse)").matches || navigator.maxTouchPoints > 0;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (!touchDevice) return;

      const originals = new WeakMap();
      const animatedSelector = ".anim-tree,.water-band,.smoke,.blink,.fish,.wx-sun,.wx-cloud,.wx-rain,.wx-fog,.wx-snow,.wx-bolt,.route-car,.car-wheel";

      const prepare = element => {
        if (originals.has(element)) return originals.get(element);
        const original = {
          transform: element.getAttribute("transform") || "",
          opacity: element.style.opacity
        };
        originals.set(element, original);
        element.style.animation = "none";
        element.style.webkitAnimation = "none";
        element.style.willChange = "transform, opacity";
        return original;
      };

      const move = (element, x, y) => {
        const original = prepare(element);
        const offset = x || y ? `translate(${x} ${y})` : "";
        element.setAttribute("transform", [original.transform, offset].filter(Boolean).join(" "));
      };

      const fade = (element, opacity) => {
        prepare(element);
        element.style.opacity = String(opacity);
      };

      reducedMotion.addEventListener("change", () => {
        document.querySelectorAll(animatedSelector).forEach(element => {
          const original = originals.get(element);
          if (!original) return;
          element.setAttribute("transform", original.transform);
          element.style.transform = "";
          element.style.opacity = original.opacity;
        });
      });
      let previousStep = -1;
      const render = now => {
        if (reducedMotion.matches || document.hidden) {
          window.requestAnimationFrame(render);
          return;
        }
        const step = Math.floor(now / 420);
        if (step !== previousStep) {
          previousStep = step;
          const pulse = step % 8;
          const sway = pulse >= 3 && pulse <= 5 ? 3 : 0;
          const ripple = pulse % 4 >= 2 ? 2 : 0;
          document.querySelectorAll(animatedSelector).forEach((element, index) => {
            if (element.classList.contains("route-car")) {
              prepare(element);
              const carIndex = Number(element.dataset.carIndex || 0);
              const carStep = (pulse + carIndex) % 8;
              const carOffset = -5 + Math.min(5, carStep) * 2;
              element.style.transform = `translate3d(0,${carOffset}px,0)`;
            } else if (element.classList.contains("car-wheel")) {
              fade(element, pulse % 2 ? 0.58 : 1);
            } else if (element.classList.contains("anim-tree")) move(element, sway, 0);
            else if (element.classList.contains("water-band") || element.classList.contains("fish")) move(element, ripple, 0);
            else if (element.classList.contains("smoke")) {
              const smokeStep = (pulse + index) % 8;
              move(element, 0, 3 - Math.min(6, smokeStep));
              fade(element, smokeStep === 0 || smokeStep === 7 ? 0 : 1);
            } else if (element.classList.contains("blink") || element.classList.contains("wx-bolt")) {
              fade(element, pulse === 6 ? 0.18 : 1);
            } else if (element.classList.contains("wx-cloud") || element.classList.contains("wx-fog")) {
              move(element, ripple, 0);
            } else if (element.classList.contains("wx-rain") || element.classList.contains("wx-snow")) {
              move(element, 0, ripple);
            } else if (element.classList.contains("wx-sun")) {
              fade(element, pulse === 4 ? 0.72 : 1);
            }
          });
        }
        window.requestAnimationFrame(render);
      };

      window.requestAnimationFrame(render);
    };

    setupChecklist();
    setupQuickNav();
    loadWeather();
    setupMobileMotionFallback();
  })();
