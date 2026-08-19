/** Right-click context menu for graph nodes, positioned near the click; shows Collapse for expanded nodes; closes on outside click or Escape. */

import { useEffect, useRef } from "react";

interface ContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  isExpanded: boolean;
  onCollapse: (nodeId: string) => void;
  onClose: () => void;
}

export function ContextMenu({ x, y, nodeId, isExpanded, onCollapse, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape key
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="absolute z-50 min-w-[140px] rounded border border-gray-200 bg-white shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {isExpanded ? (
        <button
          role="menuitem"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 transition-colors text-left"
          onClick={() => {
            onCollapse(nodeId);
            onClose();
          }}
        >
          <span className="text-sm">↩︎</span>
          <span>Collapse</span>
        </button>
      ) : (
        <p className="px-3 py-1.5 text-xs text-gray-400 italic">No actions available</p>
      )}
    </div>
  );
}
