/* ============================================================
   QuickDrop 官网脚本
   - 截图轮播
   - 数据统计动画
   - 滚动时导航栏样式
   - 下载链接动态指向 GitHub Releases
   ============================================================ */

// GitHub 仓库配置（修改为你的仓库）
const GITHUB_REPO = 'quickdrop/quickdrop';  // 修改为实际仓库
const LATEST_RELEASE_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

// 平台下载配置
const DOWNLOADS = {
  'macOS': {
    fallback: '/downloads/quickdrop-macos.dmg',
    // 如果用 GitHub Releases，可以指向具体文件名
    release: `${LATEST_RELEASE_URL}/download/QuickDrop_${GITHUB_REPO}_macos.dmg`,
  },
  'Windows': {
    fallback: '/downloads/quickdrop-windows.msi',
    release: `${LATEST_RELEASE_URL}/download/QuickDrop_${GITHUB_REPO}_windows.msi`,
  },
  'Android': {
    fallback: '/downloads/quickdrop-android.apk',
    release: `${LATEST_RELEASE_URL}/download/QuickDrop_${GITHUB_REPO}_android.apk`,
  },
  'iOS': {
    // iOS 无法直接下载 .ipa（需要 App Store 或 TestFlight）
    // 这里指向 App Store 或 TestFlight 链接
    fallback: 'https://apps.apple.com/app/quickdrop/id1234567890',  // 修改为真实 App Store ID
    release: 'https://testflight.apple.com/join/your-code',  // 或 TestFlight
  },
};

