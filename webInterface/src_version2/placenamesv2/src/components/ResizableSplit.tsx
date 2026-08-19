/** Two panels with a draggable divider (Pointer Events, via useResizable) — switches to vertical stacking below 768px, and double-click resets to the initial split with a 300ms transition. */

import useResizable from "../hooks/useResizable";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface ResizableSplitProps {
  /** Left/top panel content (the map) */
  left: React.ReactNode;
  /** Right/bottom panel content (the knowledge graph) */
  right: React.ReactNode;
  /** Initial split percentage (0-100, how much goes to primary panel) */
  initialSplit?: number;
  /** Minimum percentage for left/top panel */
  minLeft?: number;
  /** Minimum percentage for right/bottom panel */
  minRight?: number;
  /** Callback when split ratio changes */
  onSplitChange?: (percent: number) => void;
}

export function ResizableSplit({
  left,
  right,
  initialSplit = 65,
  minLeft = 40,
  minRight = 15,
  onSplitChange,
}: ResizableSplitProps) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const axis = isMobile ? "vertical" : "horizontal";

  const { splitPercent, isDragging, isAnimating, containerRef, dividerProps } =
    useResizable({
      initialSplit,
      minPrimary: isMobile ? 20 : minLeft,
      minSecondary: isMobile ? 20 : minRight,
      axis,
      onSplitChange,
    });

  // Panel transition style based on animation state
  const panelTransition =
    isAnimating
      ? axis === "horizontal"
        ? "width 300ms ease"
        : "height 300ms ease"
      : "none";

  // Primary panel (map / left / top) sizing
  const primaryStyle: React.CSSProperties =
    axis === "horizontal"
      ? { width: `${splitPercent}%`, transition: panelTransition }
      : { height: `${splitPercent}%`, transition: panelTransition };

  // Secondary panel (graph / right / bottom) sizing
  const secondaryStyle: React.CSSProperties =
    axis === "horizontal"
      ? { width: `${100 - splitPercent}%`, transition: panelTransition }
      : { height: `${100 - splitPercent}%`, transition: panelTransition };

  // Divider classes based on axis and state
  const dividerSizeClass = axis === "horizontal" ? "w-2.5 h-full" : "h-2.5 w-full";
  const cursorClass =
    axis === "horizontal" ? "cursor-col-resize" : "cursor-row-resize";
  const dividerBgClass = isDragging
    ? "bg-blue-500"
    : "bg-gray-300 hover:bg-blue-400";

  // Dot color: white when dragging, otherwise gray with white on group hover
  const dotClass = isDragging
    ? "w-1.5 h-1.5 rounded-full bg-white"
    : "w-1.5 h-1.5 rounded-full bg-gray-500 group-hover:bg-white";

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full overflow-hidden ${
        axis === "vertical" ? "flex-col" : "flex-row"
      }`}
    >
      {/* Primary panel (map on top/left) */}
      <div style={primaryStyle} className="relative overflow-hidden">
        {left}
      </div>

      {/* Draggable divider */}
      <div
        {...dividerProps}
        className={`shrink-0 relative group flex items-center justify-center ${dividerSizeClass} ${cursorClass} ${dividerBgClass} transition-colors`}
        style={{ touchAction: "none" }}
      >
        {/* Grab dots: vertical stack for horizontal mode, horizontal row for vertical mode */}
        <div
          className={`flex gap-1 ${
            axis === "horizontal" ? "flex-col" : "flex-row"
          }`}
        >
          <span className={dotClass} />
          <span className={dotClass} />
          <span className={dotClass} />
        </div>
      </div>

      {/* Secondary panel (graph on bottom/right) */}
      <div style={secondaryStyle} className="relative overflow-hidden">
        {right}
      </div>
    </div>
  );
}
