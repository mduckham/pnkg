import { useState, useRef, useCallback, useEffect } from "react";

interface UseResizableOptions {
  initialSplit: number;
  minPrimary: number;
  minSecondary: number;
  axis: "horizontal" | "vertical";
  onSplitChange?: (percent: number) => void;
}

interface UseResizableReturn {
  splitPercent: number;
  isDragging: boolean;
  isAnimating: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  dividerProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onDoubleClick: () => void;
  };
}

export default function useResizable(
  options: UseResizableOptions
): UseResizableReturn {
  const { initialSplit, minPrimary, minSecondary, axis, onSplitChange } =
    options;

  const [splitPercent, setSplitPercent] = useState(initialSplit);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSplitChangeRef = useRef(onSplitChange);

  // Keep callback ref current without triggering effects
  useEffect(() => {
    onSplitChangeRef.current = onSplitChange;
  }, [onSplitChange]);

  // Notify on split change
  useEffect(() => {
    onSplitChangeRef.current?.(splitPercent);
  }, [splitPercent]);

  // Set up pointermove and pointerup listeners on the container
  useEffect(() => {
    const container = containerRef.current;
    if (!isDragging || !container) return;

    // Prevent text selection during drag
    document.body.style.userSelect = "none";

    const handlePointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      let percent: number;

      if (axis === "horizontal") {
        const x = e.clientX - rect.left;
        percent = (x / rect.width) * 100;
      } else {
        const y = e.clientY - rect.top;
        percent = (y / rect.height) * 100;
      }

      const clamped = Math.max(
        minPrimary,
        Math.min(100 - minSecondary, percent)
      );
      setSplitPercent(clamped);
    };

    const handlePointerUp = () => {
      setIsDragging(false);
    };

    const handleLostPointerCapture = () => {
      setIsDragging(false);
    };

    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerup", handlePointerUp);
    container.addEventListener(
      "lostpointercapture",
      handleLostPointerCapture
    );

    return () => {
      document.body.style.userSelect = "";
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener(
        "lostpointercapture",
        handleLostPointerCapture
      );
    };
  }, [isDragging, axis, minPrimary, minSecondary]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setIsDragging(true);
    },
    []
  );

  const handleDoubleClick = useCallback(() => {
    if (isDragging) return;
    if (splitPercent === initialSplit) return;

    setIsAnimating(true);
    setSplitPercent(initialSplit);

    setTimeout(() => {
      setIsAnimating(false);
    }, 300);
  }, [isDragging, splitPercent, initialSplit]);

  return {
    splitPercent,
    isDragging,
    isAnimating,
    containerRef,
    dividerProps: {
      onPointerDown: handlePointerDown,
      onDoubleClick: handleDoubleClick,
    },
  };
}