(function () {
  'use strict';

  // ============================================================
  // 截图轮播
  // ============================================================
  class Carousel {
    constructor(trackEl, dotsContainer, prevBtn, nextBtn) {
      this.track = trackEl;
      this.dotsContainer = dotsContainer;
      this.prevBtn = prevBtn;
      this.nextBtn = nextBtn;
      this.slides = Array.from(trackEl.children);
      this.currentIndex = 0;
      this.autoPlayInterval = null;

      this.init();
    }

    init() {
      this.createDots();
      this.bindEvents();
      this.startAutoPlay();
      this.update();
    }

    createDots() {
      this.slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `第 ${i + 1} 张`);
        dot.addEventListener('click', () => this.goTo(i));
        this.dotsContainer.appendChild(dot);
      });
      this.dots = Array.from(this.dotsContainer.children);
    }

    bindEvents() {
      this.prevBtn.addEventListener('click', () => {
        this.prev();
        this.restartAutoPlay();
      });

      this.nextBtn.addEventListener('click', () => {
        this.next();
        this.restartAutoPlay();
      });

      // 触摸滑动支持
      let startX = 0;
      let isDragging = false;

      this.track.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
        this.stopAutoPlay();
      }, { passive: true });

      this.track.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        const endX = e.changedTouches[0].clientX;
        const diff = startX - endX;
        if (Math.abs(diff) > 50) {
          diff > 0 ? this.next() : this.prev();
        }
        isDragging = false;
        this.startAutoPlay();
      }, { passive: true });
    }

    goTo(index) {
      this.currentIndex = (index + this.slides.length) % this.slides.length;
      this.update();
    }

    next() {
      this.goTo(this.currentIndex + 1);
    }

    prev() {
      this.goTo(this.currentIndex - 1);
    }

    update() {
      // 滚动到当前 slide
      const slide = this.slides[this.currentIndex];
      if (slide) {
        const trackRect = this.track.getBoundingClientRect();
        const slideRect = slide.getBoundingClientRect();
        const scrollLeft = this.track.scrollLeft + (slideRect.left - trackRect.left) - (trackRect.width - slideRect.width) / 2;
        this.track.scrollTo({ left: scrollLeft, behavior: 'smooth' });
      }

      // 更新 dots
      this.dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === this.currentIndex);
      });
    }

    startAutoPlay() {
      this.stopAutoPlay();
      this.autoPlayInterval = setInterval(() => this.next(), 5000);
    }

    stopAutoPlay() {
      if (this.autoPlayInterval) {
        clearInterval(this.autoPlayInterval);
        this.autoPlayInterval = null;
      }
    }

    restartAutoPlay() {
      this.stopAutoPlay();
      this.startAutoPlay();
    }
  }

  // ============================================================
  // 数据统计动画
  // ============================================================
  class CountUp {
    constructor(el, target, duration = 2000) {
      this.el = el;
      this.target = target;
      this.duration = duration;
      this.hasAnimated = false;
    }

    animate() {
      if (this.hasAnimated) return;
      this.hasAnimated = true;

      const startTime = performance.now();
      const startValue = 0;

      const tick = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / this.duration, 1);
        // 缓动函数：easeOutCubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = startValue + (this.target - startValue) * eased;
        this.el.textContent = Math.round(value);

        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          this.el.textContent = this.target;
        }
      };

      requestAnimationFrame(tick);
    }
  }

  // ============================================================
  // IntersectionObserver 触发动画
  // ============================================================
  function setupScrollAnimations() {
    const options = {
      threshold: 0.2,
      rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, options);

    // 观察所有 stat-item
    document.querySelectorAll('.stat-item').forEach((el) => {
      observer.observe(el);
    });
  }

  // ============================================================
  // 导航栏滚动效果
  // ============================================================
  function setupNavScroll() {
    const nav = document.querySelector('.nav');

    window.addEventListener('scroll', () => {
      const currentScroll = window.pageYOffset;
      if (currentScroll > 50) {
        nav.style.background = 'rgba(10, 10, 15, 0.85)';
        nav.style.borderBottomColor = 'rgba(255, 255, 255, 0.1)';
      } else {
        nav.style.background = 'rgba(10, 10, 15, 0.6)';
        nav.style.borderBottomColor = 'rgba(255, 255, 255, 0.08)';
      }
    }, { passive: true });
  }

  // ============================================================
  // 平滑滚动
  // ============================================================
  function setupSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;

        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          const navHeight = 70;
          const targetPos = target.getBoundingClientRect().top + window.pageYOffset - navHeight;
          window.scrollTo({
            top: targetPos,
            behavior: 'smooth'
          });
        }
      });
    });
  }

  // ============================================================
  // 统计数字动画
  // ============================================================
  function setupStatsCounter() {
    const stats = document.querySelectorAll('.stat-value');
    const counters = Array.from(stats).map((el) => {
      const target = parseInt(el.dataset.target, 10);
      return new CountUp(el, target, 1500);
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const index = Array.from(stats).indexOf(entry.target);
          if (index >= 0 && counters[index]) {
            counters[index].animate();
          }
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    stats.forEach((stat) => observer.observe(stat));
  }

  // ============================================================
  // 平台下载按钮
  // ============================================================
  function setupDownloadButtons() {
    const cards = document.querySelectorAll('.download-card');
    cards.forEach((card) => {
      // 显示点击反馈
      card.addEventListener('click', (e) => {
        const name = card.querySelector('.download-name').textContent;
        const config = DOWNLOADS[name];
        const href = card.getAttribute('href');

        // 如果是真实下载链接，添加视觉反馈
        if (config && href && href !== '#' && !href.startsWith('javascript')) {
          // 添加下载中状态
          card.style.opacity = '0.7';
          card.style.pointerEvents = 'none';
          setTimeout(() => {
            card.style.opacity = '';
            card.style.pointerEvents = '';
          }, 1500);

          // 控制台日志（调试用）
          console.log(`📥 下载 QuickDrop for ${name}: ${href}`);
        } else if (!config) {
          // 未配置的平台
          e.preventDefault();
          alert(`QuickDrop for ${name} 即将推出\n\n关注 GitHub 获取最新发布：\n${LATEST_RELEASE_URL}`);
        }
      });
    });
  }

  // ============================================================
  // 启动
  // ============================================================
  function init() {
    // 截图轮播
    const track = document.getElementById('carouselTrack');
    const dots = document.getElementById('carouselDots');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    if (track && dots && prevBtn && nextBtn) {
      new Carousel(track, dots, prevBtn, nextBtn);
    }

    // 其他功能
    setupStatsCounter();
    setupNavScroll();
    setupSmoothScroll();
    setupScrollAnimations();
    setupDownloadButtons();

    console.log('🎉 QuickDrop 官网已加载');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
