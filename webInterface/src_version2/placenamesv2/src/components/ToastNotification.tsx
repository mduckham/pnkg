/** Self-dismissing notification for expansion feedback, budget warnings, and errors — top-right of the graph panel. */

import { useEffect, useState } from "react";

export interface ToastProps {
  message: string;
  type: "success" | "warning" | "error";
  /** Auto-dismiss ms — omit to use readingDuration() below, which scales with message length so long messages aren't cut short. */
  duration?: number;
  onDismiss: () => void;
}

/** ~50ms/char reading pace, floored at 3s so short messages aren't slowed down. */
const READING_MS_PER_CHAR = 50;
const MIN_DURATION_MS = 3000;

function readingDuration(message: string): number {
  return Math.max(MIN_DURATION_MS, message.length * READING_MS_PER_CHAR);
}

const typeStyles = {
  success: "bg-green-50 border-green-200 text-green-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  error: "bg-red-50 border-red-200 text-red-800",
} as const;

const typeIcons = {
  success: "✓",
  warning: "⚠",
  error: "✕",
} as const;

export function ToastNotification({
  message,
  type,
  duration,
  onDismiss,
}: ToastProps) {
  const [visible, setVisible] = useState(false);
  const effectiveDuration = duration ?? readingDuration(message);

  // Animate in on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Auto-dismiss after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      // Wait for exit animation before calling onDismiss
      setTimeout(onDismiss, 200);
    }, effectiveDuration);

    return () => clearTimeout(timer);
  }, [effectiveDuration, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "absolute top-3 right-3 z-50 max-w-xs border rounded-lg px-4 py-3 shadow-md",
        "transition-all duration-200 ease-in-out",
        visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4",
        typeStyles[type],
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm font-medium leading-none mt-0.5">
          {typeIcons[type]}
        </span>
        <p className="text-sm leading-tight">{message}</p>
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            setTimeout(onDismiss, 200);
          }}
          className="ml-auto -mr-1 -mt-1 p-1 rounded hover:bg-black/5 transition-colors"
          aria-label="Dismiss notification"
        >
          <span className="text-xs leading-none">✕</span>
        </button>
      </div>
    </div>
  );
}
