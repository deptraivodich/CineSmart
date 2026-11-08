import React, { useRef, useState, useEffect, useId, useCallback } from 'react';

/**
 * ContinuousMarquee Component
 * 
 * Continuous auto-scroll / marquee for movie card rows with Interactive Fast-Forward Scrubbing:
 * 1. Seamless Infinite Auto-Scroll: Mathematically wraps cycle distance D without visible jump.
 * 2. Interactive Mouse Wheel Scrubbing: Roll wheel to glide/tua quickly forward & backward.
 * 3. Drag-to-Scrub: Click and drag with mouse/touch to scrub back and forth with momentum inertia.
 * 4. Fast-Forward Arrows: Hover reveals Left (‹) & Right (›) buttons to jump through cards instantly.
 * 5. Safe Link Navigation: Normal clicks navigate to movies; dragging cancels accidental clicks.
 * 6. Direction & Speed: Configurable direction ('right' or 'left') and speed (px/s).
 */
const ContinuousMarquee = ({
  items = [],
  direction = 'right',
  speed = 30, // px per second
  renderItem,
  loop = true,
  gapClass = 'gap-3 sm:gap-4',
  className = ''
}) => {
  const rawId = useId();
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');

  const containerRef = useRef(null);
  const trackRef = useRef(null);
  const set0Ref = useRef(null);
  const set1Ref = useRef(null);

  const [cycleWidth, setCycleWidth] = useState(0);
  const [numSets, setNumSets] = useState(4);
  const [isMeasured, setIsMeasured] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Animation & Physics Refs
  const currentOffsetRef = useRef(0);
  const velocityRef = useRef(0);
  const isDraggingRef = useRef(false);
  const isHoveredRef = useRef(false);
  const lastInteractionTimeRef = useRef(0);
  const hasDraggedRef = useRef(false);
  const pointerDownPosRef = useRef({ x: 0, y: 0, time: 0 });
  const lastPointerPosRef = useRef({ x: 0, time: 0 });
  const rafIdRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const cycleWidthRef = useRef(0);
  const initializedOffsetRef = useRef(false);

  const safeSpeed = speed > 0 ? speed : 30;
  const loopEnabled = loop && Array.isArray(items) && items.length >= 4;

  // Exact measurement of 1 full cycle (D), including the junction gap
  const measureCycle = useCallback(() => {
    if (!set0Ref.current || !set1Ref.current || !containerRef.current) return;

    const set0Left = set0Ref.current.offsetLeft;
    const set1Left = set1Ref.current.offsetLeft;
    const d = set1Left - set0Left;

    if (d > 0) {
      setCycleWidth(d);
      cycleWidthRef.current = d;
      setIsMeasured(true);

      if (!initializedOffsetRef.current) {
        currentOffsetRef.current = -d;
        initializedOffsetRef.current = true;
      }

      const viewportWidth = containerRef.current.clientWidth || window.innerWidth;
      // Ensure enough duplicate sets to cover at least 2*D + viewport width
      const neededSets = Math.max(4, Math.ceil((2 * d + viewportWidth) / d) + 1);
      setNumSets((prev) => Math.max(prev, neededSets));
    }
  }, []);

  useEffect(() => {
    if (!loopEnabled) return;
    measureCycle();

    const handleResize = () => {
      measureCycle();
    };
    window.addEventListener('resize', handleResize);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && set0Ref.current && containerRef.current) {
      observer = new ResizeObserver(() => {
        measureCycle();
      });
      observer.observe(set0Ref.current);
      observer.observe(containerRef.current);
    }

    const timer = setTimeout(measureCycle, 150);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (observer) observer.disconnect();
      clearTimeout(timer);
    };
  }, [items, measureCycle, loopEnabled]);

  // Main 60fps RequestAnimationFrame Loop
  useEffect(() => {
    if (!loopEnabled || !isMeasured || cycleWidth <= 0) return;

    const animate = (timestamp) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp;
      }
      const dt = Math.min((timestamp - lastFrameTimeRef.current) / 1000, 0.1);
      lastFrameTimeRef.current = timestamp;

      const d = cycleWidthRef.current;
      if (d > 0) {
        const now = Date.now();
        const isInteracting = isDraggingRef.current || (now - lastInteractionTimeRef.current < 900);

        if (isDraggingRef.current) {
          // Offset is handled directly by pointermove
        } else if (Math.abs(velocityRef.current) > 1) {
          // Apply velocity momentum decay
          currentOffsetRef.current += velocityRef.current * dt;
          velocityRef.current *= Math.pow(0.86, dt * 60);
        } else {
          velocityRef.current = 0;
          // Normal auto-scroll when not hovered and not interacting
          if (!isHoveredRef.current && !isInteracting) {
            const dirMult = direction === 'right' ? 1 : -1;
            currentOffsetRef.current += dirMult * safeSpeed * dt;
          }
        }

        // Mathematical infinite wrapping between -2*d and -d
        while (currentOffsetRef.current > -d) {
          currentOffsetRef.current -= d;
        }
        while (currentOffsetRef.current < -2 * d) {
          currentOffsetRef.current += d;
        }

        if (trackRef.current) {
          trackRef.current.style.transform = `translate3d(${currentOffsetRef.current}px, 0, 0)`;
        }
      }

      rafIdRef.current = requestAnimationFrame(animate);
    };

    rafIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [isMeasured, cycleWidth, direction, safeSpeed, loopEnabled]);

  // Native non-passive Mouse Wheel Listener (allows smooth horizontal scrubbing without jumping page)
  useEffect(() => {
    const container = containerRef.current;
    if (!loopEnabled || !container) return;

    const handleWheel = (e) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) > 2) {
        // Prevent vertical page scroll while user scrubs the movie marquee
        e.preventDefault();

        lastInteractionTimeRef.current = Date.now();
        const scrubAmount = delta * 1.5;
        currentOffsetRef.current -= scrubAmount;
        velocityRef.current = -scrubAmount * 9; // smooth momentum follow-through
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [loopEnabled]);

  // Pointer / Drag-to-Scrub Handlers
  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return; // Only primary button

    isDraggingRef.current = true;
    setIsDragging(true);
    hasDraggedRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    lastPointerPosRef.current = { x: e.clientX, time: Date.now() };
    velocityRef.current = 0;
    lastInteractionTimeRef.current = Date.now();
  };

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current) return;

    const dx = e.clientX - lastPointerPosRef.current.x;
    const totalDx = e.clientX - pointerDownPosRef.current.x;
    const now = Date.now();
    const dt = Math.max(now - lastPointerPosRef.current.time, 1);

    if (Math.abs(totalDx) > 6) {
      hasDraggedRef.current = true;
    }

    currentOffsetRef.current += dx;
    velocityRef.current = (dx / dt) * 1000;

    lastPointerPosRef.current = { x: e.clientX, time: now };
    lastInteractionTimeRef.current = now;
  };

  const handlePointerUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    lastInteractionTimeRef.current = Date.now();

    // Clamp velocity to reasonable limit
    velocityRef.current = Math.max(-1800, Math.min(1800, velocityRef.current));

    // Release drag lock after brief delay so current click event can be intercepted
    setTimeout(() => {
      hasDraggedRef.current = false;
    }, 120);
  };

  // Prevent opening links if the user was dragging/scrubbing
  const handleClickCapture = (e) => {
    if (hasDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Fast-Forward Step by Arrow Buttons (~320px per click)
  const handleStep = (stepDir) => {
    if (!loopEnabled) {
      containerRef.current?.scrollBy({ left: stepDir * 320, behavior: 'smooth' });
      return;
    }
    lastInteractionTimeRef.current = Date.now();
    // stepDir: -1 for left (tua lùi), 1 for right (tua tới)
    velocityRef.current = -stepDir * 1400;
  };

  if (!items || items.length === 0) return null;

  const setsArray = Array.from({ length: loopEnabled ? numSets : 1 });

  return (
    <div
      ref={containerRef}
      onPointerDown={loopEnabled ? handlePointerDown : undefined}
      onPointerMove={loopEnabled ? handlePointerMove : undefined}
      onPointerUp={loopEnabled ? handlePointerUp : undefined}
      onPointerCancel={loopEnabled ? handlePointerUp : undefined}
      onClickCapture={handleClickCapture}
      onMouseEnter={() => {
        isHoveredRef.current = true;
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
        setIsHovered(false);
        handlePointerUp();
      }}
      onDragStart={(e) => e.preventDefault()}
      className={`group/marquee relative w-full min-w-0 overflow-y-hidden py-8 -my-4 select-none ${
        loopEnabled ? 'overflow-x-hidden touch-pan-y' : 'overflow-x-auto no-scrollbar'
      } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${className}`}
    >
      {/* Edge Shadow Fades for Cinema Look */}
      <div className="absolute left-0 top-0 bottom-0 w-8 sm:w-16 bg-gradient-to-r from-[#0b0f19] to-transparent pointer-events-none z-20" />
      <div className="absolute right-0 top-0 bottom-0 w-8 sm:w-16 bg-gradient-to-l from-[#0b0f19] to-transparent pointer-events-none z-20" />

      {/* Fast-Forward Arrow Navigation Buttons */}
      <button
        type="button"
        onClick={() => handleStep(-1)}
        className="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 z-30 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-black/80 hover:bg-neon-cyan text-white hover:text-black border border-white/20 hover:border-neon-cyan backdrop-blur-md flex items-center justify-center transition-all duration-300 opacity-0 group-hover/marquee:opacity-100 hover:scale-110 shadow-[0_4px_20px_rgba(0,0,0,0.8)] cursor-pointer select-none active:scale-95"
        aria-label="Tua lùi"
        title="Tua lùi (Cuộn chuột hoặc bấm để lướt qua nhanh)"
      >
        <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => handleStep(1)}
        className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 z-30 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-black/80 hover:bg-neon-cyan text-white hover:text-black border border-white/20 hover:border-neon-cyan backdrop-blur-md flex items-center justify-center transition-all duration-300 opacity-0 group-hover/marquee:opacity-100 hover:scale-110 shadow-[0_4px_20px_rgba(0,0,0,0.8)] cursor-pointer select-none active:scale-95"
        aria-label="Tua tới"
        title="Tua tới (Cuộn chuột hoặc bấm để lướt qua nhanh)"
      >
        <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
        </svg>
      </button>

      {/* Marquee Track */}
      <div
        ref={trackRef}
        className={`flex flex-nowrap items-center ${gapClass} w-max will-change-transform`}
        style={{
          transform: loopEnabled ? `translate3d(${currentOffsetRef.current}px, 0, 0)` : undefined
        }}
      >
        {setsArray.map((_, setIdx) => {
          const isClone = setIdx > 0;
          const setKey = `marquee-set-${safeId}-${setIdx}`;

          // Attach refs to set 0 and set 1 to accurately measure D (including junction gap)
          let setRefProp = null;
          if (setIdx === 0) setRefProp = set0Ref;
          else if (setIdx === 1) setRefProp = set1Ref;

          return (
            <div
              key={setKey}
              ref={setRefProp}
              aria-hidden={isClone ? 'true' : undefined}
              className={`flex flex-nowrap items-center ${gapClass} flex-shrink-0`}
            >
              {items.map((item, itemIdx) => {
                const itemKey = `set-${setIdx}-item-${item.id || itemIdx}`;
                return (
                  <div key={itemKey} className="flex-shrink-0">
                    {renderItem(item, itemIdx, isClone)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ContinuousMarquee;
